import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PlcState } from "@atcute/did-plc"
import {
  diffState,
  exitCodeFor,
  formatPlan,
  type PlanResult
} from "../src/plan.js"
import {
  parseSpec,
  PDS_SERVICE_ID,
  PDS_SERVICE_TYPE,
  type IdentitySpec
} from "../src/spec.js"

const RECOVERY = "did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme"
const OPS = "did:key:zQ3shqAP9hyxbtsQCUzsG5PN1JJTa3Z6zjSDA8UkeVeGkQvMY"
const SIGNING = "did:key:zQ3shWDPPCAiCEqLdXZ3g5Q3EdSFsDGYvW5xVvfWD6ymeXKhr"
const OTHER = "did:key:zQ3shrCJWiSTbLYQNyd5CzXtRcvSHKGhs9LSXtV1BpsY6R2N7"
const DID = "did:plc:kf6ry3mhqpolvz2unqhnfk4l"

const spec = (over: Partial<IdentitySpec> = {}): IdentitySpec =>
  parseSpec(
    {
      did: DID,
      handle: "maple.test",
      pdsEndpoint: "http://localhost:2583",
      plcUrl: "http://localhost:2582",
      rotationKeys: [RECOVERY, OPS],
      verificationMethods: { atproto: SIGNING },
      ...over
    },
    "test"
  )

const live = (over: Partial<PlcState> = {}): PlcState =>
  ({
    did: DID,
    rotationKeys: [RECOVERY, OPS],
    verificationMethods: { atproto: SIGNING },
    alsoKnownAs: ["at://maple.test"],
    services: {
      [PDS_SERVICE_ID]: {
        type: PDS_SERVICE_TYPE,
        endpoint: "http://localhost:2583"
      }
    },
    ...over
  } as PlcState)

describe("diffState", () => {
  it("reports nothing when the document matches", () => {
    assert.deepEqual(diffState(live(), spec()), [])
  })

  it("catches a handle change", () => {
    const changes = diffState(live({ alsoKnownAs: ["at://old.test"] }), spec())
    assert.equal(changes.length, 1)
    assert.equal(changes[0]?.field, "alsoKnownAs")
  })

  it("catches a rotation key rotation, including reordering", () => {
    assert.equal(
      diffState(live({ rotationKeys: [OPS, RECOVERY] }), spec()).length,
      1
    )
    assert.equal(diffState(live({ rotationKeys: [OPS] }), spec()).length, 1)
  })

  it("catches an endpoint change", () => {
    const changes = diffState(
      live({
        services: {
          [PDS_SERVICE_ID]: {
            type: PDS_SERVICE_TYPE,
            endpoint: "https://evil.example"
          }
        }
      }),
      spec()
    )
    assert.deepEqual(
      changes.map(c => c.field),
      [`services.${PDS_SERVICE_ID}`]
    )
  })

  it("catches a service the spec does not claim at all", () => {
    const changes = diffState(
      live({
        services: {
          [PDS_SERVICE_ID]: {
            type: PDS_SERVICE_TYPE,
            endpoint: "http://localhost:2583"
          },
          extra: { type: "Something", endpoint: "https://elsewhere.example" }
        }
      }),
      spec()
    )
    assert.deepEqual(
      changes.map(c => c.field),
      ["services.extra"]
    )
  })

  it("catches a signing key change", () => {
    const changes = diffState(
      live({ verificationMethods: { atproto: OTHER } }),
      spec()
    )
    assert.deepEqual(
      changes.map(c => c.field),
      ["verificationMethods.atproto"]
    )
  })

  it("ignores the signing key while the spec has not adopted one", () => {
    // Between genesis and the post-createAccount rotation the spec legitimately
    // has no signing key; that is reported as incomplete, not as drift.
    const changes = diffState(
      live({ verificationMethods: { atproto: OTHER } }),
      spec({ verificationMethods: { atproto: "" } })
    )
    assert.deepEqual(changes, [])
  })
})

describe("exitCodeFor", () => {
  it("is zero only when the document matches the spec", () => {
    const cases: [PlanResult, number][] = [
      [{ status: "clean", changes: [] }, 0],
      [{ status: "unminted", changes: [] }, 1],
      [{ status: "absent", changes: [] }, 1],
      [{ status: "drift", changes: [{ field: "x", live: "a", spec: "b" }] }, 1],
      [{ status: "incomplete", changes: [], reason: "why" }, 1]
    ]
    for (const [result, code] of cases) {
      assert.equal(exitCodeFor(result), code, result.status)
    }
  })
})

describe("formatPlan", () => {
  it("names the directory it read, so a plan cannot be mistaken for another env", () => {
    const out = formatPlan(spec(), { status: "clean", changes: [] })
    assert.match(out, /http:\/\/localhost:2582/)
    assert.match(out, new RegExp(DID))
  })

  it("shows both sides of every change", () => {
    const out = formatPlan(spec(), {
      status: "drift",
      changes: [
        {
          field: "alsoKnownAs",
          live: '["at://old.test"]',
          spec: '["at://maple.test"]'
        }
      ]
    })
    assert.match(out, /live: \["at:\/\/old.test"\]/)
    assert.match(out, /spec: \["at:\/\/maple.test"\]/)
  })
})
