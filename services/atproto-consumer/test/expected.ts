import assert from "node:assert/strict"
import { Timestamp } from "firebase-admin/firestore"
import { billFixture } from "./events.js"

/**
 * The app-shaped document a bill record maps to, spelled once.
 *
 * Both the unit test (synthetic event straight into LexIndexer) and the smoke
 * test (a record that actually travelled PDS -> relay -> jetstream -> consumer)
 * assert against this. Two spellings would let the real path drift from the
 * unit expectation silently, which is exactly the gap the smoke test exists to
 * close.
 *
 * `fetchedAt` is the parameter because it is the one field that legitimately
 * differs: the fixture ships a fixed value, and a seeded record stamps it to
 * now so every run gets a distinct cid.
 */

/** Lexicon datetimes are ISO 8601; the app stores Firestore Timestamps. */
export const iso = (s: string) => Timestamp.fromMillis(Date.parse(s))

export const assertIndexedAt = (value: unknown) =>
  assert.ok(
    typeof value === "string" && !Number.isNaN(Date.parse(value)),
    `indexedAt should be an ISO datetime, got ${value}`
  )

export const expectedBillDoc = (fetchedAt: string) => ({
  id: "H72",
  court: 194,
  content: {
    Title: "An Act relative to the oversight of cable contracts",
    // Reconstructed from the record's identity fields, which is why the
    // lexicon does not repeat them inside content.
    BillNumber: "H72",
    GeneralCourtNumber: 194,
    DocketNumber: "HD301",
    LegislationTypeName: "Bill",
    PrimarySponsor: { Id: "J_B1", Name: "John Barrett, III", Type: 1 },
    Cosponsors: [
      { Id: "J_B1", Name: "John Barrett, III", Type: 1 },
      { Id: "SGX1", Name: "Steven George Xiarhos", Type: 1 }
    ],
    Pinslip: billFixture.content.pinslip
  },
  cosponsorCount: 2,
  history: [
    {
      Date: "2025-02-27T00:00:00",
      Branch: "House",
      Action:
        "Referred to the committee on Advanced Information Technology, the Internet and Cybersecurity"
    },
    {
      Date: "2025-06-30T10:39:35.04",
      Branch: "Joint",
      Action: "Hearing scheduled for 07/10/2025 from 01:00 PM-05:00 PM in A-2"
    }
  ],
  similar: ["S38"],
  currentCommittee: {
    id: "J33",
    name: "Joint Committee on Advanced Information Technology, the Internet and Cybersecurity",
    houseChair: {
      id: "J_B1",
      name: "John Barrett, III",
      email: "John.Barrett@mahouse.gov"
    },
    // Declared nullable by the app's runtype, so absence must be null and
    // not a missing key.
    senateChair: null
  },
  topics: [{ category: "Commerce", topic: "Telecommunications" }],
  summary: billFixture.summary,
  hearingIds: ["hearing-5142"],
  nextHearingId: "hearing-5142",
  nextHearingAt: iso("2025-07-10T17:00:00.000Z"),
  fetchedAt: iso(fetchedAt),
  // Defaults for the AppView's own fields, mirroring the scraper.
  testimonyCount: 0,
  endorseCount: 0,
  neutralCount: 0,
  opposeCount: 0
})
