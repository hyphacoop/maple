/** Mappers between org.mapletestimony.* ATProto records and the app's Bill /
 * Testimony types.
 *
 * Records deliberately omit fields the app types carry (aggregate counters,
 * author snapshots, attachments, version history) — those are AppView or blob
 * concerns, not repo data. The *FromRecord mappers fill them with the
 * defaults noted inline; docs/atproto-spike-notes.md has the full rationale.
 */
import type { ComAtprotoRepoStrongRef } from "@atproto/api"
import { Timestamp } from "firebase/firestore"
import type { Role } from "../auth"
import type { Bill, MemberReference } from "../db/bills"
import type { Testimony } from "../db/testimony"
import type { CurrentCommittee } from "../../functions/src/bills/types"
import {
  billNsid,
  MapleBillRecord,
  MapleCommittee,
  MapleCommitteeMember,
  MapleHistoryAction,
  MapleMemberReference,
  MapleTestimonyRecord,
  testimonyNsid
} from "./lexicons"

/** ATProto datetimes are ISO 8601 strings; the app uses Firestore Timestamps.
 * The argument is structural so admin-SDK Timestamps work too. */
export const timestampFromIso = (iso: string): Timestamp =>
  Timestamp.fromMillis(Date.parse(iso))

export const isoFromTimestamp = (ts: { toDate(): Date }): string =>
  ts.toDate().toISOString()

/** Maps an optional (or nullable) value, normalizing absence to undefined —
 * lexicon records have no null, while the app's Maybe fields do. */
const mapOpt = <T, U>(v: T | null | undefined, f: (v: T) => U): U | undefined =>
  v == null ? undefined : f(v)

const memberFromRecord = (m: MapleMemberReference): MemberReference => ({
  Id: m.id,
  Name: m.name,
  Type: m.memberType
})

const memberToRecord = (m: MemberReference): MapleMemberReference => ({
  id: m.Id,
  name: m.Name,
  memberType: m.Type
})

const historyFromRecord = (h: MapleHistoryAction): Bill["history"][number] => ({
  Date: h.date ?? null,
  Branch: h.branch,
  Action: h.action
})

const historyToRecord = (h: Bill["history"][number]): MapleHistoryAction => ({
  date: h.Date ?? undefined,
  branch: h.Branch,
  action: h.Action
})

// The member type isn't exported on its own; derive it from the committee.
type CommitteeChair = NonNullable<CurrentCommittee["houseChair"]>

const chairFromRecord = (c: MapleCommitteeMember): CommitteeChair => ({
  id: c.id,
  name: c.name,
  email: c.email ?? null
})

const chairToRecord = (c: CommitteeChair): MapleCommitteeMember => ({
  id: c.id,
  name: c.name,
  email: c.email ?? undefined
})

const committeeFromRecord = (c: MapleCommittee): CurrentCommittee => ({
  id: c.id,
  name: c.name,
  houseChair: mapOpt(c.houseChair, chairFromRecord),
  senateChair: mapOpt(c.senateChair, chairFromRecord)
})

const committeeToRecord = (c: CurrentCommittee): MapleCommittee => ({
  id: c.id,
  name: c.name,
  houseChair: mapOpt(c.houseChair, chairToRecord),
  senateChair: mapOpt(c.senateChair, chairToRecord)
})

