import assert from "node:assert/strict"
import { test } from "node:test"
import { FirestoreCursorStore } from "../src/cursor-store.js"
import { testDb, uniqueName } from "./harness.js"

const db = testDb()
const COALESCE_MS = 25
const freshPath = () => `${uniqueName("cursorMeta")}/cursor`

test("rapid saves coalesce into one write holding the last seq", async () => {
  const path = freshPath()
  const store = new FirestoreCursorStore(db, path, COALESCE_MS)

  const p1 = store.save(1)
  const p2 = store.save(2)
  const p3 = store.save(3)
  assert.equal(p1, p2, "saves within the window share one pending write")
  assert.equal(p2, p3)
  await p1

  assert.equal((await db.doc(path).get()).get("seq"), 3, "last seq wins")

  const p4 = store.save(4)
  assert.notEqual(p4, p1, "a save after the flush starts a new window")
  await p4
  assert.equal((await db.doc(path).get()).get("seq"), 4)
})

test("save resolves only after a durable write (shutdown-flush contract)", async () => {
  const path = freshPath()
  await new FirestoreCursorStore(db, path, COALESCE_MS).save(42)

  const rereader = new FirestoreCursorStore(db, path, COALESCE_MS)
  assert.equal(await rereader.load(), 42)
})

test("load is memoized", async () => {
  const path = freshPath()
  const store = new FirestoreCursorStore(db, path, COALESCE_MS)

  const first = store.load()
  assert.equal(await first, undefined, "missing doc reads as no cursor")

  await db.doc(path).set({ seq: 7 })
  assert.equal(store.load(), first, "second load returns the same promise")
  assert.equal(await store.load(), undefined, "memoized value, not a re-read")
})

test("non-numeric seq reads as no cursor", async () => {
  const path = freshPath()
  await db.doc(path).set({ seq: "abc" })
  assert.equal(
    await new FirestoreCursorStore(db, path, COALESCE_MS).load(),
    undefined
  )
})
