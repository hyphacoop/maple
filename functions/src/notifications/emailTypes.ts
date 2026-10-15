import { Frequency } from "../auth/types"
import type { Position } from "../testimony/types"

export type BillDigest = {
  billId: string
  billName: string
  billCourt: string
  endorseCount: number
  neutralCount: number
  opposeCount: number
}
export type { Position }
export type BillResult = {
  billId: string
  court: string
  position: Position
  /** The bill page, or the conference page for conference testimony. */
  url: string
  /** Set for positions that have no image yet. */
  positionLabel?: string
}
export type UserDigest = {
  userId: string
  userName: string
  bills: BillResult[]
  newTestimonyCount: number // displayed bills are capped at 6
}
export type BallotQuestionDigest = {
  ballotQuestionId: string
  description: string
  endorseCount: number
  neutralCount: number
  opposeCount: number
}
export type NotificationEmailDigest = {
  notificationFrequency: Frequency
  startDate: Date
  endDate: Date
  bills: BillDigest[] // cap of 4
  numBillsWithNewTestimony: number
  users: UserDigest[] // cap of 4
  numUsersWithNewTestimony: number
  ballotQuestions: BallotQuestionDigest[] // cap of 4
  numBallotQuestionsWithNewTestimony: number
}
