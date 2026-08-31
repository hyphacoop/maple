import assert from "node:assert/strict"
import { setTimeout as sleep } from "node:timers/promises"
import type { DocumentData, DocumentReference } from "firebase-admin/firestore"
import { Timestamp } from "firebase-admin/firestore"
import { initFirestore } from "../src/db.js"
import { billRkey } from "../src/records.js"
import { billDoc, hearingDoc } from "../test/fixtures.js"

/**
 * Drives the end-to-end check. Run by infra/atproto/publish-check.sh inside a
 * `firebase emulators:exec`, with the consumer already running against the
 * same emulator and the same jetstream as the harness.
 *
 * It writes bill and hearing documents exactly as the scraper would — the very
 * fixtures the unit tests use, so the two cannot disagree about the shape —
 * then waits for them to come back around the whole loop:
 *
 *   Firestore -> publish trigger -> PDS -> relay -> jetstream
 *             -> atproto-consumer -> Firestore
 *
 * and asserts the property the diff exists for: re-scraping a bill whose
 * content did not change must NOT produce a new commit.
 */

const project = process.env.GCLOUD_PROJECT ?? "demo-atp-local"
const ARRIVE_TIMEOUT_MS = Number(process.env.E2E_ARRIVE_TIMEOUT_MS ?? 120_000)
/** How long to wait before believing a commit did NOT happen. Generous: a
 * false pass here would be the worst outcome the check can produce. One wait
 * covers both absence proofs below — they are independent documents, so there
 * is no reason to spend it twice. */
const SETTLE_MS = Number(process.env.E2E_SETTLE_MS ?? 30_000)

const db = initFirestore(project)

const doc = billDoc()
const hearing = hearingDoc()
const COURT = doc.court as number
const BILL_ID = doc.id as string
const source = db.doc(`/generalCourts/${COURT}/bills/${BILL_ID}`)
const shadow = db.doc(`atpBills/${billRkey(COURT, BILL_ID)}`)

async function waitFor(
  ref: DocumentReference,
  matches: (data: DocumentData) => boolean,
  what: string
): Promise<string> {
  const deadline = Date.now() + ARRIVE_TIMEOUT_MS
  process.stdout.write(`waiting for ${what} at ${ref.path} `)
  while (Date.now() < deadline) {
    const data = (await ref.get()).data()
    if (data && matches(data) && data.atp?.cid) {
      process.stdout.write(` arrived\n`)
      return data.atp.cid as string
    }
    process.stdout.write(".")
    await sleep(2000)
  }
  process.stdout.write(" TIMED OUT\n")
  throw new Error(
    `${ref.path} never showed ${what}.\n` +
      `  - is the consumer running against THIS emulator ` +
      `(${process.env.FIRESTORE_EMULATOR_HOST}) and project ${project}?\n` +
      `  - is MAPLE_DIDS the DID in infra/atproto/.harness-state?\n` +
      `  - did the trigger fire? check the functions emulator log above.`
  )
}

const stamp = Date.now()
const first = `e2e published content ${stamp}`
const revised = `e2e revised content ${stamp}`

console.log(`\n== 1. publish a freshly scraped bill ==`)
await source.set({ ...doc, summary: first, fetchedAt: Timestamp.now() })
const cidA = await waitFor(shadow, d => d.summary === first, `"${first}"`)
console.log(`   cid A = ${cidA}`)

console.log(`\n== 2. two things that must produce NO commit ==`)
console.log(
  `   a re-scrape moving only fetchedAt — what the scraper does daily`
)
await source.update({ fetchedAt: Timestamp.now() })

// Deliberately hearing-SHAPED, differing only in `type`. A document that could
// not map would pass this check even with the filter removed, and so prove
// nothing.
const decoyId = 999_999
const decoyShadow = db.doc(`atpHearings/hearing-${decoyId}`)
console.log(`   a /events document of type "session"`)
await db.doc(`/events/session-${decoyId}`).set({
  ...hearing,
  id: `session-${decoyId}`,
  type: "session",
  content: { ...hearing.content, EventId: decoyId },
  fetchedAt: Timestamp.now()
})

console.log(
  `   settling for ${SETTLE_MS / 1000}s to see whether either commits...`
)
await sleep(SETTLE_MS)

assert.equal(
  (await shadow.get()).data()?.atp?.cid,
  cidA,
  `a fetchedAt-only re-scrape produced a NEW commit. That is ~8000 needless ` +
    `commits a day and invalidates every testimony strongRef.`
)
assert.equal(
  (await decoyShadow.get()).exists,
  false,
  `a type="session" document was published as a hearing (${decoyShadow.path} exists)`
)
console.log(`   neither committed. Correct.`)

console.log(`\n== 3. change real content ==`)
await source.update({ summary: revised, fetchedAt: Timestamp.now() })
const cidB = await waitFor(shadow, d => d.summary === revised, `"${revised}"`)
assert.notEqual(
  cidB,
  cidA,
  "a real content change did not produce a new commit"
)
console.log(`   cid B = ${cidB}`)

console.log(`\n== 4. publish a hearing ==`)
const hearingId = hearing.content.EventId as number
const hearingMark = `e2e hearing ${stamp}`
await db.doc(`/events/hearing-${hearingId}`).set({
  ...hearing,
  content: { ...hearing.content, Description: hearingMark },
  fetchedAt: Timestamp.now()
})
await waitFor(
  db.doc(`atpHearings/hearing-${hearingId}`),
  d => d.content?.Description === hearingMark,
  `"${hearingMark}"`
)

console.log(`
PASS: scraped bill AND hearing documents travelled
  Firestore -> publish trigger -> PDS -> relay -> jetstream -> consumer -> Firestore
a fetchedAt-only re-scrape produced no commit at all, and a non-hearing
/events document was left alone.`)
