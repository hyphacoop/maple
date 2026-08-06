// NOTE: scripts/atproto is excluded from the root tsconfig: @atproto/pds ships
// .d.ts files that don't parse under the repo's TypeScript 5.3.3 (and
// skipLibCheck does not suppress syntax errors). ts-node --swc is
// transpile-only, so this script still runs fine.
import { TestNetworkNoAppView } from "@atproto/dev-env"
import { PDS_PORT, PLC_PORT } from "./ports"

async function main() {
  console.log("Booting local ATProto network (in-process PLC + PDS, SQLite)...")

  const network = await TestNetworkNoAppView.create({
    plc: { port: PLC_PORT },
    pds: { port: PDS_PORT }
  })

  console.log(`
ATProto dev network ready

  PDS: ${network.pds.url}
  PLC: ${network.plc.url}

Smoke check:
  curl ${network.pds.url}/xrpc/com.atproto.server.describeServer

Create an account (handles must end in .test; no invite code needed):
  curl -X POST ${network.pds.url}/xrpc/com.atproto.server.createAccount \\
    -H 'Content-Type: application/json' \\
    -d '{"handle":"alice.test","email":"alice@test.com","password":"alice-pass"}'

Admin password: admin-pass
Data is throwaway (SQLite + blobs under your OS temp dir).
Press Ctrl+C to stop.
`)

  const shutdown = async () => {
    console.log("\nShutting down ATProto dev network...")
    await network.close()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // The listening HTTP servers keep the event loop alive; this makes it explicit.
  await new Promise(() => {})
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
