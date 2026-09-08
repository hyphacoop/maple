import { Change } from "firebase-functions"
import { isEqual, last } from "lodash"
import Collection from "typesense/lib/Typesense/Collection"
import { ObjectNotFound } from "typesense/lib/Typesense/Errors"
import {
  db,
  DocumentData,
  DocumentSnapshot,
  FieldPath,
  QueryDocumentSnapshot
} from "../firebase"
import { BackfillConfig, upgradePath } from "./backfillRun"
import { createClient } from "./client"
import { searchCollectionName } from "./collectionName"
import { CollectionConfig, DEFAULT_BATCH_SIZE } from "./config"
import { forceGc } from "./forceGc"
import { Timestamp } from "../firebase"

/** Ceiling on one `documents().import()` body, held far enough under the 10 MB
 * maximum payload of the AWS API Gateway HTTP API these collections sit behind
 * that headers and encoding cannot push a batch over it. A batch over the cap
 * is rejected outright and would fail the same way on every retry. Budgeting
 * the import by serialized bytes rather than by document count is what makes
 * that impossible: bills carry their full text in `body`, so a fixed count is
 * safe at the mean and unsafe in the tail.
 */
export const IMPORT_BYTE_BUDGET = 6 * 1024 * 1024

export type BackfillChunkResult = {
  /** Document path the next chunk resumes `startAfter`, or null when the
   * source is spent. */
  cursor: string | null
  batches: number
  documents: number
  convertFailures: number
  /** Serialized size of everything this chunk imported, across every page. */
  bytes: number
  /** The largest single page in this chunk. The page is what sits in memory at
   * once, so this — not the chunk total — is the number to read when choosing a
   * config's `batchSize`. */
  peakPageBytes: number
  /** Highest resident memory seen after importing a page, before the forced
   * collection. This is the figure the container kills on. */
  peakRssBytes: number
  /** Highest resident memory seen after a forced collection. Flat across
   * pages means the collection reclaims what a page allocates; climbing means
   * something is retained between pages. All four sizing figures are logged
   * rather than persisted: the run's `Totals` are a checkpoint a replayed
   * chunk must reproduce exactly. */
  peakRssAfterGcBytes: number
}

/** The id of a failed import's `document`, which the server echoes back as the
 * original JSONL line (a string) — parsed defensively, for logs only. */
const failedDocumentId = (document: unknown): string | undefined => {
  try {
    return typeof document === "string"
      ? JSON.parse(document).id
      : (document as { id?: string } | undefined)?.id
  } catch {
    return undefined
  }
}

export class SearchIndexer {
  /** How many source documents to read per Firestore page. Independent of the
   * import payload, which `importPage` sizes by bytes. */
  private readonly batchSize: number
  private readonly client = createClient()
  private readonly collectionName: string

  private collection: Collection | undefined

  constructor(private readonly config: CollectionConfig) {
    this.collectionName = searchCollectionName(config)
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE
  }

  private passesFilter(data: DocumentData | undefined) {
    if (!data) return false
    if (!this.config.filter) return true
    try {
      return this.config.filter(data)
    } catch (error) {
      console.error("Filter function threw", error)
      return false
    }
  }

  /** The collection this config currently hashes to. A chunk compares it
   * against the name recorded on the run to notice that the deployed code
   * changed underneath an in-flight backfill. */
  get targetCollectionName() {
    return this.collectionName
  }

  async scheduleUpgradeIfNeeded(backfillConfig: unknown) {
    const config = BackfillConfig.parse(backfillConfig)
    const { alias } = this.config
    const isCollectionUpToDate =
      this.collectionName === (await this.getCurrentCollectionName())
    console.log(`Index for alias ${alias} up to date: ${isCollectionUpToDate}`)
    if (!isCollectionUpToDate) {
      console.log(`Scheduling upgrade for alias ${alias}`)
      const upgradeDoc = db.doc(upgradePath(alias))
      // Recursive, not a plain delete: deleting a document leaves its
      // subcollections behind, and a surviving `chunks/0` from the previous run
      // would make this run's `create` throw.
      await db.recursiveDelete(upgradeDoc)
      await upgradeDoc.create({
        createdAt: Timestamp.now(),
        ...config
      })
    }
  }

