import type { CollectionReference, Firestore } from "firebase-admin/firestore"
import { LexIndexer, type DelEvent, type PutEvent } from "@bsky/jetstream"
import { bill, hearing } from "./lexicons/org/mapletestimony.js"
import {
  billAppviewFields,
  hearingAppviewFields,
  toBillDoc,
  toHearingDoc
} from "./mapper.js"
import { billRecord, hearingRecord, type RecordType } from "./records.js"
import { setPreserving, type PreservedFields } from "./preserve.js"

export interface IndexerStats {
  creates: number
  updates: number
  deletes: number
  invalid: number
}

/**
 * A delete event carries no record, so the document cannot be mapped from
 * fields the way a put is. Resolving it by the stored AT-URI is what lets
 * `RecordType.docId` stay the only place a document id is decided — see the
 * note there for why the rkey is not an option.
 */
async function deleteByUri(docs: CollectionReference, e: DelEvent) {
  const matches = await docs.where("atp.uri", "==", e.uri).get()
  await Promise.all(matches.docs.map(d => d.ref.delete()))
  return matches.size
}

/**
 * The consumer's event handling, separated from transport so tests can drive
 * the same registration through indexer.run() with synthetic events. Puts are
 * upserts: bills are re-scraped daily, so updates must write, not just count.
 *
 * collectionPrefix namespaces every collection this indexer writes (tests
 * pass a unique prefix), so registrations stay test-isolated without touching
 * this seam.
 *
 * Writes go through setPreserving rather than a plain set: these collections
 * carry AppView-owned fields (testimony counters, video transcription state)
 * that no record contains and a whole-doc write would otherwise erase.
 */
export function buildIndexer(
  db: Firestore,
  collectionPrefix = ""
): { indexer: LexIndexer; stats: IndexerStats } {
  const stats: IndexerStats = { creates: 0, updates: 0, deletes: 0, invalid: 0 }
  const indexer = new LexIndexer()

  /** One record type's handlers. Every collection is indexed the same way, so
   * the only per-type facts are its schema, how a record becomes a document,
   * and which fields the AppView owns — a third type should be another call,
   * not another copy of this body. */
  function register<R>(
    type: RecordType<R>,
    toDoc: (e: PutEvent<R>, indexedAt: string) => Record<string, unknown>,
    preserved: PreservedFields
  ) {
    const docs = db.collection(collectionPrefix + type.collection)
    return {
      put: async (e: PutEvent<R>) => {
        if (e.operation === "update") stats.updates++
        else stats.creates++
        const doc = toDoc(e, new Date().toISOString())
        await setPreserving(docs.doc(type.docId(e.record)), doc, preserved)
        console.log(`[consumer] indexed ${e.operation} ${e.uri}`)
      },
      del: async (e: DelEvent) => {
        stats.deletes += await deleteByUri(docs, e)
      }
    }
  }

  indexer
    .commit(bill, register(billRecord, toBillDoc, billAppviewFields))
    .commit(
      hearing,
      register(hearingRecord, toHearingDoc, hearingAppviewFields)
    )
    .onValidationError(e => {
      stats.invalid++
      console.warn(
        `[consumer] skipped schema-invalid record ${e.uri}: ${e.error.message}`
      )
    })

  return { indexer, stats }
}
