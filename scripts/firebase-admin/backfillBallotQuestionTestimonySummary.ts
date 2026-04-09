import { emptyBallotQuestionSummary } from "../../functions/src/ballotQuestions/summary"
import { BallotQuestionSummary } from "../../functions/src/ballotQuestions/types"
import { Script } from "./types"

export const script: Script = async ({ db }) => {
  const [ballotQuestionSnap, testimonySnap] = await Promise.all([
    db.collection("ballotQuestions").select().get(),
    db
      .collectionGroup("publishedTestimony")
      .select("ballotQuestionId", "position")
      .get()
  ])

  const summaries = new Map<string, BallotQuestionSummary>(
    ballotQuestionSnap.docs.map(doc => [
      doc.id,
      { ...emptyBallotQuestionSummary }
    ])
  )

  for (const doc of testimonySnap.docs) {
    const testimony = doc.data()
    const ballotQuestionId = testimony.ballotQuestionId
    if (typeof ballotQuestionId !== "string") continue

    const summary = summaries.get(ballotQuestionId)
    if (!summary) continue

    summary.testimonyCount += 1
    switch (testimony.position) {
      case "endorse":
        summary.endorseCount += 1
        break
      case "neutral":
        summary.neutralCount += 1
        break
      case "oppose":
        summary.opposeCount += 1
        break
    }
  }

  const batch = db.batch()
  for (const doc of ballotQuestionSnap.docs) {
    batch.update(doc.ref, summaries.get(doc.id) ?? emptyBallotQuestionSummary)
  }
  await batch.commit()

  console.log(
    `Backfilled testimony summaries for ${ballotQuestionSnap.size} ballot question(s).`
  )
}
