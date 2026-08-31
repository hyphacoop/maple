import { createHash } from "node:crypto"
import type { Firestore } from "firebase-admin/firestore"
import type { PdsClient } from "./agent.js"
import type { RecordType } from "./records.js"
import { readState, writeState } from "./state.js"

export type PublishResult =
  | { status: "published"; uri: string; cid: string }
  | { status: "unchanged" }
  | { status: "invalid"; message: string }
  | { status: "unmappable"; message: string }

/** Deterministic serialisation: object key order must not affect the hash, or
 * an unrelated Firestore field reordering would look like a content change. */
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stable((v as any)[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(v) ?? "null"
}

/**
 * Content hash of a record, deliberately EXCLUDING `fetchedAt`.
 *
 * functions/src/scraper.ts writes every bill with `merge: true` and a fresh
 * `fetchedAt: Timestamp.now()` on every pass, so all ~8000 bills fire the
 * trigger roughly daily whether or not anything about them changed. Hashing
 * `fetchedAt` would make every one of those a real publish: ~8000 no-op
 * commits a day on the firehose, each minting a new CID and so invalidating
 * every testimony strongRef pinned to the old one.
 *
 * The consequence, which is a real semantic choice and not an implementation
 * detail: a published record's `fetchedAt` is "the fetch at which this content
 * last changed", not "the last time we looked at it".
 */
export const recordHash = (record: object): string => {
  const { fetchedAt: _ignored, ...rest } = record as Record<string, unknown>
  return createHash("sha256").update(stable(rest)).digest("hex")
}

/** Why a document was not published. Excludes "published" so a caller
 * counting outcomes does not have to handle a case that cannot occur. */
export type PublishSkip = Exclude<PublishResult, { status: "published" }>

export type Prepared =
  | { publish: true; rkey: string; record: object; hash: string }
  | { publish: false; result: PublishSkip }

/**
 * Everything that decides WHETHER a document should be written to the PDS, in
 * one place: key it, map it, compare it to what we last published, validate it.
 *
 * Both callers need this and neither may drift from the other — the trigger
 * (publishDocument) and the backfill must agree about what is already on the
 * PDS, or the backfill silently republishes what the trigger skipped, or worse
 * skips what the trigger would have sent. The backfill reports counters rather
 * than statuses, so a divergence there is invisible.
 */
export async function prepare<D>(
  db: Firestore,
  type: RecordType<D>,
  doc: D,
  /** Backfill only: rkeys the repo already holds. A record missing from the
   * PDS must be republished even when our state says it is current — otherwise
   * a rebuilt or re-pointed PDS looks fully populated and gets nothing. */
  known?: ReadonlySet<string>
): Promise<Prepared> {
  const fail = (result: PublishSkip): Prepared => ({ publish: false, result })

  const rkey = type.rkey(doc)
  if (!rkey) return fail({ status: "unmappable", message: "no record key" })

  let record: object
  try {
    record = type.toRecord(doc)
  } catch (e) {
    return fail({
      status: "unmappable",
      message: e instanceof Error ? e.message : String(e)
    })
  }

  const hash = recordHash(record)
  if (known ? known.has(rkey) : true) {
    const previous = await readState(db, type.nsid, rkey)
    if (previous?.hash === hash) return fail({ status: "unchanged" })
  }

  // Validate before writing, never after. The PDS does structural checks only
  // for NSIDs it does not know, so it would happily store a record that our
  // own consumer then refuses to index — a silent hole in the pipeline.
  const validation = type.schema.safeValidate(record)
  if (!validation.success) {
    return fail({ status: "invalid", message: validation.message })
  }

  return { publish: true, rkey, record, hash }
}

export async function publishDocument<D>(
  db: Firestore,
  /** Deferred so an instance that only ever sees unchanged documents — the
   * overwhelmingly common case — never logs in to the PDS at all. */
  connect: () => Promise<Pick<PdsClient, "putRecord" | "did">>,
  type: RecordType<D>,
  doc: D
): Promise<PublishResult> {
  const prepared = await prepare(db, type, doc)
  if (!prepared.publish) return prepared.result

  const { rkey, record, hash } = prepared
  const client = await connect()
  const { uri, cid } = await client.putRecord(type.nsid, rkey, record)
  await writeState(db, client.did, {
    nsid: type.nsid,
    rkey,
    hash,
    uri,
    cid,
    publishedAt: new Date().toISOString()
  })
  return { status: "published", uri, cid }
}
