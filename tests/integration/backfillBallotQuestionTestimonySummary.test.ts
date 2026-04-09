import { testDb, terminateFirebase } from "../testUtils"
import { script } from "../../scripts/firebase-admin/backfillBallotQuestionTestimonySummary"

const BQ_1 = "bq-summary-1"
const BQ_2 = "bq-summary-2"

afterAll(async () => {
  await Promise.all([
    testDb.collection("ballotQuestions").doc(BQ_1).delete(),
    testDb.collection("ballotQuestions").doc(BQ_2).delete(),
    testDb.doc("users/bq-summary-user/publishedTestimony/endorse").delete(),
    testDb.doc("users/bq-summary-user/publishedTestimony/neutral").delete(),
    testDb.doc("users/bq-summary-user/publishedTestimony/oppose").delete(),
    testDb.doc("users/bq-summary-user/publishedTestimony/regular").delete()
  ])
  await terminateFirebase()
})

it("backfills ballot question testimony summary counters", async () => {
  await Promise.all([
    testDb.collection("ballotQuestions").doc(BQ_1).set({
      id: BQ_1,
      testimonyCount: 99,
      endorseCount: 99,
      neutralCount: 99,
      opposeCount: 99
    }),
    testDb.collection("ballotQuestions").doc(BQ_2).set({ id: BQ_2 }),
    testDb.doc("users/bq-summary-user/publishedTestimony/endorse").set({
      ballotQuestionId: BQ_1,
      position: "endorse"
    }),
    testDb.doc("users/bq-summary-user/publishedTestimony/neutral").set({
      ballotQuestionId: BQ_1,
      position: "neutral"
    }),
    testDb.doc("users/bq-summary-user/publishedTestimony/oppose").set({
      ballotQuestionId: BQ_2,
      position: "oppose"
    }),
    testDb.doc("users/bq-summary-user/publishedTestimony/regular").set({
      ballotQuestionId: null,
      position: "endorse"
    })
  ])

  await script({ db: testDb, args: { env: "local", argv: [] } } as any)

  const bq1 = await testDb.collection("ballotQuestions").doc(BQ_1).get()
  const bq2 = await testDb.collection("ballotQuestions").doc(BQ_2).get()

  expect(bq1.data()).toMatchObject({
    testimonyCount: 2,
    endorseCount: 1,
    neutralCount: 1,
    opposeCount: 0
  })
  expect(bq2.data()).toMatchObject({
    testimonyCount: 1,
    endorseCount: 0,
    neutralCount: 0,
    opposeCount: 1
  })
})
