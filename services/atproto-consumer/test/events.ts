import { readFileSync } from "node:fs"
import type { EventBatch, RawEvent } from "@bsky/jetstream"
import {
  billRecord,
  hearingRecord,
  type BillRecord,
  type HearingRecord,
  type RecordType
} from "../src/records.js"
import { billRkey, hearingRkey } from "../../atproto-publisher/src/rkeys.js"

/**
 * Builders for synthetic Jetstream v2 wire events, typed as the SDK's own
 * RawEvent so an SDK bump breaks the build instead of silently diverging.
 * This module is the single branded-type boundary: identifiers must be
 * well-formed (handler-facing uri/cid are lazy getters that validate on
 * first read), and the one `as RawEvent` cast lives in commitEvent().
 *
 * Default records come from fixtures/, the same files the lexicon validator
 * checks and test/pds.ts puts on the local PDS — so a fixture that
 * stops satisfying the lexicon fails here, in the unit tests, rather than as
 * an unexplained skipped record in the e2e harness.
 */

const DEFAULT_DID = "did:plc:harness0000000000000000"
const DEFAULT_REV = "3juf3jt2t2c2x"
const DEFAULT_CID =
  "bafyreihgx7zaladfyv6uxdc4le37yqi3azfhawvlbmnzpvbmjmoiabx3wa"

const load = <R>(type: RecordType<R>): R =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/${type.fixture}`, import.meta.url),
      "utf8"
    )
  )

export const billFixture: BillRecord = load(billRecord)
export const hearingFixture: HearingRecord = load(hearingRecord)

/**
 * The publisher's rkey conventions, imported rather than respelled, so
 * the synthetic events and the record test/pds.ts puts on a real PDS are keyed
 * exactly where a real publisher would key them.
 *
 * Nothing in src/ may depend on these: the indexer derives every document id
 * from record FIELDS (src/records.ts), never from the rkey, precisely so a
 * publisher-side rename is not a Firestore migration. What the import protects
 * is the harness's claim to be exercising the real path — spelled out by hand
 * here, the two agreed only by coincidence, and a change on the publisher side
 * would have left the smoke test green against an rkey nothing produces.
 *
 * Reaching into the other package is safe only because src/rkeys.ts is a leaf
 * with no imports of its own: this is test-only code, and it drags none of the
 * publisher's dependencies into `yarn test`.
 */
export const BILL_RKEY = billRkey(billFixture.court, billFixture.billId)
export const HEARING_RKEY = hearingRkey(hearingFixture.hearingId)

let seqCounter = 1000
export const nextSeq = () => ++seqCounter

function commitEvent(fields: {
  did: string
  seq: number
  time: string
  commit: object
}): RawEvent {
  return { kind: "commit", ...fields } as RawEvent
}

export type EventOpts = {
  did?: string
  seq?: number
  rkey?: string
  rev?: string
  cid?: string
  time?: string
  /**
   * Merged over the fixture record, which always carries $type. An
   * explicitly-undefined value removes that field from the wire record
   * (records are plain JSON; an undefined property would not survive the
   * wire and must not reach the SDK's record parsing).
   */
  record?: Record<string, unknown>
}

function withoutUndefined(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== undefined)
  )
}

/** One collection's put/delete builders. The NSID comes from the record type
 * rather than a literal, so a namespace rename stays the single-file change
 * the lexicons were designed for. */
function builders<R>(type: RecordType<R>, defaultRkey: string, base: R) {
  const event = (operation: string, opts: EventOpts, extra: object) =>
    commitEvent({
      did: opts.did ?? DEFAULT_DID,
      seq: opts.seq ?? nextSeq(),
      time: opts.time ?? new Date().toISOString(),
      commit: {
        operation,
        collection: type.nsid,
        rkey: opts.rkey ?? defaultRkey,
        rev: opts.rev ?? DEFAULT_REV,
        ...extra
      }
    })

  const put = (operation: "create" | "update", opts: EventOpts = {}) =>
    event(operation, opts, {
      cid: opts.cid ?? DEFAULT_CID,
      record: withoutUndefined({ ...base, ...opts.record })
    })

  return {
    create: (opts: EventOpts = {}) => put("create", opts),
    update: (opts: EventOpts = {}) => put("update", opts),
    del: (opts: Omit<EventOpts, "record" | "cid"> = {}) =>
      event("delete", opts, {})
  }
}

export const billEvent = builders(billRecord, BILL_RKEY, billFixture)
export const hearingEvent = builders(
  hearingRecord,
  HEARING_RKEY,
  hearingFixture
)

/** The AT-URI the indexer stores and resolves deletes by. */
export const uriFor = (did: string, collection: string, rkey: string) =>
  `at://${did}/${collection}/${rkey}`

export function batch(events: RawEvent[]): EventBatch<RawEvent> {
  return { events, lastCursor: events[events.length - 1]?.seq ?? 0 }
}
