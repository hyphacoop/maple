import type { Firestore } from "firebase-admin/firestore"
import { LexIndexer } from "@bsky/jetstream"
import { app } from "@bsky/sdk/lexicons"
import { toProfileDoc } from "./mapper.js"

export interface IndexerStats {
  creates: number
  updates: number
  deletes: number
  invalid: number
}

/**
 * The consumer's event handling, separated from transport so tests can drive
 * the same registration through indexer.run() with synthetic events. Puts are
 * upserts: bills are re-scraped daily, so updates must write, not just count.
 *
 * collectionPrefix namespaces every collection this indexer writes (tests
 * pass a unique prefix), so future registrations stay test-isolated without
 * touching this seam.
 *
 * Profile docs are wholly consumer-owned, so puts are a plain set. When the
 * org.mapletestimony mappers land, collections with appview-owned
 * fields (testimony counters, latestTestimonyAt, ...) write through
 * setPreserving (./preserve.js) instead — the mechanism is pinned by
 * preserve.test.ts.
 */
export function buildIndexer(
  db: Firestore,
  collectionPrefix = ""
): { indexer: LexIndexer; stats: IndexerStats } {
  const profiles = db.collection(collectionPrefix + "atpJetstreamProfiles")
  const stats: IndexerStats = { creates: 0, updates: 0, deletes: 0, invalid: 0 }

  const indexer = new LexIndexer()
    .commit(app.bsky.actor.profile, {
      put: async e => {
        if (e.operation === "update") stats.updates++
        else stats.creates++
        const doc = toProfileDoc(e, new Date().toISOString())
        await profiles.doc(e.did).set(doc)
        console.log(
          `[consumer] indexed profile ${e.operation} ${e.did}${
            doc.displayName ? ` (${doc.displayName})` : ""
          }`
        )
      },
      del: async e => {
        stats.deletes++
        await profiles.doc(e.did).delete()
      }
    })
    .onValidationError(e => {
      stats.invalid++
      console.warn(
        `[consumer] skipped schema-invalid record ${e.uri}: ${e.error.message}`
      )
    })

  return { indexer, stats }
}
