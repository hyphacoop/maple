import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Timestamp } from "firebase-admin/firestore"
import { toBillRecord, toHearingRecord } from "../src/mapper.js"
import { billRecord, hearingRecord } from "../src/records.js"
import {
  billDoc,
  billRecordFixture,
  hearingDoc,
  hearingRecordFixture
} from "./fixtures.js"

describe("mapper", () => {
  /**
   * The load-bearing test. The doc fixtures were produced by running the
   * consumer's own record → document mapper over its record fixtures, so
   * mapping them back and landing on the same record proves the publisher is
   * that mapper's inverse. If the two ever disagree, records published here
   * would not survive the trip through the consumer at cutover.
   */
  it("bill: document maps back to the consumer's canonical record", () => {
    assert.deepEqual(toBillRecord(billDoc()), billRecordFixture())
  })

  it("hearing: document maps back to the consumer's canonical record", () => {
    assert.deepEqual(toHearingRecord(hearingDoc()), hearingRecordFixture())
  })

  it("bill: output validates against the generated lexicon schema", () => {
    const r = billRecord.schema.safeValidate(toBillRecord(billDoc()))
    assert.equal(r.success, true, JSON.stringify((r as any).issues))
  })

  it("hearing: output validates against the generated lexicon schema", () => {
    const r = hearingRecord.schema.safeValidate(toHearingRecord(hearingDoc()))
    assert.equal(r.success, true, JSON.stringify((r as any).issues))
  })

  it("omits nullable fields rather than emitting null", () => {
    const doc = billDoc()
    doc.content.Pinslip = null
    doc.content.PrimarySponsor = null
    doc.currentCommittee = null
    const r = toBillRecord(doc) as any
    assert.equal("pinslip" in r.content, false)
    assert.equal("primarySponsor" in r.content, false)
    assert.equal("currentCommittee" in r, false)
    assert.equal(billRecord.schema.safeValidate(r).success, true)
  })

  it("translates MISSING_TIMESTAMP to absence, not a 1970 datetime", () => {
    const doc = billDoc()
    doc.nextHearingAt = Timestamp.fromMillis(0)
    const r = toBillRecord(doc) as any
    assert.equal("nextHearingAt" in r, false)
  })

  it("strips the hearing- document-id prefix down to upstream EventIds", () => {
    const doc = billDoc()
    doc.hearingIds = ["hearing-5142", "hearing-99"]
    doc.nextHearingId = "hearing-99"
    const r = toBillRecord(doc) as any
    assert.deepEqual(r.hearingIds, [5142, 99])
    assert.equal(r.nextHearingId, 99)
  })

  it("drops DocumentText, which cannot fit a record", () => {
    const doc = billDoc()
    doc.content.DocumentText = "x".repeat(200_000)
    const r = toBillRecord(doc) as any
    assert.equal("documentText" in r.content, false)
    assert.equal(JSON.stringify(r).length < 10_000, true)
  })

  /**
   * Found by mapping all 7337 real bill documents out of
   * tests/integration/exportedTestData: the upstream API returns a null Id for
   * every Public Request (Type 3) and Special Request (Type 4) sponsor — a
   * private citizen or an agency, with no legislative member record to point
   * at — and occasionally for a legislator too. The lexicon required `id`, so
   * 417 real bills could never have been published. `id` is now optional.
   */
  it("maps sponsors that have no upstream Id", () => {
    const doc = billDoc()
    doc.content.PrimarySponsor = {
      Id: null,
      Name: "Public Employee Retirement Administration Commission",
      Type: 4
    }
    doc.content.Cosponsors = [{ Id: null, Name: "Kirstin Beatty", Type: 3 }]
    const r = toBillRecord(doc) as any
    assert.equal("id" in r.content.primarySponsor, false)
    assert.equal(
      r.content.primarySponsor.name,
      "Public Employee Retirement Administration Commission"
    )
    assert.equal(r.content.cosponsors[0].memberType, 3)
    const v = billRecord.schema.safeValidate(r)
    assert.equal(v.success, true, JSON.stringify((v as any).issues))
  })

  /**
   * Also from the real corpus: pinslips are short (p50 224, p99 531) but have a
   * long tail where the petition names every signatory. 20 of 7056 exceed the
   * lexicon's original 2000-grapheme cap, the largest at 28049.
   */
  it("accepts the long tail of real pinslip lengths", () => {
    const doc = billDoc()
    doc.content.Pinslip = "x".repeat(28_049)
    const v = billRecord.schema.safeValidate(toBillRecord(doc))
    assert.equal(v.success, true, JSON.stringify((v as any).issues))
  })

  /**
   * Two real documents (192-H4453/H4454) predate the fetchedAt field and carry
   * only the old `lastFetch`. A record cannot claim a fetch time we do not
   * have, so it must fail validation and be skipped rather than be published
   * with an invented one.
   */
  it("refuses a document with no fetchedAt rather than inventing one", () => {
    const doc = billDoc()
    delete doc.fetchedAt
    const r = toBillRecord(doc) as any
    assert.equal("fetchedAt" in r, false)
    assert.equal(billRecord.schema.safeValidate(r).success, false)
  })

  /**
   * Real documents carry the whole upstream payload — the scraper stores
   * malegislature.ts getDocument()'s response verbatim — so content also holds
   * Amendments, Attachments, BillHistory, CommitteeRecommendations,
   * EmergencyPreamble and RollCalls, none of which the lexicon knows about. The
   * mapper selects fields explicitly rather than spreading, and this pins that:
   * an upstream addition must not silently start appearing in published
   * records.
   */
  it("ignores upstream fields the lexicon does not model", () => {
    const doc = billDoc()
    const clean = toBillRecord(billDoc())
    Object.assign(doc.content, {
      Amendments: [{ Id: "A1" }],
      Attachments: [{ Url: "http://example.invalid" }],
      BillHistory: [{ Action: "something" }],
      CommitteeRecommendations: [{ Value: "favorable" }],
      EmergencyPreamble: "whereas...",
      RollCalls: [{ Id: 7 }],
      SomethingAddedNextYear: "surprise"
    })
    assert.deepEqual(toBillRecord(doc), clean)
  })

  it("omits optional arrays when empty so absent and empty agree", () => {
    const doc = billDoc()
    doc.similar = []
    doc.topics = []
    const r = toBillRecord(doc) as any
    assert.equal("similar" in r, false)
    assert.equal("topics" in r, false)
  })
})
