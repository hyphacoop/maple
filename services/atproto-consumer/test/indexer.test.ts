import assert from "node:assert/strict"
import { test } from "node:test"
import { Timestamp } from "firebase-admin/firestore"
import { buildIndexer } from "../src/indexer.js"
import { billRecord, hearingRecord } from "../src/records.js"
import {
  BILL_RKEY,
  HEARING_RKEY,
  billEvent,
  billFixture,
  hearingEvent,
  hearingFixture,
  nextSeq,
  uriFor
} from "./events.js"
import { runEvents, testDb, uniqueName } from "./harness.js"

const db = testDb()

const fresh = () => {
  const prefix = uniqueName("t") + "-"
  const built = buildIndexer(db, prefix)
  return {
    ...built,
    bills: db.collection(prefix + "atpBills"),
    hearings: db.collection(prefix + "atpHearings")
  }
}

const iso = (s: string) => Timestamp.fromMillis(Date.parse(s))

const assertIndexedAt = (value: unknown) =>
  assert.ok(
    typeof value === "string" && !Number.isNaN(Date.parse(value)),
    `indexedAt should be an ISO datetime, got ${value}`
  )

test("bill create writes the app's document shape", async () => {
  const { indexer, stats, bills } = fresh()
  const did = "did:plc:billcreate00000000000000"
  const seq = nextSeq()

  const { acked } = await runEvents(indexer, [billEvent.create({ did, seq })])

  const data = (await bills.doc("194-H72").get()).data()
  assert.ok(data, "doc should exist at {court}-{billId}")
  const { atp, ...doc } = data
  assert.deepEqual(doc, {
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
    fetchedAt: iso("2026-07-28T00:00:00.000Z"),
    // Defaults for the AppView's own fields, mirroring the scraper.
    testimonyCount: 0,
    endorseCount: 0,
    neutralCount: 0,
    opposeCount: 0
  })

  const { indexedAt, ...provenance } = atp
  assert.deepEqual(provenance, {
    did,
    uri: uriFor(did, billRecord.nsid, BILL_RKEY),
    cid: "bafyreihgx7zaladfyv6uxdc4le37yqi3azfhawvlbmnzpvbmjmoiabx3wa",
    seq
  })
  assertIndexedAt(indexedAt)
  assert.deepEqual(stats, { creates: 1, updates: 0, deletes: 0, invalid: 0 })
  assert.deepEqual(acked, [seq])
})

test("hearing create writes the app's document shape", async () => {
  const { indexer, stats, hearings } = fresh()
  const did = "did:plc:hearcreate00000000000000"
  const seq = nextSeq()

  await runEvents(indexer, [hearingEvent.create({ did, seq })])

  const data = (await hearings.doc("hearing-5142").get()).data()
  assert.ok(data, "doc should exist at hearing-{EventId}")
  const { atp, ...doc } = data
  assert.deepEqual(doc, {
    id: "hearing-5142",
    type: "hearing",
    content: {
      EventId: 5142,
      EventDate: "2025-07-10T00:00:00",
      StartTime: "2025-07-10T13:00:00",
      Description:
        "Joint Committee on Advanced Information Technology, the Internet and Cybersecurity",
      Name: "Hearing on cable oversight legislation",
      Status: "Scheduled",
      HearingHost: { CommitteeCode: "J33", GeneralCourtNumber: 194 },
      Location: {
        LocationName: "Hearing Room A-2",
        // Nullable upstream and absent from the record: null, not missing.
        AddressLine1: null,
        AddressLine2: null,
        City: "Boston",
        State: "MA",
        ZipCode: "02133"
      },
      HearingAgendas: [
        {
          StartTime: "2025-07-10T13:00:00",
          EndTime: "2025-07-10T17:00:00",
          Topic: "Cable and telecommunications oversight",
          DocumentsInAgenda: [
            {
              BillNumber: "H72",
              GeneralCourtNumber: 194,
              PrimarySponsor: { Id: "J_B1" },
              Title: "An Act relative to the oversight of cable contracts"
            }
          ]
        }
      ],
      RescheduledHearing: null
    },
    startsAt: iso("2025-07-10T17:00:00.000Z"),
    fetchedAt: iso("2026-07-28T00:00:00.000Z"),
    videoURL: "https://malegislature.gov/videos/5142.mp4",
    committeeChairs: ["John Barrett, III"]
  })
  assert.equal(atp.uri, uriFor(did, hearingRecord.nsid, HEARING_RKEY))
  assertIndexedAt(atp.indexedAt)
  assert.deepEqual(stats, { creates: 1, updates: 0, deletes: 0, invalid: 0 })
})

