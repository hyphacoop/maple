import path from "path"
import { testDb, terminateFirebase } from "../testUtils"
import { script } from "../../scripts/firebase-admin/syncBallotQuestions"

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/ballotQuestions")
const TEST_ID = "test-99-99"

afterAll(async () => {
  await testDb.collection("ballotQuestions").doc(TEST_ID).delete()
  await terminateFirebase()
})

it("syncs YAML files to Firestore", async () => {
  await script({
    db: testDb,
    args: { env: "local", argv: [], dir: FIXTURES_DIR }
  } as any)

  const snap = await testDb.collection("ballotQuestions").doc(TEST_ID).get()
  expect(snap.exists).toBe(true)
  expect(snap.data()?.billId).toBe("H5099")
  expect(snap.data()?.electionYear).toBe(2099)
  expect(snap.data()?.description).toBeTruthy()
  expect(snap.data()?.atAGlance).toBeInstanceOf(Array)
  expect(snap.data()?.pdfUrl).toMatch(/^https?:\/\//)
  expect(snap.data()?.fullSummary).toBeTruthy()
  expect(snap.data()?.testimonyCount).toBe(0)
  expect(snap.data()?.endorseCount).toBe(0)
  expect(snap.data()?.neutralCount).toBe(0)
  expect(snap.data()?.opposeCount).toBe(0)
})

it("preserves runtime-managed testimony counters when syncing YAML", async () => {
  await testDb.collection("ballotQuestions").doc(TEST_ID).set(
    {
      testimonyCount: 7,
      endorseCount: 4,
      neutralCount: 2,
      opposeCount: 1
    },
    { merge: true }
  )

  await script({
    db: testDb,
    args: { env: "local", argv: [], dir: FIXTURES_DIR }
  } as any)

  const snap = await testDb.collection("ballotQuestions").doc(TEST_ID).get()
  expect(snap.data()?.testimonyCount).toBe(7)
  expect(snap.data()?.endorseCount).toBe(4)
  expect(snap.data()?.neutralCount).toBe(2)
  expect(snap.data()?.opposeCount).toBe(1)
})

it("can query by electionYear", async () => {
  const results = await testDb
    .collection("ballotQuestions")
    .where("electionYear", "==", 2099)
    .get()
  expect(results.docs.length).toBeGreaterThanOrEqual(1)
  expect(results.docs[0].data().id).toBe(TEST_ID)
})
