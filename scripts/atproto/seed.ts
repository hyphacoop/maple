/** Seeds the local ATProto dev network (#61): the authoritative maple.test
 * identity, alice.test/bob.test users, four real MA bills as
 * org.mapletestimony.bill records in the maple repo, and one bob testimony so
 * cross-user reads are demoable.
 *
 * Runs against an already-running `yarn atp:dev` network. Re-runnable:
 * accounts are login-or-create, records use deterministic rkeys so re-runs
 * are upserts.
 *
 *   yarn atp:seed
 *
 * NOTE: scripts/atproto is excluded from the root tsconfig (see dev-env.ts);
 * ts-node --swc is transpile-only, so keep components/db/* imports type-only.
 */
import { AtpAgent, AtUri, ComAtprotoRepoStrongRef } from "@atproto/api"
import { Timestamp } from "firebase/firestore"
import {
  billNsid,
  recordRkey,
  testimonyNsid
} from "components/atproto/lexicons"
import { billToRecord, testimonyToRecord } from "components/atproto/mappers"
import { currentGeneralCourt } from "functions/src/shared"
import { defaultPdsUrl } from "./ports"
import { bobTestimonyContent, seedBills, testimonyBillId } from "./seed-data"

const pdsUrl = process.env.ATP_PDS_URL ?? defaultPdsUrl

const accounts = [
  { handle: "maple.test", password: "maple-pass" },
  { handle: "alice.test", password: "alice-pass" },
  { handle: "bob.test", password: "bob-pass" }
]

/** Login if the account exists on the (throwaway, restart-empty) dev PDS,
 * create it otherwise. */
async function upsertAccount(handle: string, password: string) {
  const agent = new AtpAgent({ service: pdsUrl })
  try {
    await agent.login({ identifier: handle, password })
    console.log(`login: ${handle} → ${agent.session!.did}`)
  } catch {
    await agent.createAccount({
      handle,
      email: `${handle.replace(".test", "")}@test.invalid`,
      password
    })
    console.log(`createAccount: ${handle} → ${agent.session!.did}`)
  }
  return agent
}

async function main() {
  // Fail fast with a pointer to atp:dev rather than timing out per-request.
  try {
    await new AtpAgent({ service: pdsUrl }).com.atproto.server.describeServer()
  } catch {
    throw new Error(
      `No PDS reachable at ${pdsUrl} — run \`yarn atp:dev\` first (or set ATP_PDS_URL).`
    )
  }

  const [maple, , bob] = await Promise.all(
    accounts.map(a => upsertAccount(a.handle, a.password))
  )
  const mapleDid = maple.session!.did

  let testimonyBillRef: ComAtprotoRepoStrongRef.Main | undefined
  for (const bill of seedBills) {
    const rkey = recordRkey(bill.court, bill.id)
    const res = await maple.com.atproto.repo.putRecord({
      repo: mapleDid,
      collection: billNsid,
      rkey,
      record: billToRecord(bill)
    })
    if (bill.id === testimonyBillId)
      testimonyBillRef = { uri: res.data.uri, cid: res.data.cid }
    console.log(`bill: ${rkey} → ${res.data.uri}`)
  }

  const rkey = recordRkey(currentGeneralCourt, testimonyBillId)
  // Unlike the fixtures' placeholder, this strongRef carries the real cid of
  // the bill record just written — the testimony pins the bill version seen.
  const res = await bob.com.atproto.repo.putRecord({
    repo: bob.session!.did,
    collection: testimonyNsid,
    rkey,
    record: testimonyToRecord(
      {
        billId: testimonyBillId,
        court: currentGeneralCourt,
        position: "endorse",
        content: bobTestimonyContent,
        publishedAt: Timestamp.fromDate(new Date("2026-07-28T12:00:00Z"))
      },
      testimonyBillRef!
    )
  })
  console.log(`testimony (bob): ${rkey} → ${res.data.uri}`)

  // Verify the AC directly: listRecords on the maple repo shows the bills.
  const listed = await maple.com.atproto.repo.listRecords({
    repo: mapleDid,
    collection: billNsid,
    limit: 100
  })
  const listedRkeys = new Set(
    listed.data.records.map(r => new AtUri(r.uri).rkey)
  )
  const missing = seedBills.filter(
    b => !listedRkeys.has(recordRkey(b.court, b.id))
  )
  if (missing.length > 0)
    throw new Error(
      `listRecords is missing seeded bills: ${missing
        .map(b => b.id)
        .join(", ")}`
    )
  console.log(
    `verified: ${listed.data.records.length} bill records in maple repo`
  )

  console.log(`
Seed complete. Add to .env.local:

  NEXT_PUBLIC_ATP_PDS_URL=${pdsUrl}
  NEXT_PUBLIC_MAPLE_DID=${mapleDid}

Users (password = "<name>-pass"): ${accounts.map(a => a.handle).join(", ")}
`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
