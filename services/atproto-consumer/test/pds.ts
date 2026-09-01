import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { AtpAgent } from "@atproto/api"
import { currentDatetimeString } from "@atproto/lex"
import type { Firestore } from "firebase-admin/firestore"
import { initFirestore } from "../src/db.js"
import { bill } from "../src/lexicons/org/mapletestimony.js"
import { billRecord, type BillRecord } from "../src/records.js"
import { BILL_RKEY, billFixture } from "./events.js"

/**
 * Talking to a live local harness: PDS session, record seeding, and the
 * Firestore poll that proves a record completed the trip.
 *
 * Shared by test/smoke.e2e.ts (seed then assert, in one process) and
 * scripts/seed.ts (seed only, for infra/atproto/recovery.sh, which seeds while
 * jetstream or the relay is deliberately dead and must not assert).
 *
 * This replaces infra/atproto/seed.sh and check.sh. Those spelled the rkey and
 * the Firestore document path out by hand -- seed.sh said in a comment that it
 * did so only to keep a node dependency out of a curl+python3 script. Here the
 * conventions are imported, so a rename in src/records.ts cannot leave the
 * harness quietly asserting against the wrong path.
 */

/** The harness directory, shared with scripts/seed.ts so the relative depth
 * out of this package is written down once. */
export const HARNESS_DIR = new URL("../../../infra/atproto/", import.meta.url)

export interface HarnessEnv {
  pdsUrl: string
  relayUrl: string
  jetstreamUrl: string
  projectId: string
  firestoreHost: string
  handle: string
  email: string
  password: string
}

/**
 * The harness's boundary values, read from the same infra/atproto/endpoints.env
 * that compose.yml interpolates and lib.sh sources -- so `yarn test:smoke` needs
 * no arguments and means the same thing in CI (after bootstrap.sh) as it does
 * against a stack already up locally. An already-set process.env wins, matching
 * lib.sh's JETSTREAM_URL override.
 *
 * images.env is deliberately not read: it holds image pins, nothing a client
 * needs.
 */
export function harnessEnv(): HarnessEnv {
  const file = readFileSync(new URL("endpoints.env", HARNESS_DIR), "utf8")
  const vars = new Map<string, string>()
  for (const line of file.split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m) vars.set(m[1], m[2])
  }
  const get = (key: string): string => {
    const value = process.env[key] || vars.get(key)
    if (!value)
      throw new Error(
        `${key} is set neither in the environment nor in infra/atproto/endpoints.env`
      )
    return value
  }
  // `<NAME>_URL` wins over the port, mirroring lib.sh's JETSTREAM_URL override.
  const url = (name: string) =>
    process.env[`${name}_URL`] || `http://localhost:${get(`${name}_PORT`)}`
  return {
    pdsUrl: url("PDS"),
    relayUrl: url("RELAY"),
    jetstreamUrl: url("JETSTREAM"),
    projectId: get("GCLOUD_PROJECT"),
    firestoreHost: get("FIRESTORE_EMULATOR_HOST"),
    handle: get("HANDLE"),
    email: get("ACCOUNT_EMAIL"),
    password: get("ACCOUNT_PASSWORD")
  }
}

/** Emulator-pinned Firestore handle for the harness project. Set the host
 * before firebase-admin initializes, the way src/index.ts does, so a missing
 * value can never resolve to a real project. */
export function harnessDb(env: HarnessEnv): Firestore {
  process.env.FIRESTORE_EMULATOR_HOST ??= env.firestoreHost
  return initFirestore(env.projectId)
}

/**
 * A logged-in agent for the harness account, creating it if this is the first
 * run against a fresh PDS volume. bootstrap.sh normally creates the account
 * (the consumer needs the DID for MAPLE_DIDS before it can start), so login is
 * the usual path; createAccount is here so the seeder still works standalone.
 */
export async function session(env: HarnessEnv): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: env.pdsUrl })
  try {
    await agent.login({ identifier: env.handle, password: env.password })
  } catch (loginErr) {
    try {
      await agent.createAccount({
        email: env.email,
        handle: env.handle,
        password: env.password
      })
    } catch {
      // Report the login failure, not the createAccount one: on a stack that
      // bootstrap.sh has already set up, login is the path that matters and
      // its error (bad password, PDS down) is the one that explains the run.
      throw new Error(
        `could not log in to ${env.pdsUrl} as ${env.handle}, and creating the ` +
          `account failed too: ${(loginErr as Error).message}. ` +
          "Has infra/atproto/bootstrap.sh run?"
      )
    }
  }
  if (!agent.did) throw new Error(`no DID in the session from ${env.pdsUrl}`)
  return agent
}

export interface SeededBill {
  did: string
  cid: string
  collection: string
  rkey: string
  /** Where the consumer is expected to index it. */
  docPath: string
  /** The exact ISO value stamped into the record, for the doc assertion. */
  fetchedAt: string
}

/**
 * Put one org.mapletestimony.bill on the PDS.
 *
 * The record is the consumer's own fixture -- the same file the lexicon
 * validator checks and the unit tests build events from -- with fetchedAt
 * stamped to now. One source of truth for "a valid MAPLE bill", and a fresh
 * fetchedAt gives every seed a distinct cid, which is what lets an assertion
 * tell a new delivery from a document an earlier run left behind.
 *
 * `previousCid` closes the hole seed.sh left open: identical content yields an
 * identical cid, so a seed that somehow reproduced the last one would make
 * every later assertion pass vacuously against the stale document.
 */
export async function seedBill(
  agent: AtpAgent,
  previousCid?: string
): Promise<SeededBill> {
  const did = agent.did
  assert.ok(did, "agent has no DID; call session() first")

  const fetchedAt = currentDatetimeString()
  // $build validates against the generated lexicon and brands the datetime, so
  // a fixture that has drifted out of schema fails here rather than as a record
  // the PDS accepts and the consumer then silently skips.
  const record: BillRecord = bill.$build({ ...billFixture, fetchedAt })

  const { data } = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: billRecord.nsid,
    rkey: BILL_RKEY,
    record
  })

  assert.ok(data.cid, "putRecord returned no cid")
  assert.notEqual(
    data.cid,
    previousCid,
    `putRecord returned the previous cid (${data.cid}) -- the record did not ` +
      `change, so any later assertion would pass against the stale document`
  )

  return {
    did,
    cid: data.cid,
    collection: billRecord.nsid,
    rkey: BILL_RKEY,
    docPath: `${billRecord.collection}/${billRecord.docId(record)}`,
    fetchedAt
  }
}

/**
 * Poll a document until it satisfies `matches`, or throw with `hint`.
 *
 * Firestore's onSnapshot would be tidier, but the emulator holds the listener
 * open past the deadline; polling keeps the timeout honest.
 */
export async function waitForDoc(
  db: Firestore,
  path: string,
  matches: (data: FirebaseFirestore.DocumentData) => boolean,
  timeoutMs: number,
  hint: string
): Promise<FirebaseFirestore.DocumentData> {
  const ref = db.doc(path)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const data = (await ref.get()).data()
    if (data && matches(data)) return data
    if (Date.now() >= deadline)
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${path}\n` +
          (data
            ? "a document IS present but does not match -- an older run left it there; that is not a pass\n"
            : "no document at that path at all\n") +
          hint
      )
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}
