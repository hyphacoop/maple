import assert from "node:assert/strict"
import { test } from "node:test"
import { setPreserving } from "../src/preserve.js"
import { testDb, uniqueName } from "./harness.js"

const db = testDb()
const freshRef = () => db.collection(uniqueName("preserve")).doc("subject")

// The appview-owned shape the org.mapletestimony bill mapper will use,
// mirroring functions/src/bills/bills.ts.
const PRESERVED = { testimonyCount: 0, latestTestimonyAt: null }

test("preserved fields survive a rewrite; stale record fields do not", async () => {
  const ref = freshRef()
  await ref.set({
    title: "old title",
    staleField: "from a prior record shape",
    testimonyCount: 5,
    latestTestimonyAt: "2026-08-01T00:00:00.000Z"
  })

  await setPreserving(ref, { title: "new title" }, PRESERVED)

  const data = (await ref.get()).data()
  assert.deepEqual(data, {
    title: "new title",
    testimonyCount: 5,
    latestTestimonyAt: "2026-08-01T00:00:00.000Z"
  })
})

test("missing current doc applies defaults", async () => {
  const ref = freshRef()
  await setPreserving(ref, { title: "first write" }, PRESERVED)
  assert.deepEqual((await ref.get()).data(), {
    title: "first write",
    testimonyCount: 0,
    latestTestimonyAt: null
  })
})

test("current doc lacking a preserved field applies its default", async () => {
  const ref = freshRef()
  await ref.set({ title: "old", testimonyCount: 3 })

  await setPreserving(ref, { title: "new" }, PRESERVED)

  assert.deepEqual((await ref.get()).data(), {
    title: "new",
    testimonyCount: 3,
    latestTestimonyAt: null
  })
})
