import assert from "node:assert/strict"
import { test } from "node:test"
import { buildIndexer } from "../src/indexer.js"
import {
  profileCreate,
  profileDelete,
  profileUpdate,
  nextSeq
} from "./events.js"
import { runEvents, testDb, uniqueName } from "./harness.js"

const db = testDb()

const fresh = () => {
  const prefix = uniqueName("t") + "-"
  const built = buildIndexer(db, prefix)
  return { ...built, docs: db.collection(prefix + "atpJetstreamProfiles") }
}

test("create writes a doc matching the mapper contract", async () => {
  const { indexer, stats, docs } = fresh()
  const did = "did:plc:createcase0000000000000a"
  const seq = nextSeq()
  const event = profileCreate({ did, seq })

  const { acked } = await runEvents(indexer, [event])

  const data = (await docs.doc(did).get()).data()
  assert.ok(data, "doc should exist")
  const { indexedAt, ...rest } = data
  assert.deepEqual(rest, {
    did,
    uri: `at://${did}/app.bsky.actor.profile/self`,
    cid: "bafyreihgx7zaladfyv6uxdc4le37yqi3azfhawvlbmnzpvbmjmoiabx3wa",
    seq,
    displayName: "Harness User",
    description: "synthetic",
    createdAt: "2026-08-27T00:00:00.000Z"
  })
  assert.ok(
    typeof indexedAt === "string" && !Number.isNaN(Date.parse(indexedAt)),
    `indexedAt should be an ISO datetime, got ${indexedAt}`
  )
  assert.deepEqual(stats, { creates: 1, updates: 0, deletes: 0, invalid: 0 })
  assert.deepEqual(acked, [seq])
})

test("update is an upsert: writes even with no existing doc", async () => {
  const { indexer, stats, docs } = fresh()
  const did = "did:plc:updatefresh000000000000a"

  await runEvents(indexer, [profileUpdate({ did })])

  assert.ok((await docs.doc(did).get()).exists, "update must write the doc")
  assert.deepEqual(stats, { creates: 0, updates: 1, deletes: 0, invalid: 0 })
})

test("update replaces the whole doc, not a merge", async () => {
  const { indexer, docs } = fresh()
  const did = "did:plc:updatewhole000000000000a"
  const updateSeq = nextSeq()

  await runEvents(indexer, [
    profileCreate({ did, record: { description: "original" } }),
    profileUpdate({
      did,
      seq: updateSeq,
      record: { description: undefined, displayName: "Renamed" }
    })
  ])

  const data = (await docs.doc(did).get()).data()
  assert.ok(data)
  assert.equal(data.displayName, "Renamed")
  assert.equal(
    data.description,
    undefined,
    "field dropped upstream must not survive the rewrite"
  )
  assert.equal(data.seq, updateSeq)
})

test("delete removes the doc", async () => {
  const { indexer, stats, docs } = fresh()
  const did = "did:plc:deletecase0000000000000a"

  await runEvents(indexer, [profileCreate({ did }), profileDelete({ did })])

  assert.equal((await docs.doc(did).get()).exists, false)
  assert.equal(stats.deletes, 1)
})

test("schema-invalid record is skipped without a partial write, and acked", async () => {
  const { indexer, stats, docs } = fresh()
  const did = "did:plc:invalidcase000000000000a"
  const seq = nextSeq()

  const { acked } = await runEvents(indexer, [
    profileCreate({ did, seq, record: { displayName: 123 } })
  ])

  assert.equal((await docs.doc(did).get()).exists, false, "no partial write")
  assert.deepEqual(stats, { creates: 0, updates: 0, deletes: 0, invalid: 1 })
  assert.deepEqual(acked, [seq], "invalid events are handled-and-acked")
})

test("replayed create is idempotent", async () => {
  const { indexer, docs } = fresh()
  const did = "did:plc:replaycase0000000000000a"
  const seq = nextSeq()
  const opts = { did, seq, record: { displayName: "Replayed" } }

  await runEvents(indexer, [profileCreate(opts)])
  const first = (await docs.doc(did).get()).data()
  await runEvents(indexer, [profileCreate(opts)])
  const second = (await docs.doc(did).get()).data()

  assert.ok(first && second)
  const strip = ({ indexedAt: _, ...rest }: Record<string, unknown>) => rest
  assert.deepEqual(strip(second), strip(first))
  assert.equal((await docs.get()).size, 1, "exactly one doc after replay")
})
