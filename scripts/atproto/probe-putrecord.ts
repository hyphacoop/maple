/** One-shot probe: can we putRecord/getRecord org.mapletestimony.* records
 * against a real PDS, given the PDS has no knowledge of our lexicons?
 *
 * Answered (see docs/atproto-spike-notes.md #60): yes, with default
 * validation — the PDS does data-model validation only for unknown NSIDs.
 * This probe re-verifies that; do NOT add validate: false, which would also
 * disable structural validation.
 *
 * Not part of any yarn script; run directly when needed:
 *   ts-node --swc -P tsconfig.script.json scripts/atproto/probe-putrecord.ts
 */
import { AtpAgent } from "@atproto/api"
import { TestNetworkNoAppView } from "@atproto/dev-env"
import { testimonyToRecord } from "components/atproto/mappers"
import { testimonyNsid } from "components/atproto/lexicons"
import { sampleBillRef, sampleRkey, sampleTestimony } from "./fixtures"
import { PDS_PORT, PLC_PORT } from "./ports"

async function main() {
  const network = await TestNetworkNoAppView.create({
    pds: { port: PDS_PORT },
    plc: { port: PLC_PORT }
  })
  try {
    const agent = new AtpAgent({ service: network.pds.url })
    const { data: account } = await agent.createAccount({
      handle: "alice.test",
      email: "alice@test.invalid",
      password: "password"
    })
    console.log(`account: ${account.did}`)

    const record = testimonyToRecord(
      { ...sampleTestimony, authorUid: account.did },
      sampleBillRef(account.did)
    )
    const res = await agent.com.atproto.repo.putRecord({
      repo: account.did,
      collection: testimonyNsid,
      rkey: sampleRkey,
      record
    })
    console.log(`putRecord (default validate): OK ${res.data.uri}`)

    const got = await agent.com.atproto.repo.getRecord({
      repo: account.did,
      collection: testimonyNsid,
      rkey: sampleRkey
    })
    console.log(`getRecord: OK cid=${got.data.cid}`)
    console.log(JSON.stringify(got.data.value, null, 2))
  } finally {
    await network.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
