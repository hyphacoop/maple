import { bill, hearing } from "./lexicons/org/mapletestimony.js"

/** The app stores hearing ids prefixed (`events/hearing-{EventId}`); records
 * carry the bare upstream EventId. One spelling of the stripping rule, kept
 * with the mapping it belongs to rather than with the rkey conventions in
 * records.ts — this is the consumer's document-id prefix, not our record key. */
export const hearingIdFromDocId = (docId: string): number | undefined => {
  const m = /^hearing-(\d+)$/.exec(docId)
  return m ? Number(m[1]) : undefined
}

/**
 * Firestore document → record mapping.
 *
 * This is the exact inverse of services/atproto-consumer/src/mapper.ts; read
 * that first. Anything published here must map back through it to the document
 * shape the app already uses, because the cutover flips the app onto that pipeline.
 *
 * The source is the app's live document, whose `content` is the raw upstream
 * legislature API payload: functions/src/malegislature.ts `getDocument()`
 * returns `any` and functions/src/bills/bills.ts stores it verbatim, without
 * ever running `BillContent.check()`. So `content.PrimarySponsor` really does
 * carry `{ Id, Name, Type }` even though functions/src/bills/types.ts declares
 * only `{ Name }` — the runtype under-declares what is on disk.
 *
 * We deliberately do NOT import those runtypes: they are CommonJS on the root
 * toolchain and unreachable from this ESM package (the consumer hand-writes
 * its target shape for the same reason). The real contract is the lexicon, and
 * every record is validated against the generated schema before it is written.
 * The cost of that choice is that an upstream shape change surfaces as a
 * validation failure rather than a type error, which is what the fixture tests
 * are for.
 */

/** Structural view of what we read. Not a redeclaration of the app's runtypes:
 * only the fields this mapper touches, all optional, because the document is
 * whatever Firestore holds and the lexicon is what judges it. */
type TimestampLike = { toMillis(): number; toDate(): Date }

export type BillDoc = {
  id?: string
  court?: number
  content?: Record<string, any>
  history?: { Date?: string; Branch?: string; Action?: string }[]
  similar?: string[]
  currentCommittee?: {
    id?: string
    name?: string
    houseChair?: { id?: string; name?: string; email?: string | null } | null
    senateChair?: { id?: string; name?: string; email?: string | null } | null
  } | null
  city?: string
  topics?: { category?: string; topic?: string }[]
  summary?: string
  hearingIds?: string[]
  nextHearingId?: string
  nextHearingAt?: TimestampLike
  fetchedAt?: TimestampLike
}

export type HearingDoc = {
  id?: string
  type?: string
  content?: Record<string, any>
  startsAt?: TimestampLike
  fetchedAt?: TimestampLike
  videoURL?: string
  committeeChairs?: string[]
}

const isTimestamp = (v: unknown): v is TimestampLike =>
  !!v && typeof (v as TimestampLike).toMillis === "function"

/**
 * Firestore Timestamp → lexicon `format: datetime`.
 *
 * `MISSING_TIMESTAMP` (functions/src/bills/types.ts) is `fromMillis(0)`, the
 * app's sentinel for "no value" — it exists so documents without a real value
 * still sort. A record has no such sentinel, so it becomes absence rather than
 * a literal 1970 datetime that every consumer would have to know to ignore.
 */
const datetime = (v: unknown): string | undefined => {
  if (!isTimestamp(v)) return undefined
  if (v.toMillis() === 0) return undefined
  return v.toDate().toISOString()
}

/** Lexicon records have no null and no undefined: absence is omission. Every
 * object literal below is built through this, so a nullable upstream field
 * becomes a missing key rather than an explicit null the schema would reject. */
const compact = <T extends object>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null)
  ) as T

/** Optional arrays are omitted when empty rather than written as `[]`, so an
 * absent list and an empty one produce the same record and cannot churn the
 * diff against each other. Applied only to OPTIONAL arrays: `cosponsors`,
 * `history`, `agendas` and `documents` are required by the lexicon and are
 * emitted even when empty. */
const nonEmpty = <T>(a: T[] | undefined): T[] | undefined =>
  a && a.length > 0 ? a : undefined

/** Same rule for optional nested objects: every field of an upstream group
 * (host, location) can be null, and an object of nothing is an absence. */
const present = <T extends object>(o: T): T | undefined =>
  Object.keys(o).length > 0 ? o : undefined

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined
const num = (v: unknown): number | undefined =>
  typeof v === "number" ? v : undefined

const member = (m: any) =>
  compact({
    id: str(m?.Id),
    name: str(m?.Name),
    memberType: num(m?.Type)
  })

const chair = (c: any) =>
  c == null
    ? undefined
    : compact({ id: str(c.id), name: str(c.name), email: str(c.email) })

