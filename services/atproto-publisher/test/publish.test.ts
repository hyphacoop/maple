import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Timestamp } from "firebase-admin/firestore"
import { publishDocument, recordHash } from "../src/publish.js"
import { billRecord } from "../src/records.js"
import { billDoc } from "./fixtures.js"
import { FakePds, testDb } from "./harness.js"

const db = testDb()
const pds = () => new FakePds()
/** publishDocument takes a thunk so it can skip the PDS entirely when nothing
 * changed; these tests assert that by counting puts on the fake. */
const via = (client: FakePds) => async () => client

/** Each test writes state under its own rkey, so a shared emulator is safe
 * and no teardown is needed. */
const uniqueDoc = () => {
  const doc = billDoc()
  doc.id = `H${Math.floor(Math.random() * 1e9)}`
  return doc
}

describe("recordHash", () => {
  it("ignores fetchedAt", () => {
    const a = billRecord.toRecord(billDoc())
    const later = billDoc()
    later.fetchedAt = Timestamp.fromMillis(Date.now())
    const b = billRecord.toRecord(later)
    assert.notEqual(
      (a as any).fetchedAt,
      (b as any).fetchedAt,
      "fixture should differ in fetchedAt"
    )
    assert.equal(recordHash(a), recordHash(b))
  })

  it("is insensitive to key order", () => {
    const r = billRecord.toRecord(billDoc()) as any
    const reordered = Object.fromEntries(Object.entries(r).reverse())
    assert.equal(recordHash(r), recordHash(reordered))
  })

  it("changes when real content changes", () => {
    const a = billRecord.toRecord(billDoc())
    const changed = billDoc()
    changed.summary = "something else entirely"
    assert.notEqual(recordHash(a), recordHash(billRecord.toRecord(changed)))
  })
})

describe("publishDocument", () => {
  it("publishes a document it has never seen", async () => {
    const client = pds()
    const result = await publishDocument(
      db,
      via(client),
      billRecord,
      uniqueDoc()
    )
    assert.equal(result.status, "published")
    assert.equal(client.puts.length, 1)
  })

  /**
   * The assertion this whole issue turns on. The scraper rewrites every bill
   * daily with only a new fetchedAt, so without this the publisher would emit
   * ~8000 no-op commits a day and churn every testimony strongRef.
   */
  it("does NOT republish when only fetchedAt moved", async () => {
    const client = pds()
    const doc = uniqueDoc()
    assert.equal(
      (await publishDocument(db, via(client), billRecord, doc)).status,
      "published"
    )

    const rescraped = { ...doc, fetchedAt: Timestamp.fromMillis(Date.now()) }
    const second = await publishDocument(db, via(client), billRecord, rescraped)

    assert.equal(second.status, "unchanged")
    assert.equal(
      client.puts.length,
      1,
      "second scrape must not write to the PDS"
    )
  })

  /**
   * The scraper rewrites all ~8000 bills daily and almost all are unchanged, so
   * an instance that sees only those must never reach the PDS: connecting costs
   * a createSession round trip against a per-account rate limit, to publish
   * nothing.
   */
  it("does not connect to the PDS when nothing needs publishing", async () => {
    const client = pds()
    const doc = uniqueDoc()
    await publishDocument(db, via(client), billRecord, doc)

    let connected = 0
    const counting = async () => {
      connected++
      return client
    }
    const rescraped = { ...doc, fetchedAt: Timestamp.fromMillis(Date.now()) }
    const result = await publishDocument(db, counting, billRecord, rescraped)

    assert.equal(result.status, "unchanged")
    assert.equal(connected, 0, "an unchanged document must not log in")
  })

  it("republishes when content actually changes", async () => {
    const client = pds()
    const doc = uniqueDoc()
    await publishDocument(db, via(client), billRecord, doc)
    const edited = { ...doc, summary: "revised summary" }
    assert.equal(
      (await publishDocument(db, via(client), billRecord, edited)).status,
      "published"
    )
    assert.equal(client.puts.length, 2)
  })

  it("refuses to publish a record that fails lexicon validation", async () => {
    const client = pds()
    const doc = uniqueDoc()
    delete doc.content.Title // required by the lexicon
    const result = await publishDocument(db, via(client), billRecord, doc)
    assert.equal(result.status, "invalid")
    assert.equal(
      client.puts.length,
      0,
      "invalid records must never reach the PDS"
    )
  })

  it("reports an unkeyable document rather than throwing", async () => {
    const client = pds()
    const doc = uniqueDoc()
    delete doc.court
    const result = await publishDocument(db, via(client), billRecord, doc)
    assert.equal(result.status, "unmappable")
    assert.equal(client.puts.length, 0)
  })
})
