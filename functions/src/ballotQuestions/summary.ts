import { DocumentSnapshot } from "@google-cloud/firestore"
import { BallotQuestionSummary } from "./types"

export const emptyBallotQuestionSummary: BallotQuestionSummary = {
  testimonyCount: 0,
  endorseCount: 0,
  neutralCount: 0,
  opposeCount: 0
}

export function getBallotQuestionSummary(
  snap: DocumentSnapshot
): BallotQuestionSummary {
  const data = snap.data() ?? {}
  return {
    testimonyCount: data.testimonyCount ?? 0,
    endorseCount: data.endorseCount ?? 0,
    neutralCount: data.neutralCount ?? 0,
    opposeCount: data.opposeCount ?? 0
  }
}
