import { Role } from "components/auth"
import { Timestamp } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import {
  Array,
  Boolean,
  InstanceOf,
  Literal as L,
  Number,
  Optional,
  Record as R,
  Static,
  String,
  Union
} from "runtypes"
import { functions } from "../../firebase"
import { Id, Maybe } from "../common"
import type * as report from "functions/src/testimony/resolveReport"

export const maxTestimonyLength = 10_000

/** Whether a bill should pass. */
export const BillPosition = Union(L("endorse"), L("oppose"), L("neutral"))
export type BillPosition = Static<typeof BillPosition>
/** Which version a committee of conference should report, if any. */
export const ConferencePosition = Union(
  L("passNothing"),
  L("passSomething"),
  L("passSenateVersion"),
  L("passHouseVersion")
)
export type ConferencePosition = Static<typeof ConferencePosition>
export const Position = Union(BillPosition, ConferencePosition)
export type Position = Static<typeof Position>

/** The positions a testimony may take: conference testimony takes a
 * conference position, all other testimony a bill position. */
export const positionsFor = (conferenceId?: string | null) =>
  conferenceId ? ConferencePosition : BillPosition

export const positionMatchesTarget = ({
  position,
  conferenceId
}: {
  position: Position
  conferenceId?: string | null
}) =>
  positionsFor(conferenceId).guard(position) ||
  (conferenceId
    ? "Conference testimony takes a conference position"
    : "Bill testimony takes a bill position")

export const Content = String.withConstraint(
  s => s.length > 0 || "Content is empty"
).withConstraint(s => s.length < maxTestimonyLength || "Content is too long")
export type Content = Static<typeof Content>

export const BaseTestimony = R({
  billId: String,
  court: Number,
  position: Position,
  content: Content,
  attachmentId: Maybe(String),
  editReason: Maybe(String),
  ballotQuestionId: Maybe(String),
  conferenceId: Maybe(String)
})
export type BaseTestimony = Static<typeof BaseTestimony>

export type Testimony = Static<typeof Testimony>
export const Testimony = BaseTestimony.extend({
  authorUid: Id,
  id: Id,
  authorDisplayName: String,
  authorRole: Role,
  billTitle: String,
  version: Number,
  public: Boolean,
  publishedAt: InstanceOf(Timestamp),
  updatedAt: InstanceOf(Timestamp),
  representativeId: Optional(String),
  senatorId: Optional(String),
  senatorDistrict: Optional(String),
  representativeDistrict: Optional(String),
  draftAttachmentId: Maybe(String),
  fullName: String
})

export type WorkingDraft = Partial<DraftTestimony>
export type DraftTestimony = Static<typeof DraftTestimony>
export const DraftTestimony = BaseTestimony.extend({
  publishedVersion: Optional(Number),
  /** If present, array of legislator member codes */
  recipientMemberCodes: Maybe(Array(String))
}).withConstraint(positionMatchesTarget)

/** Returns true if both values are either falsy or strictly equal. */
const eqish = (a: any, b: any) => (a || undefined) === (b || undefined)

/** Returns true if the draft has user-visibly changed from the published
 * version./ */
export function hasDraftChanged(
  draft?: WorkingDraft,
  published?: Testimony
): boolean {
  if (!draft || !published) return false
  return (
    !eqish(published.position, draft.position) ||
    !eqish(published.content, draft.content) ||
    !eqish(published.draftAttachmentId, draft.attachmentId)
  )
}

export type WithId<T> = { id: string; value: T }

export const deleteTestimony = httpsCallable<
  { publicationId: string },
  { deleted: boolean }
>(functions, "deleteTestimonyV2")

export const publishTestimony = httpsCallable<
  { draftId: string },
  { publicationId: string }
>(functions, "publishTestimonyV2")

export const resolveReport = httpsCallable<report.Request, report.Response>(
  functions,
  "adminResolveReportV2"
)
