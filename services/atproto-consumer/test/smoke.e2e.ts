import assert from "node:assert/strict"
import { before, test } from "node:test"
import { billRecord } from "../src/records.js"
import { uriFor } from "./events.js"
import { assertIndexedAt, expectedBillDoc } from "./expected.js"
import {
  harnessDb,
  harnessEnv,
  seedBill,
  session,
  waitForDoc,
  type HarnessEnv,
  type SeededBill
} from "./pds.js"

/**
 * The end-to-end acceptance test for the local harness:
 *
 *   PDS -> relay -> jetstream -> services/atproto-consumer -> Firestore emulator
 *
 * This replaces infra/atproto/seed.sh + check.sh. It is NOT part of `yarn test`
 * -- the .e2e.ts suffix keeps it out of that glob deliberately, because it
 * needs a live stack, which the emulator-only CI job does not have. Run it with
 * `yarn test:smoke` against a harness brought up by infra/atproto/bootstrap.sh,
 * with the consumer running. The same command serves CI and a local stack.
 *
 * Assertions are named leg by leg, as check.sh's were, so a failure still says
 * which hop broke rather than only that the record never arrived.
 *
 * There is no teardown: the record is an upsert at a fixed rkey and the stack
 * belongs to bootstrap.sh, so a run leaves nothing behind to clean up.
 */

const DOC_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 60_000)

const DC =
  "docker compose --env-file infra/atproto/images.env" +
  " --env-file infra/atproto/endpoints.env -f infra/atproto/compose.yml"
const RELAY_LOGS = `  ${DC} logs relay`

let env: HarnessEnv
let seeded: SeededBill

before(async () => {
  env = harnessEnv()
  console.log(
    `[smoke] pds=${env.pdsUrl} relay=${env.relayUrl} jetstream=${env.jetstreamUrl} ` +
      `project=${env.projectId} emulator=${env.firestoreHost}`
  )
})

test("leg 1-2: the relay knows the seeded repo", async () => {
  const agent = await session(env)

  // A refused connection throws out of fetch, so it is turned into a named
  // failure rather than left to surface as a bare "fetch failed".
  const res = await fetch(
    `${env.relayUrl}/xrpc/com.atproto.sync.listRepos?limit=100`
  ).catch((err: Error) =>
    assert.fail(
      `the relay at ${env.relayUrl} is unreachable (${err.message}) -- is the ` +
        `stack up?\n${RELAY_LOGS}`
    )
  )
  assert.ok(
    res.ok,
    `the relay answered listRepos with HTTP ${res.status}\n${RELAY_LOGS}`
  )
  const { repos } = (await res.json()) as { repos: { did: string }[] }

  assert.ok(
    repos.some(r => r.did === agent.did),
    `the relay does not know repo ${agent.did} -- the PDS -> relay leg is ` +
      `broken. Re-run infra/atproto/bootstrap.sh to re-register the host.\n${RELAY_LOGS}`
  )

  // Seeding happens here, after the relay is known good, so a failure above is
  // never confused for a delivery problem.
  seeded = await seedBill(agent)
  console.log(
    `[smoke] seeded ${seeded.collection}/${seeded.rkey} in ${seeded.did} cid=${seeded.cid}`
  )
})

test("leg 3-4: the record arrives in Firestore via jetstream and the consumer", async () => {
  assert.ok(seeded, "the seed step did not run; see the failure above")
  const db = harnessDb(env)

  // Matching on the cid is what makes this a real assertion: a document left by
  // an earlier run cannot pass for a fresh delivery.
  const data = await waitForDoc(
    db,
    seeded.docPath,
    d => d.atp?.cid === seeded.cid,
    DOC_TIMEOUT_MS,
    [
      `expected atp.cid=${seeded.cid}. In order:`,
      "  - is the consumer running, and against THIS jetstream?",
      `      JETSTREAM_URL=${env.jetstreamUrl} GCLOUD_PROJECT=${env.projectId} \\`,
      `        MAPLE_DIDS=${seeded.did} yarn --cwd services/atproto-consumer dev`,
      `  - is MAPLE_DIDS set to a DID other than ${seeded.did}? that filters this`,
      "    record out server-side and looks exactly like an idle stream.",
      "  - is it pointed at THIS emulator/project? a different GCLOUD_PROJECT writes",
      '    to a different emulator namespace and looks identical to "nothing arrived".',
      "  - did it resume from a stale cursor? a cursor left by a previous run of a",
      "    DIFFERENT jetstream is a meaningless seq here (jetstream sequence spaces",
      "    are per-host). Check atpJetstreamMeta in the emulator.",
      "  - is jetstream itself ingesting?",
      `      ${DC} logs jetstream`
    ].join("\n")
  )

  // The whole document, against the same expectation the unit test uses. The
  // unit test proves the mapper; this proves the mapper's output survives the
  // real wire path unchanged.
  const { atp, ...doc } = data
  assert.deepEqual(doc, expectedBillDoc(seeded.fetchedAt))

  const { indexedAt, seq, ...provenance } = atp
  assert.deepEqual(provenance, {
    did: seeded.did,
    uri: uriFor(seeded.did, billRecord.nsid, seeded.rkey),
    cid: seeded.cid
  })
  assertIndexedAt(indexedAt)
  // A real jetstream seq, unlike the unit tests' synthetic counter.
  assert.ok(
    typeof seq === "number" && seq > 0,
    `atp.seq should be a jetstream sequence number, got ${seq}`
  )

  console.log(
    `[smoke] PASS: a ${seeded.collection} record put on the local PDS arrived at ` +
      `${seeded.docPath} via PDS -> relay -> jetstream -> consumer. cid=${seeded.cid}`
  )
})
