import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import {
  borrowedRotationKeys,
  parseSpec,
  PDS_SERVICE_ID,
  PDS_SERVICE_TYPE,
  readSpec,
  specToOperation,
  specToState,
  requirePlcUrl,
  updateSpec,
  type IdentitySpec
} from "../src/spec.js"

const RECOVERY = "did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme"
const OPS = "did:key:zQ3shqAP9hyxbtsQCUzsG5PN1JJTa3Z6zjSDA8UkeVeGkQvMY"
const SIGNING = "did:key:zQ3shWDPPCAiCEqLdXZ3g5Q3EdSFsDGYvW5xVvfWD6ymeXKhr"
const OTHER = "did:key:zQ3shrCJWiSTbLYQNyd5CzXtRcvSHKGhs9LSXtV1BpsY6R2N7"

const valid = (over: Partial<IdentitySpec> = {}): unknown => ({
  did: "",
  handle: "maple.test",
  pdsEndpoint: "http://localhost:2583",
  plcUrl: "http://localhost:2582",
  rotationKeys: [RECOVERY, OPS],
  verificationMethods: { atproto: SIGNING },
  ...over
})

const scratchSpec = (spec: unknown): URL => {
  const dir = mkdtempSync(join(tmpdir(), "identity-spec-"))
  const path = join(dir, "harness.json")
  writeFileSync(path, JSON.stringify(spec, null, 2) + "\n")
  return new URL(`file://${path}`)
}

describe("parseSpec", () => {
  it("accepts a well-formed spec", () => {
    const spec = parseSpec(valid(), "test")
    assert.equal(spec.handle, "maple.test")
    assert.deepEqual(spec.rotationKeys, [RECOVERY, OPS])
  })

  it("accepts an unminted spec with no rotation keys yet", () => {
    // The spec is committed and reviewed before the recovery key is generated
    // offline, so this shape has to be legal.
    const spec = parseSpec(
      valid({ rotationKeys: [], verificationMethods: { atproto: "" } }),
      "test"
    )
    assert.deepEqual(spec.rotationKeys, [])
    assert.equal(spec.did, "")
  })

  it("rejects an empty rotation key list once a did exists", () => {
    assert.throws(
      () => parseSpec(valid({ did: "did:plc:abc", rotationKeys: [] }), "test"),
      /rotationKeys must not be empty/
    )
  })

  it("rejects duplicate rotation keys", () => {
    assert.throws(
      () => parseSpec(valid({ rotationKeys: [OPS, OPS] }), "test"),
      /duplicates/
    )
  })

  it("rejects a rotation key that is not a did:key", () => {
    assert.throws(
      () => parseSpec(valid({ rotationKeys: ["zQ3sabc"] }), "test"),
      /rotationKeys\[0\]/
    )
  })

  it("rejects a handle carrying the at:// prefix", () => {
    assert.throws(
      () => parseSpec(valid({ handle: "at://maple.test" }), "test"),
      /at:\/\/ prefix/
    )
  })

  it("rejects a non-http pdsEndpoint", () => {
    assert.throws(
      () => parseSpec(valid({ pdsEndpoint: "pds.example" }), "test"),
      /http\(s\) URL/
    )
  })

  it("rejects a did that is not did:plc", () => {
    assert.throws(
      () => parseSpec(valid({ did: "did:web:example.com" }), "test"),
      /did:plc/
    )
  })
})

describe("requirePlcUrl", () => {
  it("refuses an empty plcUrl rather than defaulting to plc.directory", () => {
    const spec = parseSpec(valid({ plcUrl: "" }), "test")
    assert.throws(
      () => requirePlcUrl(spec),
      /must name a PLC directory explicitly/
    )
  })

  it("trims a trailing slash so URLs are built consistently", () => {
    const spec = parseSpec(valid({ plcUrl: "http://localhost:2582/" }), "test")
    assert.equal(requirePlcUrl(spec), "http://localhost:2582")
  })
})

describe("specToState", () => {
  it("produces the shape the directory returns", () => {
    const state = specToState(parseSpec(valid(), "test"))
    assert.deepEqual(state, {
      rotationKeys: [RECOVERY, OPS],
      verificationMethods: { atproto: SIGNING },
      alsoKnownAs: ["at://maple.test"],
      services: {
        [PDS_SERVICE_ID]: {
          type: PDS_SERVICE_TYPE,
          endpoint: "http://localhost:2583"
        }
      }
    })
  })

  it("omits the signing key entirely while it is unset", () => {
    const state = specToState(
      parseSpec(valid({ verificationMethods: { atproto: "" } }), "test")
    )
    assert.deepEqual(state.verificationMethods, {})
  })
})

describe("specToOperation", () => {
  it("builds a genesis operation with a null prev", () => {
    const op = specToOperation(parseSpec(valid(), "test"), null)
    assert.equal(op.type, "plc_operation")
    assert.equal(op.prev, null)
    assert.deepEqual(op.alsoKnownAs, ["at://maple.test"])
  })

  it("carries prev through for an update", () => {
    const op = specToOperation(parseSpec(valid(), "test"), "bafyprev")
    assert.equal(op.prev, "bafyprev")
  })
})

describe("updateSpec", () => {
  it("writes one field back and leaves the rest alone", () => {
    const path = scratchSpec(valid())
    const next = updateSpec(path, { did: "did:plc:kf6ry3mhqpolvz2unqhnfk4l" })
    assert.equal(next.did, "did:plc:kf6ry3mhqpolvz2unqhnfk4l")

    const onDisk = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >
    assert.equal(onDisk.handle, "maple.test")
    assert.equal(onDisk.plcUrl, "http://localhost:2582")
    assert.deepEqual(onDisk.rotationKeys, [RECOVERY, OPS])
  })

  it("is idempotent: re-reading gives the same spec", () => {
    const path = scratchSpec(valid())
    const first = updateSpec(path, { did: "did:plc:kf6ry3mhqpolvz2unqhnfk4l" })
    assert.deepEqual(readSpec(path), first)
    const second = updateSpec(path, { did: "did:plc:kf6ry3mhqpolvz2unqhnfk4l" })
    assert.deepEqual(second, first)
  })

  it("refuses to write a value that would make the spec invalid", () => {
    const path = scratchSpec(valid())
    assert.throws(
      () => updateSpec(path, { handle: "at://nope" }),
      /at:\/\/ prefix/
    )
  })
})

describe("borrowedRotationKeys", () => {
  const PDS = "did:key:zQ3shjNSBChNYuYsW41QDdm2D25zmQkdpfhgbaQBRG4ecg7sk"

  it("names the PDS key the spec does not list", () => {
    const spec = parseSpec(
      valid({ did: "did:plc:kf6ry3mhqpolvz2unqhnfk4l" }),
      "test"
    )
    assert.deepEqual(borrowedRotationKeys(spec, [PDS]), [PDS])
  })

  it("borrows nothing when the spec already lists everything the PDS wants", () => {
    // The [recovery, ops, pds] configuration, if anyone ever chooses it: there
    // is then no transient operation to make at all.
    const spec = parseSpec(
      valid({ rotationKeys: [RECOVERY, OPS, PDS] }),
      "test"
    )
    assert.deepEqual(borrowedRotationKeys(spec, [PDS]), [])
  })

  it("borrows every recommended key, not just the last", () => {
    // PDS_RECOVERY_DID_KEY, if the server sets one, is prepended to the PDS's
    // own key in getRecommendedDidCredentials.
    const spec = parseSpec(valid(), "test")
    assert.deepEqual(borrowedRotationKeys(spec, [OTHER, PDS]), [OTHER, PDS])
  })
})
