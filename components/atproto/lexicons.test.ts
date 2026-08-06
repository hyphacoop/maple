import { maxTestimonyLength } from "components/db/testimony/types"
import testimonyLexicon from "../../lexicons/org/mapletestimony/testimony.json"

describe("org.mapletestimony lexicons", () => {
  // The lexicon JSON can't import the app constant, so enforce the link
  // here. The two limits still differ semantically — graphemes/inclusive vs
  // UTF-16 units/exclusive — see docs/atproto-spike-notes.md.
  it("testimony content limit matches the app's maxTestimonyLength", () => {
    const content = testimonyLexicon.defs.main.record.properties.content
    expect(content.maxGraphemes).toBe(maxTestimonyLength)
  })
})
