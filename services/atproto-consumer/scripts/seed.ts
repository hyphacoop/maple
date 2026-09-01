import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { HARNESS_DIR, harnessEnv, seedBill, session } from "../test/pds.js"

/**
 * Seed one bill record onto the local PDS and record what was written.
 *
 * The seed half of what used to be infra/atproto/seed.sh, kept as a standalone
 * entry point for infra/atproto/recovery.sh: its scenarios seed repeatedly
 * while jetstream or the relay is deliberately stopped, so they need the write
 * without the assertions that test:smoke makes. The record building itself is
 * shared with the smoke test -- one implementation, one set of conventions.
 *
 *   yarn --cwd services/atproto-consumer seed
 *
 * .harness-state is written in the KEY=value form lib.sh sources, and only
 * AFTER the cid is confirmed: a state file written early would leave a stale
 * CID behind on a failed seed and every later assertion would pass vacuously.
 */

const STATE_FILE = fileURLToPath(new URL(".harness-state", HARNESS_DIR))

async function main() {
  const env = harnessEnv()
  const agent = await session(env)
  const seeded = await seedBill(agent, process.env.PREVIOUS_CID || undefined)

  writeFileSync(
    STATE_FILE,
    [
      `DID=${seeded.did}`,
      `CID=${seeded.cid}`,
      `COLLECTION=${seeded.collection}`,
      `RKEY=${seeded.rkey}`,
      `DOC_PATH=${seeded.docPath}`,
      ""
    ].join("\n")
  )
  console.log(
    `seeded ${seeded.collection}/${seeded.rkey} in ${seeded.did} cid=${seeded.cid}`
  )
}

main().catch(err => {
  console.error(`seed failed: ${err.message}`)
  process.exit(1)
})