test("update is an upsert: writes even with no existing doc", async () => {
  const { indexer, stats, bills } = fresh()

  await runEvents(indexer, [billEvent.update()])

  assert.ok((await bills.doc("194-H72").get()).exists, "update must write")
  assert.deepEqual(stats, { creates: 0, updates: 1, deletes: 0, invalid: 0 })
})

test("update replaces the whole doc, not a merge", async () => {
  const { indexer, bills } = fresh()
  const updateSeq = nextSeq()

  await runEvents(indexer, [
    billEvent.create(),
    billEvent.update({
      seq: updateSeq,
      record: { summary: undefined, city: "Boston" }
    })
  ])

  const data = (await bills.doc("194-H72").get()).data()
  assert.ok(data)
  assert.equal(data.city, "Boston")
  assert.equal(
    data.summary,
    undefined,
    "field dropped upstream must not survive the rewrite"
  )
  assert.equal(data.atp.seq, updateSeq)
})

test("an indexed write preserves AppView-owned fields", async () => {
  const { indexer, bills, hearings } = fresh()
  const latestTestimonyAt = Timestamp.fromMillis(1_700_000_000_000)

  await runEvents(indexer, [billEvent.create(), hearingEvent.create()])
  await bills.doc("194-H72").update({
    testimonyCount: 7,
    endorseCount: 5,
    latestTestimonyAt,
    latestTestimonyId: "tid-1"
  })
  await hearings
    .doc("hearing-5142")
    .update({ videoTranscriptionId: "transcript-1" })

  await runEvents(indexer, [billEvent.update(), hearingEvent.update()])

  const bill = (await bills.doc("194-H72").get()).data()
  assert.ok(bill)
  assert.equal(bill.testimonyCount, 7)
  assert.equal(bill.endorseCount, 5)
  assert.equal(bill.latestTestimonyId, "tid-1")
  assert.deepEqual(bill.latestTestimonyAt, latestTestimonyAt)
  assert.equal(bill.opposeCount, 0, "untouched counters keep their default")

  const hearing = (await hearings.doc("hearing-5142").get()).data()
  assert.equal(hearing?.videoTranscriptionId, "transcript-1")
})

test("delete resolves the doc by AT-URI, not by record key", async () => {
  const { indexer, stats, bills } = fresh()
  // A key the doc id cannot be parsed out of: if the consumer derived the
  // document from the rkey, this delete would silently miss.
  const rkey = "3ktherkeyisopaque00"

  await runEvents(indexer, [
    billEvent.create({ rkey }),
    billEvent.del({ rkey })
  ])

  assert.equal((await bills.doc("194-H72").get()).exists, false)
  assert.equal(stats.deletes, 1)
})

test("schema-invalid record is skipped without a partial write, and acked", async () => {
  const { indexer, stats, bills } = fresh()
  const seq = nextSeq()

  const { acked } = await runEvents(indexer, [
    // Upstream date strings carry no timezone, which is exactly why the
    // lexicon keeps them out of format=datetime; fetchedAt is a real instant
    // and must have an offset.
    billEvent.create({ seq, record: { fetchedAt: "2026-07-28T00:00:00" } })
  ])

  assert.equal((await bills.doc("194-H72").get()).exists, false)
  assert.deepEqual(stats, { creates: 0, updates: 0, deletes: 0, invalid: 1 })
  assert.deepEqual(acked, [seq], "invalid events are handled-and-acked")
})

test("replayed create is idempotent", async () => {
  const { indexer, bills } = fresh()
  const seq = nextSeq()

  await runEvents(indexer, [billEvent.create({ seq })])
  const first = (await bills.doc("194-H72").get()).data()
  await runEvents(indexer, [billEvent.create({ seq })])
  const second = (await bills.doc("194-H72").get()).data()

  assert.ok(first && second)
  const strip = ({ atp, ...rest }: Record<string, any>) => rest
  assert.deepEqual(strip(second), strip(first))
  assert.equal((await bills.get()).size, 1, "exactly one doc after replay")
})
