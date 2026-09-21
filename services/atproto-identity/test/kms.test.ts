import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto"
import { describe, it } from "node:test"
import { Secp256k1PrivateKey, Secp256k1PublicKey } from "@atcute/crypto"
import { isSignedOperationValid, signOperation } from "@atcute/did-plc"
import { generateKey } from "../src/keys.js"
import {
  derToCompactLowS,
  formatKmsResource,
  KmsPrivateKey,
  parseKmsResource,
  pemToCompressedPoint,
  type KmsBackend
} from "../src/kms.js"
import { genesisOperation } from "../src/plc.js"
import { parseSpec, type IdentitySpec } from "../src/spec.js"

/**
 * No gcloud, no network. A "backend" over a local node:crypto secp256k1 key
 * behaves exactly like Cloud KMS at the interface we use: SPKI PEM out, a DER
 * ECDSA signature over sha256(data) in. Everything between that and a valid
 * PLC operation is what these tests cover.
 */
function localBackend() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "secp256k1"
  })
  const pem = publicKey.export({ format: "pem", type: "spki" }).toString()
  // Uncompressed SEC1 point (0x04 || x || y) is the tail of the SPKI DER;
  // compress it by hand so this does not lean on the code under test.
  const point = publicKey.export({ format: "der", type: "spki" }).subarray(-65)
  const rawPublic = new Uint8Array(33)
  rawPublic[0] = (point[64] & 1) === 0 ? 0x02 : 0x03
  rawPublic.set(point.subarray(1, 33), 1)
  const backend: KmsBackend = {
    publicKeyPem: async () => pem,
    sign: async data =>
      new Uint8Array(
        nodeSign("sha256", data, { key: privateKey, dsaEncoding: "der" })
      )
  }
  return { backend, privateKey, rawPublic }
}

const KEY =
  "projects/digital-testimony-dev/locations/us-central1/keyRings/atproto/cryptoKeys/identity-ops"

describe("parseKmsResource", () => {
  it("defaults to version 1 when given the cryptoKey", () => {
    assert.deepEqual(parseKmsResource(KEY), {
      project: "digital-testimony-dev",
      location: "us-central1",
      keyRing: "atproto",
      key: "identity-ops",
      version: "1"
    })
  })
  it("keeps an explicit cryptoKeyVersion", () => {
    const v = parseKmsResource(`${KEY}/cryptoKeyVersions/3`)
    assert.equal(v.version, "3")
    assert.equal(formatKmsResource(v), `${KEY}/cryptoKeyVersions/3`)
  })
  it("rejects anything else", () => {
    assert.throws(
      () => parseKmsResource("atproto-identity-ops-key"),
      /not a Cloud KMS key/
    )
    assert.throws(() => parseKmsResource(`${KEY}/extra`), /not a Cloud KMS key/)
  })
})

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/** s from a DER ECDSA signature, parsed independently of the code under test. */
function derS(der: Uint8Array): bigint {
  let i = 2 // SEQUENCE, short-form length (a 64-byte sig is always < 128)
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f)
  const rLen = der[i + 1]
  i += 2 + rLen // skip INTEGER r
  const sLen = der[i + 1]
  let v = 0n
  for (const b of der.subarray(i + 2, i + 2 + sLen)) v = (v << 8n) | BigInt(b)
  return v
}

describe("derToCompactLowS", () => {
  it("produces signatures @atcute/crypto accepts, including when KMS hands back high-S", async () => {
    const { privateKey, rawPublic } = localBackend()
    const pub = await Secp256k1PublicKey.importRaw(rawPublic)
    let sawHighS = false
    // ECDSA s is high roughly half the time; 40 tries makes missing both
    // branches a 1-in-10^12 event.
    for (let n = 0; n < 40; n++) {
      const data = new Uint8Array(
        createHash("sha256").update(`msg-${n}`).digest()
      )
      const der = new Uint8Array(
        nodeSign("sha256", data, { key: privateKey, dsaEncoding: "der" })
      )
      const compact = derToCompactLowS(der)
      assert.equal(compact.length, 64)
      const s = derS(der)
      const expectS = s > N >> 1n ? N - s : s
      if (s > N >> 1n) sawHighS = true
      let got = 0n
      for (const b of compact.subarray(32)) got = (got << 8n) | BigInt(b)
      assert.equal(got, expectS)
      assert.equal(await pub.verify(compact, data), true, "low-S verify")
    }
    assert.equal(sawHighS, true, "at least one high-S signature was normalised")
  })
  it("rejects malformed DER", () => {
    assert.throws(
      () => derToCompactLowS(new Uint8Array([0x30, 0x02, 0x02, 0x00])),
      /bad DER/
    )
    assert.throws(() => derToCompactLowS(new Uint8Array(64)), /bad DER/)
  })
})

