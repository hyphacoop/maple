/** Validates the org.mapletestimony.* lexicon documents and the shared record
 * fixtures. Run with `yarn validate`; CI runs it in the Consumer Checks job.
 *
 * Two things are checked, and they cover different failures:
 *
 *  1. Every lexicon document under lexicons/ is registered in src/records.ts.
 *     Codegen drift is caught separately (CI re-runs `yarn codegen` and fails
 *     on a dirty tree); this catches a lexicon that was added and generated
 *     but never wired up, which would otherwise just never be indexed.
 *
 *  2. Every registered fixture validates against its schema. The fixtures are
 *     the single source of the sample records used by the unit tests AND by
 *     infra/atproto/seed.sh, so an invalid fixture would otherwise surface as
 *     a mysterious onValidationError in the e2e harness.
 *
 * Cross-checking mapper output against the app's runtypes (functions/src/…)
 * cannot happen here: those are CJS on the root toolchain. That check lands with the
 * runtypes cross-check, once both toolchains meet.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { RecordSchema } from "@atproto/lex"
import * as maple from "../src/lexicons/org/mapletestimony.js"
import { recordTypes } from "../src/records.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const lexiconDir = join(here, "../../../lexicons")
const fixtureDir = join(here, "../fixtures")

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"))

/** nsid -> generated schema, straight off the generated namespace index, so a
 * new lexicon needs no edit here. */
const schemas = new Map<string, RecordSchema>(
  Object.values(maple).map(m => [m.$nsid, m.main])
)

const lexiconIds = () =>
  readdirSync(lexiconDir, { recursive: true, encoding: "utf8" })
    .filter(f => f.endsWith(".json"))
    .map(f => readJson(join(lexiconDir, f)).id as string)

function main() {
  const ids = lexiconIds()
  if (ids.length === 0) throw new Error(`no lexicon documents in ${lexiconDir}`)

  const registered = new Set(recordTypes.map(t => t.nsid))
  const unwired = ids.filter(id => !registered.has(id))
  if (unwired.length)
    throw new Error(`not registered in src/records.ts: ${unwired.join(", ")}`)

  for (const type of recordTypes) {
    const schema = schemas.get(type.nsid)
    if (!schema) throw new Error(`${type.nsid} has no generated schema`)
    schema.validate(readJson(join(fixtureDir, type.fixture)))
    console.log(`ok  ${type.nsid}  (${type.fixture})`)
  }

  console.log(`${ids.length} lexicon document(s) valid`)
}

main()
