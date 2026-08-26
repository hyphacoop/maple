import type { PutEvent } from "@bsky/jetstream"

/**
 * Event → Firestore document mapping. This is the seam that changes when the
 * consumer graduates from the demo collection (app.bsky.actor.profile) to
 * org.mapletestimony.* records: swap the mapper and the indexer registration,
 * nothing else.
 */

/** The subset of app.bsky.actor.profile we index (blobs excluded). */
export type IndexedProfileFields = {
  displayName?: string
  description?: string
  createdAt?: string
}

export type ProfileDoc = IndexedProfileFields & {
  did: string
  uri: string
  cid: string
  seq: number
  indexedAt: string
}

export function toProfileDoc(
  e: PutEvent<IndexedProfileFields>,
  indexedAt: string
): ProfileDoc {
  return {
    did: e.did,
    uri: e.uri,
    cid: e.cid,
    seq: e.seq,
    indexedAt,
    displayName: e.record.displayName,
    description: e.record.description,
    createdAt: e.record.createdAt
  }
}
