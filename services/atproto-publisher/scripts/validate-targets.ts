import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { recordTypes } from "../src/records.js"

/**
 * Guards the seam between lexicons/*.json and this package.
 *
 * Adding a lexicon without adding a record type is silent: the record type
 * simply never gets published, and nothing fails. The consumer has the mirror
 * of this check (its validate-lexicons.ts asserts every lexicon has a
 * registered schema); this one asserts every lexicon has somewhere to publish
 * FROM. Between them, a new record type cannot be half-wired.
 *
 * It walks records.ts rather than naming types, so adding one needs no edit
 * here — the lockstep-edit failure this check exists to catch would otherwise
 * apply to the check itself.
 */

const LEXICON_DIR = join(import.meta.dirname, "../../../lexicons")

const published = new Set(recordTypes.map(t => t.nsid))

const docs = readdirSync(LEXICON_DIR, { recursive: true, encoding: "utf8" })
  .filter(f => f.endsWith(".json"))
  .map(
    f =>
      JSON.parse(readFileSync(join(LEXICON_DIR, f), "utf8")) as { id: string }
  )

if (docs.length === 0) {
  throw new Error(`No lexicon documents found under ${LEXICON_DIR}`)
}

const missing = docs.map(d => d.id).filter(id => !published.has(id))
if (missing.length > 0) {
  throw new Error(
    `Lexicons with no entry in src/records.ts: ${missing.join(", ")}`
  )
}

const unknown = [...published].filter(nsid => !docs.some(d => d.id === nsid))
if (unknown.length > 0) {
  throw new Error(
    `Record types in src/records.ts with no lexicon document: ${unknown.join(
      ", "
    )}`
  )
}

console.log(`All ${docs.length} lexicons have a publisher record type:`)
for (const d of docs) console.log(`  ${d.id}`)
