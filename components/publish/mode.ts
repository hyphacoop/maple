export type PublishMode = "bill" | "ballotQuestion" | "conference"

export const getPublishMode = (
  ballotQuestionId?: string,
  conferenceId?: string
): PublishMode =>
  ballotQuestionId ? "ballotQuestion" : conferenceId ? "conference" : "bill"

export const isBallotQuestionMode = (ballotQuestionId?: string) =>
  getPublishMode(ballotQuestionId) === "ballotQuestion"
