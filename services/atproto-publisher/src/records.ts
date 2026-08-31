import type { Query } from "firebase-admin/firestore"
import { bill, hearing } from "./lexicons/org/mapletestimony.js"
import type { BillDoc, HearingDoc } from "./mapper.js"
import { toBillRecord, toHearingRecord } from "./mapper.js"

/**
 * What every MAPLE record type is, from the publishing side, in one table.
 *
 * The consumer has the mirror of this (services/atproto-consumer/src/records.ts)
 * describing where records LAND. This one describes where they COME FROM, how
 * they are keyed, and how they are recognised — and it is one entry per record
 * type for the same reason the consumer's is: these facts were previously
 * spelled out separately in the triggers, the backfill and the target
 * validator, three places that had to be edited in lockstep and could not fail
 * loudly when they weren't. Adding a record type should be an entry here plus a
 * mapper function, and nothing else.
 *
 * The two packages are separate Firebase deploy units sharing only
 * lexicons/*.json, so this is a deliberate mirror rather than shared code.
 */

export type BillRecord = bill.Main
export type HearingRecord = hearing.Main

/**
 * Record key conventions. These live here and nowhere else.
 *
 * The lexicons declare `"key": "any"` and tell consumers to treat the rkey as
 * opaque, precisely so these can change without becoming a Firestore
 * migration. Nothing may parse them back.
 */
export const billRkey = (court: number, billId: string) => `${court}-${billId}`
export const hearingRkey = (hearingId: number) => String(hearingId)

/** What the generated lexicon schemas expose, structurally, so this table does
 * not have to name a type from @atproto/lex's internals. */
export type Schema = {
  safeValidate(
    v: unknown
  ):
    | { success: true; value: unknown }
    | { success?: false; message: string; issues?: unknown }
}

export interface RecordType<D> {
  nsid: string
  schema: Schema
  /** Firestore trigger path for the documents this publishes from. */
  document: string
  /**
   * Whether a document at that path is of this type at all. `/events` holds
   * `session` and `specialEvent` documents alongside hearings, and this is the
   * ONE place that says so — the backfill's query below must agree with it, so
   * they sit adjacent rather than in two files.
   */
  accepts: (doc: D) => boolean
  /** The same set of documents, for the backfill to page through. */
  query: (db: FirebaseFirestore.Firestore) => Query
  /** Undefined when the document cannot be keyed — an unusable document, not
   * a validation failure. */
  rkey: (doc: D) => string | undefined
  toRecord: (doc: D) => object
}

export const billRecord: RecordType<BillDoc> = {
  nsid: bill.$nsid,
  schema: bill.main,
  document: "/generalCourts/{court}/bills/{billId}",
  accepts: () => true,
  query: db => db.collectionGroup("bills"),
  rkey: doc =>
    typeof doc.court === "number" && doc.id
      ? billRkey(doc.court, doc.id)
      : undefined,
  toRecord: toBillRecord
}

export const hearingRecord: RecordType<HearingDoc> = {
  nsid: hearing.$nsid,
  schema: hearing.main,
  document: "/events/{eventId}",
  accepts: doc => doc.type === "hearing",
  query: db => db.collection("events").where("type", "==", "hearing"),
  rkey: doc =>
    typeof doc.content?.EventId === "number"
      ? hearingRkey(doc.content.EventId)
      : undefined,
  toRecord: toHearingRecord
}

/** For the places that walk every type rather than naming one: the triggers,
 * the backfill and the target validator. `any` is contained here. */
export const recordTypes: readonly RecordType<any>[] = [
  billRecord,
  hearingRecord
]
