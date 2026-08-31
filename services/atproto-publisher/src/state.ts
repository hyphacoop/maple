import type { Firestore } from "firebase-admin/firestore"

/**
 * What we last successfully wrote to the PDS, per record.
 *
 * This lives in its OWN collection rather than as a field on the bill or
 * hearing document, because the publisher is driven by a Firestore trigger on
 * those documents: writing state back onto them would re-fire the trigger on
 * every publish. functions/src/analysis/updateBillTracker.ts keeps its state
 * in /billTracker for the same reason.
 *
 * It is a local mirror, not an authority. It records what we believe reached
 * the PDS, which is not the same as what the PDS holds — point the publisher
 * at a rebuilt repo and every hash here still matches. The backfill closes
 * that gap by listing the repo first and republishing anything missing
 * (see `prepare`'s `known` argument); recovering a repo is an operator action,
 * and the backfill is the operator action for it.
 */
const COLLECTION = "atpPublished"

export type PublishState = {
  /** The repo these were written to. Provenance for the parity checker,
   * which needs to know a state row describes the PDS it is comparing. */
  did: string
  /** Duplicated from the document id so the parity checker can query by record
   * type without parsing ids. */
  nsid: string
  rkey: string
  /** Hash of the published record, excluding `fetchedAt`. See publish.ts. */
  hash: string
  uri: string
  cid: string
  publishedAt: string
}

/** NSIDs are dot-separated alphanumeric segments and our rkeys are
 * `{court}-{billId}` or a bare integer, so neither can contain `_` and the
 * join is unambiguous. */
const stateId = (nsid: string, rkey: string) => `${nsid}_${rkey}`

export async function readState(
  db: Firestore,
  nsid: string,
  rkey: string
): Promise<PublishState | undefined> {
  const snap = await db.collection(COLLECTION).doc(stateId(nsid, rkey)).get()
  return snap.exists ? (snap.data() as PublishState) : undefined
}

/** Refs for a page of records, for the backfill's batched read and write. */
export const stateRef = (db: Firestore, nsid: string, rkey: string) =>
  db.collection(COLLECTION).doc(stateId(nsid, rkey))

export async function writeState(
  db: Firestore,
  did: string,
  state: Omit<PublishState, "did">
): Promise<void> {
  await stateRef(db, state.nsid, state.rkey).set({ ...state, did })
}
