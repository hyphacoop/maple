/** Validates the org.mapletestimony.* lexicon documents and sample records.
 *
 * 1. Loads every JSON under lexicons/ into an @atproto/lexicon Lexicons
 *    container (alongside the stock schemas from @atproto/api, which supply
 *    com.atproto.repo.strongRef) — this throws if a document is invalid.
 * 2. Builds records from the shared sample fixtures with the real mappers,
 *    asserts they validate, and asserts record -> app type -> record
 *    round-trips are stable.
 *
 * Run with: yarn atp:validate
 */
import { schemas } from "@atproto/api"
import { LexiconDoc, Lexicons } from "@atproto/lexicon"
import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import {
  billFromRecord,
  billToRecord,
  testimonyFromRecord,
  testimonyToRecord
} from "components/atproto/mappers"
import { billNsid, testimonyNsid } from "components/atproto/lexicons"
import { sampleBill, sampleBillRef, sampleTestimony } from "./fixtures"

const lexiconDir = join(__dirname, "../../lexicons")

const assertStable = (label: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} record round-trip mismatch`)
  }
}

function main() {
  const docs = readdirSync(lexiconDir, { recursive: true, encoding: "utf8" })
    .filter(f => f.endsWith(".json"))
    .map(
      f => JSON.parse(readFileSync(join(lexiconDir, f), "utf8")) as LexiconDoc
    )
  // Constructor validates each document against the lexicon meta-schema.
  const lexicons = new Lexicons([...schemas, ...docs])
  console.log(`Loaded ${docs.length} valid lexicon documents:`)
  for (const doc of docs) console.log(`  ${doc.id}`)

  const billRecord = billToRecord(sampleBill)
  lexicons.assertValidRecord(billNsid, billRecord)
  console.log(`\n${billNsid}: sample record valid`)

  const billRef = sampleBillRef("did:plc:maple")
  const testimonyRecord = testimonyToRecord(sampleTestimony, billRef)
  lexicons.assertValidRecord(testimonyNsid, testimonyRecord)
  console.log(`${testimonyNsid}: sample record valid`)

  assertStable("bill", billToRecord(billFromRecord(billRecord)), billRecord)
  assertStable(
    "testimony",
    testimonyToRecord(
      testimonyFromRecord(testimonyRecord, {
        did: sampleTestimony.authorUid,
        handle: sampleTestimony.authorDisplayName,
        rkey: sampleTestimony.id,
        billTitle: sampleTestimony.billTitle
      }),
      billRef
    ),
    testimonyRecord
  )
  console.log("round-trip (record -> app type -> record) stable")

  console.log("\nAll lexicon validations passed.")
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
