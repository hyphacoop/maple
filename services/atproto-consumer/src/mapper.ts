import { Timestamp } from "firebase-admin/firestore"
import type { PutEvent } from "@bsky/jetstream"
import type * as BillLex from "./lexicons/org/mapletestimony/bill.js"
import { hearingDocId, type BillRecord, type HearingRecord } from "./records.js"

/**
 * Record → Firestore document mapping.
 *
 * The target shape is the app's OWN document shape (functions/src/bills/types.ts
 * `Bill`, functions/src/events/types.ts `Hearing`), not a transcription of the
 * record: the cutover flips the app onto this pipeline, and a doc that needs a second
 * translation at cutover is a doc that was mapped to the wrong thing. Hence
 * PascalCase `content`, Firestore Timestamps rather than ISO strings, and an
 * explicit `null` wherever the app's runtype declares a field nullable — those
 * keys are required-and-nullable there, so omitting them fails `.check()`.
 *
 * Fields the record deliberately doesn't carry are reconstructed here
 * (`content.BillNumber` from `billId`) or left to the AppView (testimony
 * counters, `latestTestimony*`, which `setPreserving` carries across writes).
 */

/** Provenance of the indexed write, kept in one nested key so a parity check
 * can ignore exactly one field, and `check.sh` can match on the cid. */
export type AtpEnvelope = {
  did: string
  uri: string
  cid: string
  seq: number
  indexedAt: string
}

const envelope = (e: PutEvent<unknown>, indexedAt: string): AtpEnvelope => ({
  did: e.did,
  uri: e.uri,
  cid: e.cid,
  seq: e.seq,
  indexedAt
})

/** Lexicon datetimes are ISO 8601; the app stores Firestore Timestamps. */
const timestamp = (iso: string): Timestamp =>
  Timestamp.fromMillis(Date.parse(iso))

/** Lexicon records have no null, so absence arrives as `undefined`. Which one
 * goes out is not a style choice: the app's runtypes declare some fields
 * Nullable (key required, value may be null) and others Optional (key may be
 * missing), and `.check()` rejects the wrong one. `orNull` is for the former;
 * plain `?.`/`&&`, whose undefined `ignoreUndefinedProperties` drops, is for
 * the latter. */
const orNull = <T, U>(v: T | undefined, f: (v: T) => U): U | null =>
  v === undefined ? null : f(v)

const member = (m: BillLex.MemberReference) => ({
  Id: m.id,
  Name: m.name,
  Type: m.memberType
})

const chair = (c: BillLex.CommitteeMember) => ({
  id: c.id,
  name: c.name,
  email: c.email ?? null
})

const committee = (c: BillLex.Committee) => ({
  id: c.id,
  name: c.name,
  houseChair: orNull(c.houseChair, chair),
  senateChair: orNull(c.senateChair, chair)
})

export function toBillDoc(e: PutEvent<BillRecord>, indexedAt: string) {
  const r = e.record
  return {
    id: r.billId,
    court: r.court,
    content: {
      Title: r.content.title,
      BillNumber: r.billId,
      GeneralCourtNumber: r.court,
      DocketNumber: r.content.docketNumber,
      LegislationTypeName: r.content.legislationTypeName,
      PrimarySponsor: orNull(r.content.primarySponsor, member),
      Cosponsors: r.content.cosponsors.map(member),
      Pinslip: r.content.pinslip ?? null
      // DocumentText is not in the record (it would be a blob).
    },
    cosponsorCount: r.content.cosponsors.length,
    history: r.history.map(h => ({
      Date: h.date,
      Branch: h.branch,
      Action: h.action
    })),
    similar: r.similar ?? [],
    currentCommittee: r.currentCommittee && committee(r.currentCommittee),
    city: r.city,
    topics: r.topics?.map(t => ({ category: t.category, topic: t.topic })),
    summary: r.summary,
    // The record refers to hearings by their upstream ids; the app refers to
    // them by document id, so the prefix is applied here and nowhere else.
    hearingIds: r.hearingIds?.map(hearingDocId),
    nextHearingId: r.nextHearingId && hearingDocId(r.nextHearingId),
    nextHearingAt: r.nextHearingAt && timestamp(r.nextHearingAt),
    fetchedAt: timestamp(r.fetchedAt),
    atp: envelope(e, indexedAt)
  }
}

/** Bill counters the AppView owns, as field → default, for `setPreserving`.
 * Mirrors the scraper's `current?.testimonyCount ?? 0` in
 * functions/src/bills/bills.ts. `latestTestimony*` have no default: absent
 * until testimony exists. */
export const billAppviewFields = {
  testimonyCount: 0,
  endorseCount: 0,
  neutralCount: 0,
  opposeCount: 0,
  latestTestimonyAt: undefined,
  latestTestimonyId: undefined
}

export function toHearingDoc(e: PutEvent<HearingRecord>, indexedAt: string) {
  const r = e.record
  const c = r.content
  return {
    id: hearingDocId(r.hearingId),
    type: "hearing" as const,
    content: {
      EventId: r.hearingId,
      EventDate: c.eventDate,
      StartTime: c.startTime,
      Description: c.description,
      Name: c.name ?? null,
      Status: c.status,
      HearingHost: {
        CommitteeCode: c.host?.committeeCode ?? null,
        GeneralCourtNumber: c.host?.generalCourtNumber ?? null
      },
      Location: {
        LocationName: c.location?.locationName ?? null,
        AddressLine1: c.location?.addressLine1 ?? null,
        AddressLine2: c.location?.addressLine2 ?? null,
        City: c.location?.city ?? null,
        State: c.location?.state ?? null,
        ZipCode: c.location?.zipCode ?? null
      },
      HearingAgendas: c.agendas.map(a => ({
        StartTime: a.startTime,
        EndTime: a.endTime,
        Topic: a.topic,
        DocumentsInAgenda: a.documents.map(d => ({
          BillNumber: d.billNumber,
          GeneralCourtNumber: d.generalCourtNumber,
          PrimarySponsor: orNull(d.primarySponsorId, id => ({ Id: id })),
          Title: d.title
        }))
      })),
      RescheduledHearing: orNull(c.rescheduledTo, x => ({
        EventDate: x.eventDate,
        StartTime: x.startTime
      }))
    },
    startsAt: timestamp(r.startsAt),
    fetchedAt: timestamp(r.fetchedAt),
    videoURL: r.videoUrl,
    committeeChairs: r.committeeChairs,
    atp: envelope(e, indexedAt)
  }
}

/** Video transcription bookkeeping is our own pipeline's state, written by
 * functions and absent from the record — so an indexed hearing write must not
 * clobber it. */
export const hearingAppviewFields = {
  videoTranscriptionId: undefined,
  videoFetchedAt: undefined
}