describe("pemToCompressedPoint", () => {
  it("matches the point compressed by hand from the SPKI", async () => {
    const { backend, rawPublic } = localBackend()
    assert.deepEqual(
      pemToCompressedPoint(await backend.publicKeyPem()),
      rawPublic
    )
  })
  it("refuses a key on the wrong curve", () => {
    const { publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1"
    })
    const pem = publicKey.export({ format: "pem", type: "spki" }).toString()
    assert.throws(() => pemToCompressedPoint(pem), /not secp256k1/)
  })
})

describe("KmsPrivateKey", () => {
  it("reports the did:key @atcute/crypto derives for the same point", async () => {
    const { backend, rawPublic } = localBackend()
    const key = await KmsPrivateKey.load(backend)
    // A locally generated keypair exports its did:key through the library's
    // own path; feed it our encoder's input to compare encoders.
    const local = await Secp256k1PrivateKey.importRaw(
      Uint8Array.from(Buffer.from((await generateKey()).privateKeyHex, "hex"))
    )
    const { didKeyFor } = await import("../src/kms.js")
    assert.equal(
      didKeyFor(await local.exportPublicKey("raw")),
      await local.exportPublicKey("did")
    )
    assert.equal(await key.exportPublicKey("did"), didKeyFor(rawPublic))
    assert.deepEqual(await key.exportPublicKey("raw"), rawPublic)
    assert.equal(key.type, "secp256k1")
    assert.equal(key.jwtAlg, "ES256K")
  })

  it("signs a genesis operation the PLC library attributes to the KMS did:key", async () => {
    const { backend } = localBackend()
    const ops = await KmsPrivateKey.load(backend)
    const recovery = await generateKey()
    const signing = await generateKey()
    const spec = parseSpec(
      {
        did: "",
        handle: "maple.test",
        pdsEndpoint: "http://localhost:2583",
        plcUrl: "http://localhost:2582",
        rotationKeys: [recovery.didKey, ops.didKey],
        verificationMethods: { atproto: signing.didKey }
      },
      "test"
    ) as IdentitySpec
    const { did, op } = await genesisOperation(spec, ops)
    assert.match(did, /^did:plc:/)
    assert.equal(
      await isSignedOperationValid([recovery.didKey, ops.didKey], op),
      ops.didKey
    )
  })

  it("interoperates with signOperation exactly like a local Secp256k1PrivateKey", async () => {
    const { backend } = localBackend()
    const kms = await KmsPrivateKey.load(backend)
    const local = await Secp256k1PrivateKey.importRaw(
      Uint8Array.from(Buffer.from((await generateKey()).privateKeyHex, "hex"))
    )
    const rotationKeys = [kms.didKey, await local.exportPublicKey("did")]
    const unsigned = {
      type: "plc_operation" as const,
      rotationKeys,
      verificationMethods: {},
      alsoKnownAs: [],
      services: {},
      prev: null
    }
    for (const key of [kms, local]) {
      const signed = await signOperation(unsigned, key)
      assert.equal(
        await isSignedOperationValid(rotationKeys, signed),
        await key.exportPublicKey("did")
      )
    }
  })

  it("refuses to hand back a signature that does not verify", async () => {
    const { backend } = localBackend()
    const bad: KmsBackend = {
      publicKeyPem: backend.publicKeyPem,
      sign: async d => {
        const der = await backend.sign(d)
        der[der.length - 1] ^= 0x01 // corrupt s
        return der
      }
    }
    const key = await KmsPrivateKey.load(bad)
    await assert.rejects(key.sign(new Uint8Array([1, 2, 3])), /does not verify/)
  })
})
