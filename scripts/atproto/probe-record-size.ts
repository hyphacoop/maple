/** One-shot probe: how large can an org.mapletestimony.* record be?
 *
 * Answered (see docs/atproto-spike-notes.md #61): the PDS caps the putRecord
 * JSON request body at exactly 153,600 bytes (150 KiB, the xrpc-server
 * jsonLimit) — HTTP 413 "request entity too large" above. It is a
 * transport-level check on the whole body (record + repo/collection/rkey
 * envelope), not a repo or lexicon error. This probe re-verifies the boundary
 * with a record on either side of it.
 *
 * Not part of any yarn script; run directly when needed:
 *   ts-node --swc -P tsconfig.script.json scripts/atproto/probe-record-size.ts
 */
import { AtpAgent } from "@atproto/api"
import { TestNetworkNoAppView } from "@atproto/dev-env"
import { billNsid } from "components/atproto/lexicons"
import { PDS_PORT, PLC_PORT } from "./ports"

async function main() {
  const network = await TestNetworkNoAppView.create({
    pds: { port: PDS_PORT },
    plc: { port: PLC_PORT }
  })
  try {
    const agent = new AtpAgent({ service: network.pds.url })
    await agent.createAccount({
      handle: "alice.test",
      email: "alice@test.invalid",
      password: "password"
    })
    // The PDS only does data-model validation for unknown NSIDs (see
    // probe-putrecord.ts), so a bare summary-only record is accepted.
    for (const bytes of [150_000, 160_000]) {
      const record = { $type: billNsid, summary: "x".repeat(bytes) }
      try {
        await agent.com.atproto.repo.putRecord({
          repo: agent.session!.did,
          collection: billNsid,
          rkey: "probe-oversize",
          record
        })
        console.log(`~${bytes / 1000}KB record: accepted`)
      } catch (err) {
        console.log(`~${bytes / 1000}KB record: rejected (${err})`)
      }
    }
  } finally {
    await network.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