  /** Ensures the target collection exists so chunks can import into it. */
  async beginUpgrade() {
    await this.getCollection()
  }

  /** Points the alias at the freshly backfilled collection and drops the old
   * one. Only called once the source is exhausted. */
  async finishUpgrade() {
    await this.upgradeAlias()
  }

  async syncDocument(change: Change<DocumentSnapshot>) {
    const beforeData = change.before.exists ? change.before.data() : undefined
    const afterData = change.after.exists ? change.after.data() : undefined

    // if no data or doesn't match filter, delete from index
    if (!afterData || !this.passesFilter(afterData)) {
      if (beforeData && this.passesFilter(beforeData)) {
        const { id } = this.config.convert(beforeData)
        await (await this.getCollection()).documents(id).delete()
      }
      return
    }

    const after = this.config.convert(afterData)

    // update if previous data doesn't exist, didn't match, or if the converted data changed
    if (
      !beforeData ||
      !this.passesFilter(beforeData) ||
      !isEqual(this.config.convert(beforeData), after)
    ) {
      await (await this.getCollection()).documents().upsert(after)
    }
  }

  private async getCurrentCollectionName() {
    try {
      const alias = await this.client.aliases(this.config.alias).retrieve()
      return alias.collection_name
    } catch (e) {
      if (e instanceof ObjectNotFound) return null
      else throw e
    }
  }

  private async getCollection() {
    if (!this.collection) {
      const collection = this.client.collections(this.collectionName)
      const exists = await collection.exists()
      console.log("Collection exists", exists)
      if (!exists) await this.createCollection()
      this.collection = collection
    }
    return this.collection
  }

  private async createCollection() {
    await this.client
      .collections()
      .create({ name: this.collectionName, ...this.config.schema })
  }

  /** Moves as much of the source into the target collection as the given budget
   * allows, starting after `startAfter`, and reports where it stopped. A null
   * cursor in the result means the source is exhausted; anything else is the
   * checkpoint the next chunk resumes from.
   */
  async backfillChunk({
    startAfter,
    maxBatches,
    budgetMs
  }: {
    startAfter: string | null
    maxBatches?: number
    budgetMs: number
  }): Promise<BackfillChunkResult> {
    const deadline = Date.now() + budgetMs
    let cursor: string | null = startAfter
    let batches = 0
    let documents = 0
    let convertFailures = 0
    let bytes = 0
    let peakPageBytes = 0
    let peakRssBytes = 0
    let peakRssAfterGcBytes = 0

    while (maxBatches === undefined || batches < maxBatches) {
      // Checked after the first page so a chunk always makes progress, however
      // little budget it inherited.
      if (batches > 0 && Date.now() >= deadline) break

      const page = await this.listPage(cursor)
      cursor = page.cursor

      if (page.docs.length) {
        batches++
        const imported = await this.importPage(page.docs)
        documents += imported.documents
        convertFailures += imported.convertFailures
        bytes += imported.bytes
        peakPageBytes = Math.max(peakPageBytes, imported.bytes)

        // Reclaim the page before fetching the next one — see ./forceGc.ts.
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss())
        forceGc()
        peakRssAfterGcBytes = Math.max(
          peakRssAfterGcBytes,
          process.memoryUsage.rss()
        )
      }

      if (cursor === null) break
    }

