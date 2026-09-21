import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import {
  deriveDidFromGenesisOp,
  isSignedOperationValid,
  validateIncomingOp
} from "@atcute/did-plc"
import {
  applyGenesis,
  assertSafeRotationKeys,
  SafetyError
} from "../src/apply.js"
import { generateKey, importPrivateKey } from "../src/keys.js"
import { genesisOperation } from "../src/plc.js"
import { parseSpec, readSpec, type IdentitySpec } from "../src/spec.js"

/**
 * No network: everything here is op construction, signing and the safety rails.
 * The live-directory half is infra/atproto/identity-check.sh, which runs the
 * same code against the harness's real did-plc server.
 */

const scratchSpec = (spec: unknown): URL => {
  const dir = mkdtempSync(join(tmpdir(), "identity-op-"))
  const path = join(dir, "harness.json")
  writeFileSync(path, JSON.stringify(spec, null, 2) + "\n")
  return new URL(`file://${path}`)
}

async function freshSpec(over: Record<string, unknown> = {}) {
  const recovery = await generateKey()
  const ops = await generateKey()
  const signing = await generateKey()
  const json = {
    did: "",
    handle: "maple.test",
    pdsEndpoint: "http://localhost:2583",
    plcUrl: "http://localhost:2582",
    rotationKeys: [recovery.didKey, ops.didKey],
    verificationMethods: { atproto: signing.didKey },
    ...over
  }
  return {
    json,
    recovery,
    ops,
    signing,
    spec: parseSpec(json, "test") as IdentitySpec
  }
}

describe("genesisOperation", () => {
  it("produces an operation the library's own pre-submit validator accepts", async () => {
    const { spec, ops } = await freshSpec()
    const key = await importPrivateKey(ops.privateKeyHex)
    const { op } = await genesisOperation(spec, key)

    assert.doesNotThrow(() => validateIncomingOp(op))
    assert.equal(op.type, "plc_operation")
    assert.equal(op.prev, null)
  })

  it("signs with the ops key, and the signature verifies against its did:key", async () => {
    const { spec, ops, recovery } = await freshSpec()
    const key = await importPrivateKey(ops.privateKeyHex)
    const { op } = await genesisOperation(spec, key)

    assert.equal(await isSignedOperationValid([ops.didKey], op), ops.didKey)
    // The recovery key did not sign this one, so it must not validate as signer.
    assert.equal(await isSignedOperationValid([recovery.didKey], op), null)
  })

  it("derives the same did the library derives from the signed operation", async () => {
    const { spec, ops } = await freshSpec()
    const key = await importPrivateKey(ops.privateKeyHex)
    const { did, op } = await genesisOperation(spec, key)

    assert.equal(did, await deriveDidFromGenesisOp(op))
    assert.match(did, /^did:plc:[a-z2-7]{24}$/)
  })

  it("mints a different identity every time, which is why genesis is guarded", async () => {
    const a = await freshSpec()
    const b = await freshSpec()
    const first = await genesisOperation(
      a.spec,
      await importPrivateKey(a.ops.privateKeyHex)
    )
    const second = await genesisOperation(
      b.spec,
      await importPrivateKey(b.ops.privateKeyHex)
    )
    assert.notEqual(first.did, second.did)
  })
})

describe("importPrivateKey", () => {
  it("round-trips the hex form the PDS and Secret Manager use", async () => {
    const generated = await generateKey()
    const key = await importPrivateKey(generated.privateKeyHex)
    assert.equal(await key.exportPublicKey("did"), generated.didKey)
  })

  it("accepts leading and trailing whitespace, as `gcloud ... access` emits", async () => {
    const generated = await generateKey()
    const key = await importPrivateKey(`\n  ${generated.privateKeyHex}  \n`)
    assert.equal(await key.exportPublicKey("did"), generated.didKey)
  })

  it("rejects material that is neither hex nor a multikey", async () => {
    await assert.rejects(
      () => importPrivateKey("not-a-key"),
      /neither a multikey/
    )
  })

  it("rejects a key of the wrong length rather than padding it", async () => {
    await assert.rejects(() => importPrivateKey("abcd"), /32 bytes/)
  })

  it("rejects empty material", async () => {
    await assert.rejects(() => importPrivateKey("   "), /empty/)
  })
})

describe("assertSafeRotationKeys", () => {
  const recovery = "did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme"
  const ops = "did:key:zQ3shqAP9hyxbtsQCUzsG5PN1JJTa3Z6zjSDA8UkeVeGkQvMY"
  const fresh = "did:key:zQ3shrCJWiSTbLYQNyd5CzXtRcvSHKGhs9LSXtV1BpsY6R2N7"

  it("allows rotating the ops key while the recovery key stays first", () => {
    assert.doesNotThrow(() =>
      assertSafeRotationKeys([recovery, ops], [recovery, fresh], false)
    )
  })

  it("refuses to empty the list, even with --i-mean-it", () => {
    assert.throws(
      () => assertSafeRotationKeys([recovery, ops], [], true),
      SafetyError
    )
  })

  it("refuses to drop the recovery key without --i-mean-it", () => {
    assert.throws(
      () => assertSafeRotationKeys([recovery, ops], [ops], false),
      /removes the FIRST rotation key/
    )
    assert.doesNotThrow(() =>
      assertSafeRotationKeys([recovery, ops], [ops], true)
    )
  })

  it("refuses to replace every key at once without --i-mean-it", () => {
    // Nothing that currently holds a key could nullify the result.
    assert.throws(
      () => assertSafeRotationKeys([ops], [fresh], false),
      /replaces every existing/
    )
  })
})

describe("applyGenesis guards", () => {
  it("refuses when the spec already names a did", async () => {
    const { json, ops } = await freshSpec({
      did: "did:plc:kf6ry3mhqpolvz2unqhnfk4l"
    })
    const path = scratchSpec(json)
    const key = await importPrivateKey(ops.privateKeyHex)
    await assert.rejects(
      () => applyGenesis(path, readSpec(path), key),
      /Genesis mints a NEW identity/
    )
  })

  it("refuses a spec with no rotation keys", async () => {
    const { json, ops } = await freshSpec({ rotationKeys: [] })
    const path = scratchSpec(json)
    const key = await importPrivateKey(ops.privateKeyHex)
    await assert.rejects(
      () => applyGenesis(path, readSpec(path), key),
      /no rotationKeys/
    )
  })

  it("refuses a spec with no signing key", async () => {
    const { json, ops } = await freshSpec({
      verificationMethods: { atproto: "" }
    })
    const path = scratchSpec(json)
    const key = await importPrivateKey(ops.privateKeyHex)
    await assert.rejects(
      () => applyGenesis(path, readSpec(path), key),
      /needs a signing key/
    )
  })
})
