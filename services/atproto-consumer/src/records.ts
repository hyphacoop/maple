import { bill, hearing } from "./lexicons/org/mapletestimony.js"

/**
 * What every MAPLE record type is, in one table.
 *
 * These four facts — NSID, Firestore collection, document id, and the fixture
 * that stands for a valid instance — were previously spelled out separately in
 * the indexer, the lexicon validator, the test event builders and a shell
 * script. Four files that had to be edited in lockstep and could not fail
 * loudly when they weren't. Adding a record type should be an entry here.
 *
 * Deliberately dependency-light (no firebase-admin, no mapper): the validator
 * and the test builders read it too, and neither should have to load a
 * Firestore client to learn an NSID.
 */

export type BillRecord = bill.Main
export type HearingRecord = hearing.Main

export interface RecordType<R> {
  nsid: string
  collection: string
  /** File under fixtures/, relative to the package root. */
  fixture: string
  /**
   * Derived from record FIELDS, never from the rkey. The rkey convention is
   * the publisher's; parsing it here would make a publisher-side rename
   * a Firestore migration. Deletes, whose events carry no record, resolve the
   * document by its stored `atp.uri` for the same reason.
   */
  docId: (record: R) => string
}

/** The app keys hearings as `events/hearing-{EventId}`, so the shadow does
 * too and the parity checker compares like for like. One spelling of the prefix: the
 * hearing's own document id and the ids a bill refers to it by both come from
 * here. */
export const hearingDocId = (hearingId: number) => `hearing-${hearingId}`

export const billRecord: RecordType<BillRecord> = {
  nsid: bill.$nsid,
  collection: "atpBills",
  fixture: "bill.record.json",
  docId: r => `${r.court}-${r.billId}`
}

export const hearingRecord: RecordType<HearingRecord> = {
  nsid: hearing.$nsid,
  collection: "atpHearings",
  fixture: "hearing.record.json",
  docId: r => hearingDocId(r.hearingId)
}

/** For the places that walk every type rather than naming one: the lexicon
 * validator and the test event builders. `any` is contained here — callers
 * that need the record type use the individual exports above. */
export const recordTypes: readonly RecordType<any>[] = [
  billRecord,
  hearingRecord
]