    return {
      cursor,
      batches,
      documents,
      convertFailures,
      bytes,
      peakPageBytes,
      peakRssBytes,
      peakRssAfterGcBytes
    }
  }

  /** Converts and imports one page of snapshots, splitting the import into
   * request-sized slices. Each document is converted, serialized and dropped in
   * the same iteration, so the converted page never exists as a whole: what is
   * live at once is the snapshots plus at most one slice of lines. */
  private async importPage(snapshots: QueryDocumentSnapshot[]) {
    const { convert } = this.config
    const collection = await this.getCollection()
    let slice: string[] = []
    let sliceBytes = 0
    let documents = 0
    let convertFailures = 0
    let bytes = 0

    // Releases the line array before the round trip: the joined body is the
    // copy that ships, and reassigning the captured `let` is what frees this one.
    const flush = async () => {
      if (!slice.length) return
      const body = slice.join("\n")
      bytes += sliceBytes
      slice = []
      sliceBytes = 0
      await this.importDocuments(collection, body)
    }

    for (const snapshot of snapshots) {
      let doc: any
      try {
        const data = snapshot.data()
        if (!this.passesFilter(data)) continue
        doc = convert(data)
      } catch (error: any) {
        convertFailures++
        console.error(`Failed to convert document: ${error.message}`)
        continue
      }
      documents++

      // Serialized once, here: the same line is measured against the budget
      // and shipped as the import body, rather than stringified a second time
      // inside the client. Bytes, not string length: the cap is on the encoded
      // body, and `.length` counts UTF-16 units, which undercounts anything
      // non-ASCII. +1 for the JSONL newline.
      const line = JSON.stringify(doc)
      const size = Buffer.byteLength(line) + 1
      if (slice.length && sliceBytes + size > IMPORT_BYTE_BUDGET) await flush()
      slice.push(line)
      sliceBytes += size
    }
    await flush()
    return { documents, convertFailures, bytes }
  }

  /** Imports pre-serialized JSONL lines. The client's string form returns the
   * raw per-line results WITHOUT throwing ImportError — only its array form
   * does — so failures are detected here, and must be: a silently rejected
   * batch would otherwise count as progress. */
  private async importDocuments(collection: Collection, body: string) {
    const response = await collection
      .documents()
      .import(body, { action: "upsert" })
    const results = String(response)
      .split("\n")
      .map(line => JSON.parse(line))
    const failures = results.filter(r => r.success === false)
    if (failures.length) {
      console.error(
        failures.map(r => ({
          code: r.code,
          error: r.error,
          id: failedDocumentId(r.document)
        }))
      )
      throw Error(
        `${failures.length} of ${results.length} documents failed to import`
      )
    }
  }

  private async upgradeAlias() {
    const { alias } = this.config
    console.log("Upgrading alias", alias)
    const obsoleteCollection = await this.getCurrentCollectionName()
    console.log(
      "Upgrading collection",
      obsoleteCollection,
      "to",
      this.collectionName
    )
    await this.client
      .aliases()
      .upsert(alias, { collection_name: this.collectionName })
    if (obsoleteCollection && obsoleteCollection !== this.collectionName) {
      const collection = this.client.collections(obsoleteCollection)
      const exists = await collection.exists()
      if (exists) {
        await collection.delete()
      }
    }
  }

  /** One ordered page of the source, with the cursor to resume after it — null
   * once the source is exhausted, which a short page already tells us.
   *
   * Ordered by document name, with the last document's path as the cursor: the
   * one ordering Firestore always serves without an index, and the one value
   * unique per document, so it survives being written into a chunk document.
   * Ordering by `idField` instead would make the persisted value-cursor skip
   * documents — Firestore positions a value cursor after ALL documents equal
   * to it, and bills' collectionGroup holds the same bill number once per
   * general court, adjacent in that ordering, so page boundaries would
   * silently drop the rest of a boundary-straddling group from the index.
   */
  private async listPage(startAfter: string | null): Promise<{
    docs: QueryDocumentSnapshot[]
    cursor: string | null
  }> {
    let query = this.config.sourceCollection
      .orderBy(FieldPath.documentId())
      .limit(this.batchSize)
    if (startAfter !== null) query = query.startAfter(db.doc(startAfter))

    const { docs } = await query.get()
    const tail = docs.length < this.batchSize ? undefined : last(docs)
    return {
      docs,
      cursor: tail ? tail.ref.path : null
    }
  }
}
