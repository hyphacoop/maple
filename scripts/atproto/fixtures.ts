/** Deterministic sample data shared by the atproto scripts (and, later, the
 * #61 seed script). Deliberately not the storybook/moderation mocks — those
 * are randomized, and the validator's round-trip assertions need stable
 * values. */
import type { ComAtprotoRepoStrongRef } from "@atproto/api"
import { Timestamp } from "firebase/firestore"
import { billNsid, recordRkey } from "components/atproto/lexicons"
import type { Bill } from "components/db/bills"
import type { Testimony } from "components/db/testimony/types"
import { currentGeneralCourt } from "functions/src/shared"

export const sampleCourt = currentGeneralCourt
export const sampleBillId = "H1234"
export const sampleRkey = recordRkey(sampleCourt, sampleBillId)

export const sampleBill: Bill = {
  id: sampleBillId,
  court: sampleCourt,
  content: {
    Title: "An Act relative to the example of samples",
    BillNumber: sampleBillId,
    DocketNumber: "HD2468",
    GeneralCourtNumber: sampleCourt,
    PrimarySponsor: { Id: "ABC1", Name: "Jane Doe", Type: 1 },
    Cosponsors: [
      { Id: "ABC1", Name: "Jane Doe", Type: 1 },
      { Id: "DEF2", Name: "John Roe", Type: 1 }
    ],
    LegislationTypeName: "House Bill",
    Pinslip: "By Ms. Doe of Sampleton, a petition..."
  },
  // Aggregates aren't carried by records; zeroes match what billFromRecord
  // reconstructs, keeping the round-trip assertion honest.
  cosponsorCount: 2,
  testimonyCount: 0,
  endorseCount: 0,
  opposeCount: 0,
  neutralCount: 0,
  nextHearingAt: Timestamp.fromDate(new Date("2026-08-01T14:00:00Z")),
  fetchedAt: Timestamp.fromDate(new Date("2026-07-28T00:00:00Z")),
  history: [
    // Upstream date strings have no timezone offset — preserved verbatim.
    { Date: "2026-02-16T11:17:15.563", Branch: "House", Action: "Referred" },
    { Date: null, Branch: "Senate", Action: "Concurred" }
  ],
  currentCommittee: {
    id: "J33",
    name: "Joint Committee on Samples",
    houseChair: { id: "ABC1", name: "Jane Doe", email: null },
    senateChair: undefined
  },
  topics: [{ category: "Commerce", topic: "Consumer protection" }],
  summary: "This bill does example things.",
  hearingIds: ["hearing-4567"]
}

export const sampleTestimony: Testimony = {
  billId: sampleBillId,
  court: sampleCourt,
  position: "endorse",
  content: "I support this bill because...",
  attachmentId: null,
  draftAttachmentId: null,
  editReason: null,
  ballotQuestionId: null,
  authorUid: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
  id: sampleRkey,
  authorDisplayName: "alice.test",
  authorRole: "user",
  fullName: "alice.test",
  billTitle: sampleBill.content.Title,
  version: 1,
  public: true,
  publishedAt: Timestamp.fromDate(new Date("2026-07-28T12:00:00Z")),
  updatedAt: Timestamp.fromDate(new Date("2026-07-28T12:00:00Z"))
}

/** StrongRef to the sample bill as it would live in the given repo. The cid
 * is a syntactically valid placeholder, not a real hash. */
export const sampleBillRef = (did: string): ComAtprotoRepoStrongRef.Main => ({
  uri: `at://${did}/${billNsid}/${sampleRkey}`,
  cid: "bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a"
})
