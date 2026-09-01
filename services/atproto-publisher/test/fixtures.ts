import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Timestamp } from "firebase-admin/firestore"

/** Firestore documents cannot be plain JSON — they hold Timestamps — so the
 * doc fixtures encode them as `{"__ts": "<iso>"}` and this revives them. */
const revive = (v: any): any => {
  if (v && typeof v === "object" && typeof v.__ts === "string") {
    return Timestamp.fromMillis(Date.parse(v.__ts))
  }
  if (Array.isArray(v)) return v.map(revive)
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]))
  }
  return v
}

/** Resolved from this file rather than the cwd, so the e2e driver in scripts/
 * loads the same documents the unit tests do no matter where it is launched. */
const load = (name: string) =>
  revive(
    JSON.parse(
      readFileSync(join(import.meta.dirname, "../fixtures", name), "utf8")
    )
  )

export const billDoc = () => load("bill.doc.json")
export const hearingDoc = () => load("hearing.doc.json")

/**
 * The EXPECTED records are the consumer's fixtures, read across the package
 * boundary on purpose: they are the one canonical definition of "a valid MAPLE
 * record", shared by the consumer's validator, its synthetic event builders and
 * its smoke test's seeder. Copying them here would let the two drift silently.
 * This is a plain file read at test time only. The two packages are separate
 * deploy units, so what may cross the boundary is narrow: data like this, and
 * modules with no imports of their own (src/rkeys.js, the consumer's
 * test/wait.js). Nothing with dependencies, and nothing from either src/ that
 * ships.
 */
const CONSUMER_FIXTURES = "../atproto-consumer/fixtures/"
export const billRecordFixture = () =>
  JSON.parse(readFileSync(CONSUMER_FIXTURES + "bill.record.json", "utf8"))
export const hearingRecordFixture = () =>
  JSON.parse(readFileSync(CONSUMER_FIXTURES + "hearing.record.json", "utf8"))
