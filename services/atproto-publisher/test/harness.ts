import type { Firestore } from "firebase-admin/firestore"
import { initFirestore } from "../src/db.js"

/** Emulator-only Firestore handle, mirroring the consumer's test harness: the
 * default guarantees a test can never reach a real project. */
export function testDb(): Firestore {
  process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080"
  return initFirestore("demo-dtp")
}

/** Stands in for the PDS. Records every put so a test can assert not just what
 * was written but how many times — which is the whole point of the diff.
 *
 * Structurally typed against the real client rather than cast, so a change to
 * PdsClient.putRecord's signature breaks the fake at compile time. */
export class FakePds {
  readonly did = "did:plc:fake"
  readonly puts: { collection: string; rkey: string; record: object }[] = []

  async putRecord(collection: string, rkey: string, record: object) {
    this.puts.push({ collection, rkey, record })
    return {
      uri: `at://${this.did}/${collection}/${rkey}`,
      cid: `bafyfake${this.puts.length}`
    }
  }
}
