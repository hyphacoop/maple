import type { EventBatch, RawEvent } from "@bsky/jetstream"

/**
 * Builders for synthetic Jetstream v2 wire events, typed as the SDK's own
 * RawEvent so an SDK bump breaks the build instead of silently diverging.
 * This module is the single branded-type boundary: identifiers must be
 * well-formed (handler-facing uri/cid are lazy getters that validate on
 * first read), and the one `as RawEvent` cast lives in commitEvent().
 */

const DEFAULT_DID = "did:plc:harness0000000000000000"
const PROFILE_NSID = "app.bsky.actor.profile"
const DEFAULT_REV = "3juf3jt2t2c2x"
const DEFAULT_CID =
  "bafyreihgx7zaladfyv6uxdc4le37yqi3azfhawvlbmnzpvbmjmoiabx3wa"

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

export type ProfileEventOpts = {
  did?: string
  seq?: number
  rkey?: string
  rev?: string
  cid?: string
  time?: string
  /**
   * Merged over the default record, which always carries $type. An
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

export function profilePut(
  operation: "create" | "update",
  opts: ProfileEventOpts = {}
): RawEvent {
  return commitEvent({
    did: opts.did ?? DEFAULT_DID,
    seq: opts.seq ?? nextSeq(),
    time: opts.time ?? new Date().toISOString(),
    commit: {
      operation,
      collection: PROFILE_NSID,
      rkey: opts.rkey ?? "self",
      rev: opts.rev ?? DEFAULT_REV,
      cid: opts.cid ?? DEFAULT_CID,
      record: withoutUndefined({
        $type: PROFILE_NSID,
        displayName: "Harness User",
        description: "synthetic",
        createdAt: "2026-08-27T00:00:00.000Z",
        ...opts.record
      })
    }
  })
}

export const profileCreate = (opts: ProfileEventOpts = {}) =>
  profilePut("create", opts)
export const profileUpdate = (opts: ProfileEventOpts = {}) =>
  profilePut("update", opts)

export function profileDelete(
  opts: Omit<ProfileEventOpts, "record" | "cid"> = {}
): RawEvent {
  return commitEvent({
    did: opts.did ?? DEFAULT_DID,
    seq: opts.seq ?? nextSeq(),
    time: opts.time ?? new Date().toISOString(),
    commit: {
      operation: "delete",
      collection: PROFILE_NSID,
      rkey: opts.rkey ?? "self",
      rev: opts.rev ?? DEFAULT_REV
    }
  })
}

export function batch(events: RawEvent[]): EventBatch<RawEvent> {
  return { events, lastCursor: events[events.length - 1]?.seq ?? 0 }
}
