/** PDS fetch helpers for the /atp pages: unauthenticated reads (getRecord /
 * listRecords, usable server- or client-side) and the authenticated testimony
 * write. Reads are mapped to the app's Bill type where a caller wants one.
 *
 * The PDS returns record values untyped and does not enforce our lexicon for
 * unknown NSIDs (see docs/atproto-spike-notes.md #60), so the casts here are
 * on trust — production reads would validate with @atproto/lexicon first.
 */
import { AtpAgent, ComAtprotoRepoStrongRef, XRPCError } from "@atproto/api"
import type { Bill } from "../db/bills"
import type { Testimony } from "../db/testimony"
import { atpServiceUrl } from "./auth"
import {
  billNsid,
  MapleBillRecord,
  MapleTestimonyRecord,
  recordRkey,
  testimonyNsid
} from "./lexicons"
import { billFromRecord, testimonyToRecord } from "./mappers"

/** DID of the repo holding the authoritative bill records. Nothing in the
 * protocol marks a repo as "the" bill source, so it is pinned via config; the
 * seed script prints the value, which changes on every atp:dev restart. */
export const mapleDid = process.env.NEXT_PUBLIC_MAPLE_DID

const readAgent = () => new AtpAgent({ service: atpServiceUrl })

/** Missing record and missing repo both surface as XRPC InvalidRequest (400);
 * transport failures (dead PDS) have other statuses and should stay loud. */
const isMissing = (err: unknown) =>
  err instanceof XRPCError && err.status === 400

/** Resolves null when the record (or the whole repo) doesn't exist. */
export async function getAtpBill(
  repo: string,
  court: number,
  billId: string
): Promise<Bill | null> {
  try {
    const res = await readAgent().com.atproto.repo.getRecord({
      repo,
      collection: billNsid,
      rkey: recordRkey(court, billId)
    })
    return billFromRecord(res.data.value as MapleBillRecord)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

/** Resolves null when the repo doesn't exist — the stale-DID case after a PDS
 * restart, which callers should present as a setup problem, not missing data.
 * No cursor loop: the spike repo holds a handful of records. */
export async function listAtpBills(repo: string): Promise<Bill[] | null> {
  try {
    const res = await readAgent().com.atproto.repo.listRecords({
      repo,
      collection: billNsid,
      limit: 100
    })
    return res.data.records.map(r => billFromRecord(r.value as MapleBillRecord))
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

/** StrongRef of a bill record, fetched fresh at call time so testimony pins
 * the bill version currently in the repo. Null when the record is missing. */
export async function getAtpBillRef(
  repo: string,
  court: number,
  billId: string
): Promise<ComAtprotoRepoStrongRef.Main | null> {
  try {
    const res = await readAgent().com.atproto.repo.getRecord({
      repo,
      collection: billNsid,
      rkey: recordRkey(court, billId)
    })
    if (!res.data.cid)
      throw new Error(`PDS returned no cid for ${res.data.uri}`)
    return { uri: res.data.uri, cid: res.data.cid }
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export interface AtpTestimonyRecordRef {
  value: MapleTestimonyRecord
  uri: string
  cid: string
}

/** A repo's testimony record for a bill (testimony rkeys are deterministic,
 * so this is "the user's testimony on this bill"). Null when missing. */
export async function getAtpTestimony(
  repo: string,
  court: number,
  billId: string
): Promise<AtpTestimonyRecordRef | null> {
  try {
    const res = await readAgent().com.atproto.repo.getRecord({
      repo,
      collection: testimonyNsid,
      rkey: recordRkey(court, billId)
    })
    if (!res.data.cid)
      throw new Error(`PDS returned no cid for ${res.data.uri}`)
    return {
      value: res.data.value as MapleTestimonyRecord,
      uri: res.data.uri,
      cid: res.data.cid
    }
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

/** Publishes testimony into the signed-in user's own repo. The deterministic
 * rkey makes a resubmit an edit-in-place upsert of the same record. Uses the
 * PDS's default validation — for our unknown-to-it lexicon that is structural
 * checking only, and `validate: false` would disable even that (notes #60). */
export async function putAtpTestimony(
  agent: AtpAgent,
  billRepo: string,
  input: Pick<
    Testimony,
    "court" | "billId" | "position" | "content" | "publishedAt"
  >
): Promise<ComAtprotoRepoStrongRef.Main> {
  const did = agent.session?.did
  if (!did) throw new Error("Not signed in to the PDS")
  const bill = await getAtpBillRef(billRepo, input.court, input.billId)
  if (!bill)
    throw new Error(
      `Bill record ${input.court}-${input.billId} not found in ${billRepo} — ` +
        "if the PDS was restarted, re-run yarn atp:seed and update " +
        "NEXT_PUBLIC_MAPLE_DID"
    )
  const res = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: testimonyNsid,
    rkey: recordRkey(input.court, input.billId),
    record: testimonyToRecord(input, bill)
  })
  return { uri: res.data.uri, cid: res.data.cid }
}