export function billFromRecord(record: MapleBillRecord): Bill {
  return {
    id: record.billId,
    court: record.court,
    content: {
      Title: record.content.title,
      BillNumber: record.content.billNumber,
      DocketNumber: record.content.docketNumber,
      GeneralCourtNumber: record.content.generalCourtNumber,
      PrimarySponsor: mapOpt(record.content.primarySponsor, memberFromRecord),
      Cosponsors: record.content.cosponsors.map(memberFromRecord),
      LegislationTypeName: record.content.legislationTypeName,
      Pinslip: record.content.pinslip
      // DocumentText is not in the record (would be a blob); left undefined.
    },
    // Counters and latestTestimony* are AppView aggregates, not repo data.
    cosponsorCount: record.content.cosponsors.length,
    testimonyCount: 0,
    endorseCount: 0,
    opposeCount: 0,
    neutralCount: 0,
    nextHearingAt: mapOpt(record.nextHearingAt, timestampFromIso),
    fetchedAt: timestampFromIso(record.fetchedAt),
    history: record.history.map(historyFromRecord),
    currentCommittee: mapOpt(record.currentCommittee, committeeFromRecord),
    city: record.city,
    topics: record.topics,
    summary: record.summary,
    hearingIds: record.hearingIds
  }
}

export function billToRecord(bill: Bill): MapleBillRecord {
  return {
    $type: billNsid,
    court: bill.court,
    billId: bill.id,
    content: {
      title: bill.content.Title,
      billNumber: bill.content.BillNumber,
      docketNumber: bill.content.DocketNumber,
      generalCourtNumber: bill.content.GeneralCourtNumber,
      primarySponsor: mapOpt(bill.content.PrimarySponsor, memberToRecord),
      cosponsors: bill.content.Cosponsors.map(memberToRecord),
      legislationTypeName: bill.content.LegislationTypeName,
      pinslip: bill.content.Pinslip
    },
    history: bill.history.map(historyToRecord),
    currentCommittee: mapOpt(bill.currentCommittee, committeeToRecord),
    city: bill.city,
    topics: bill.topics,
    summary: bill.summary,
    hearingIds: bill.hearingIds,
    nextHearingAt: mapOpt(bill.nextHearingAt, isoFromTimestamp),
    fetchedAt: isoFromTimestamp(bill.fetchedAt)
  }
}

/** Context a record can't supply on its own: the repo the record lives in,
 * its rkey, and data joined from elsewhere (billTitle from the bill record,
 * authorRole from whatever verification an AppView provides). */
export interface TestimonyRecordContext {
  did: string
  handle: string
  rkey: string
  billTitle: string
  authorRole?: Role
}

export function testimonyFromRecord(
  record: MapleTestimonyRecord,
  ctx: TestimonyRecordContext
): Testimony {
  const publishedAt = timestampFromIso(record.createdAt)
  return {
    billId: record.billId,
    court: record.court,
    position: record.position,
    content: record.content,
    // Attachments would be repo blobs; out of spike scope.
    attachmentId: null,
    draftAttachmentId: null,
    editReason: null,
    ballotQuestionId: null,
    // Author identity is the repo itself; snapshots are an AppView concern.
    authorUid: ctx.did,
    // The rkey alone collides across repos (every author of a bill shares the
    // deterministic rkey), so the id is the globally unique AT-URI. Consumers
    // with routing constraints on the id encode it at their own boundary.
    id: `at://${ctx.did}/${testimonyNsid}/${ctx.rkey}`,
    authorDisplayName: ctx.handle,
    authorRole: ctx.authorRole ?? "user",
    fullName: ctx.handle,
    billTitle: ctx.billTitle,
    // The PDS keeps no version history: latest record is the only version.
    version: 1,
    // Repo records are always public.
    public: true,
    publishedAt,
    updatedAt: publishedAt
  }
}

/** Accepts only the fields the record carries, so callers composing testimony
 * (the seed script, #64's submission flow) don't have to fabricate the
 * app-type fields the record drops; a full Testimony works structurally. */
export function testimonyToRecord(
  testimony: Pick<
    Testimony,
    "court" | "billId" | "position" | "content" | "publishedAt"
  >,
  bill: ComAtprotoRepoStrongRef.Main
): MapleTestimonyRecord {
  return {
    $type: testimonyNsid,
    bill,
    court: testimony.court,
    billId: testimony.billId,
    position: testimony.position,
    content: testimony.content,
    createdAt: isoFromTimestamp(testimony.publishedAt)
  }
}