/** Throws rather than returning a partial record: a bill we cannot key is a
 * bug in the caller, not a document-level validation failure. */
export function toBillRecord(doc: BillDoc): bill.Main {
  const content = doc.content ?? {}
  return compact({
    $type: bill.$nsid,
    court: doc.court,
    billId: doc.id,
    content: compact({
      title: str(content.Title),
      docketNumber: str(content.DocketNumber),
      primarySponsor: content.PrimarySponsor
        ? member(content.PrimarySponsor)
        : undefined,
      cosponsors: (content.Cosponsors ?? []).map(member),
      legislationTypeName: str(content.LegislationTypeName),
      pinslip: str(content.Pinslip)
      // DocumentText is dropped: hundreds of KB against a hard 150 KiB
      // putRecord body limit, and the lexicon has no field for it.
      // BillNumber and GeneralCourtNumber are dropped too — the consumer
      // reconstructs them from billId and court, so carrying them would be
      // two places for the same fact to diverge.
    }),
    history: (doc.history ?? []).map(h =>
      compact({
        // Verbatim upstream strings. NOT format=datetime: the legislature
        // emits "2025-09-17T15:43:04.1133333" with no timezone offset, which
        // lexicon datetime validation rejects.
        date: str(h.Date),
        branch: str(h.Branch),
        action: str(h.Action)
      })
    ),
    similar: nonEmpty(doc.similar),
    currentCommittee: doc.currentCommittee
      ? compact({
          id: str(doc.currentCommittee.id),
          name: str(doc.currentCommittee.name),
          houseChair: chair(doc.currentCommittee.houseChair),
          senateChair: chair(doc.currentCommittee.senateChair)
        })
      : undefined,
    city: str(doc.city),
    topics: nonEmpty(
      doc.topics?.map(t =>
        compact({ category: str(t.category), topic: str(t.topic) })
      )
    ),
    summary: str(doc.summary),
    // The app refers to hearings by document id; the record refers to them by
    // upstream EventId. The prefix is stripped here and nowhere else.
    hearingIds: nonEmpty(
      doc.hearingIds
        ?.map(hearingIdFromDocId)
        .filter((n): n is number => n !== undefined)
    ),
    nextHearingId: doc.nextHearingId
      ? hearingIdFromDocId(doc.nextHearingId)
      : undefined,
    nextHearingAt: datetime(doc.nextHearingAt),
    fetchedAt: datetime(doc.fetchedAt)
  }) as bill.Main
}

export function toHearingRecord(doc: HearingDoc): hearing.Main {
  const c = doc.content ?? {}
  return compact({
    $type: hearing.$nsid,
    hearingId: num(c.EventId),
    content: compact({
      // Verbatim upstream local strings, same reason as history dates above.
      eventDate: str(c.EventDate),
      startTime: str(c.StartTime),
      description: str(c.Description),
      name: str(c.Name),
      status: str(c.Status),
      host: present(
        compact({
          committeeCode: str(c.HearingHost?.CommitteeCode),
          generalCourtNumber: num(c.HearingHost?.GeneralCourtNumber)
        })
      ),
      location: present(
        compact({
          locationName: str(c.Location?.LocationName),
          addressLine1: str(c.Location?.AddressLine1),
          addressLine2: str(c.Location?.AddressLine2),
          city: str(c.Location?.City),
          state: str(c.Location?.State),
          zipCode: str(c.Location?.ZipCode)
        })
      ),
      agendas: (c.HearingAgendas ?? []).map((a: any) =>
        compact({
          startTime: str(a?.StartTime),
          endTime: str(a?.EndTime),
          topic: str(a?.Topic),
          documents: (a?.DocumentsInAgenda ?? []).map((d: any) =>
            compact({
              billNumber: str(d?.BillNumber),
              generalCourtNumber: num(d?.GeneralCourtNumber),
              // Deliberately an identifier, not a strongRef: we have no CID
              // for the bill record at the time we write a hearing.
              primarySponsorId: str(d?.PrimarySponsor?.Id),
              title: str(d?.Title)
            })
          )
        })
      ),
      rescheduledTo: c.RescheduledHearing
        ? compact({
            eventDate: str(c.RescheduledHearing.EventDate),
            startTime: str(c.RescheduledHearing.StartTime)
          })
        : undefined
    }),
    // Unlike content.eventDate/startTime this is a real instant, so it is a
    // proper datetime with an offset.
    startsAt: datetime(doc.startsAt),
    videoUrl: str(doc.videoURL),
    committeeChairs: nonEmpty(doc.committeeChairs),
    fetchedAt: datetime(doc.fetchedAt)
    // videoTranscriptionId / videoFetchedAt / transcriptionIds / videos are
    // our own pipeline's operational state, not legislative data. The lexicon
    // omits them and the consumer preserves them across indexed writes.
  }) as hearing.Main
}
