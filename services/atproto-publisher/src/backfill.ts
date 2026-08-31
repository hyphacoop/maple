import { setTimeout as sleep } from "node:timers/promises"
import {
  FieldPath,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot
} from "firebase-admin/firestore"
import {
  PdsClient,
  rateLimitDelay,
  type BatchWrite,
  type WriteResult
} from "./agent.js"
import { readConfig } from "./config.js"
import { initFirestore } from "./db.js"
import { prepare } from "./publish.js"
import { recordTypes, type RecordType } from "./records.js"
import { stateRef, type PublishState } from "./state.js"

/**
 * Publishes the whole corpus, for first population and for re-syncing after a
 * gap. Not a cloud function: ~8000 bills will not fit inside the 540s ceiling,
 * and this is an operator action, not an event handler.
 *
 *   ATP_PDS_URL=... ATP_PDS_HANDLE=... ATP_PDS_PASSWORD=... \
 *     yarn --cwd services/atproto-publisher backfill [bill|hearing]
 *
 * Re-runnable and cheap on a second pass: unchanged records are skipped by the
 * same `prepare` the triggers use, so the two cannot disagree about what is
 * already published.
 */

/** Leaves room under the PDS's 150 KiB (153,600 byte) transport cap, which
 * applies to the whole request envelope and not just the records. Measured on
 * the spike by bisection; a real bill record is 2-6 KB. */
const MAX_BATCH_BYTES = 120_000
const MAX_BATCH_WRITES = 100

/** Documents read per Firestore page. Bills carry content.DocumentText, which
 * runs to hundreds of KB, so pulling all ~8000 in one .get() would be gigabytes
 * resident. Paging keeps it flat. */
const PAGE_SIZE = 200

/** Pause between commits. The PDS's real write limits are not yet measured
 * against a deployed instance, so this is deliberately conservative and
 * adjustable rather than tuned to a number we have not verified. */
const BATCH_PAUSE_MS = Number(process.env.ATP_BACKFILL_PAUSE_MS ?? 250)

type Counts = {
  scanned: number
  unchanged: number
  invalid: number
  unmappable: number
  published: number
}

/** Pages a query by document id, so the resident set is one page rather than
 * the whole collection. */
async function* pages(query: Query): AsyncGenerator<QueryDocumentSnapshot[]> {
  const base = query.orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
  let after: QueryDocumentSnapshot | undefined
  for (;;) {
    const page = await (after ? base.startAfter(after) : base).get()
    if (page.empty) return
    yield page.docs
    if (page.size < PAGE_SIZE) return
    after = page.docs[page.docs.length - 1]
  }
}

async function commit(
  client: PdsClient,
  writes: BatchWrite[],
  attempt = 0
): Promise<WriteResult[]> {
  try {
    return await client.applyWrites(writes)
  } catch (e) {
    const delay = rateLimitDelay(e)
    if (delay !== undefined && attempt < 5) {
      console.warn(`  rate limited, waiting ${delay}s`)
      await sleep(delay * 1000)
      return commit(client, writes, attempt + 1)
    }
    throw e
  }
}

async function runJob<D>(
  db: Firestore,
  client: PdsClient,
  type: RecordType<D>
): Promise<Counts> {
  const counts: Counts = {
    scanned: 0,
    unchanged: 0,
    invalid: 0,
    unmappable: 0,
    published: 0
  }
  // What the repo already holds: applyWrites has no upsert, so each write must
  // declare create or update. It is also how a record that is missing from the
  // PDS gets republished even though our local state says it is current.
  const known = await client.listRkeys(type.nsid)
  console.log(`${type.nsid}: ${known.size} records already in the repo`)

  let pending: { write: BatchWrite; hash: string }[] = []
  let pendingBytes = 0

  const flush = async () => {
    if (pending.length === 0) return
    const results = await commit(
      client,
      pending.map(p => p.write)
    )
    // One Firestore commit for the batch rather than a write per record: the
    // PDS side is already a single commit, and a serial .set() per record was
    // the slowest part of a full run.
    const batch = db.batch()
    pending.forEach(({ write, hash }, i) => {
      const state: PublishState = {
        did: client.did,
        nsid: write.collection,
        rkey: write.rkey,
        hash,
        uri: results[i]!.uri,
        cid: results[i]!.cid,
        publishedAt: new Date().toISOString()
      }
      batch.set(stateRef(db, state.nsid, state.rkey), state)
      known.add(write.rkey)
    })
    await batch.commit()
    counts.published += pending.length
    pending = []
    pendingBytes = 0
    await sleep(BATCH_PAUSE_MS)
  }

  for await (const docs of pages(type.query(db))) {
    counts.scanned += docs.length
    // Prepared concurrently: each doc's state read is an independent round
    // trip, and running a page of them together turns ~7300 serial reads into
    // ~37 batches.
    const prepared = await Promise.all(
      docs.map(snap => prepare(db, type, snap.data() as D, known))
    )
    for (const p of prepared) {
      if (!p.publish) {
        counts[p.result.status]++
        if (p.result.status === "invalid") {
          console.warn(`  invalid: ${p.result.message}`)
        }
        continue
      }
      const size = JSON.stringify(p.record).length
      if (
        pending.length >= MAX_BATCH_WRITES ||
        pendingBytes + size > MAX_BATCH_BYTES
      ) {
        await flush()
      }
      pending.push({
        write: {
          op: known.has(p.rkey) ? "update" : "create",
          collection: type.nsid,
          rkey: p.rkey,
          record: p.record
        },
        hash: p.hash
      })
      pendingBytes += size
    }
  }
  await flush()
  return counts
}

async function main() {
  const config = readConfig()
  if (!config) {
    throw new Error(
      "Set ATP_PDS_URL, ATP_PDS_HANDLE and ATP_PDS_PASSWORD to backfill"
    )
  }
  const only = process.argv[2]
  const name = (t: RecordType<any>) => t.nsid.split(".").pop()!
  const selected = only
    ? recordTypes.filter(t => name(t) === only)
    : recordTypes
  if (selected.length === 0) {
    throw new Error(
      `Unknown record type "${only}" (expected: ${recordTypes
        .map(name)
        .join(", ")})`
    )
  }

  const db = initFirestore(process.env.GCLOUD_PROJECT)
  const client = await PdsClient.login(config)
  console.log(`publishing to ${config.service} as ${client.did}`)

  for (const type of selected) {
    console.log(
      `${name(type)}: ${JSON.stringify(await runJob(db, client, type))}`
    )
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
