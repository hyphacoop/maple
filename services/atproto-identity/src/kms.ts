import { execFile } from "node:child_process"
import { createHash, createPublicKey } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  SECP256K1_PUBLIC_PREFIX,
  verifySigWithDidKey,
  type DidKeyString,
  type PrivateKey,
  type VerifyOptions
} from "@atcute/crypto"
import { toBase58Btc } from "@atcute/multibase"

const exec = promisify(execFile)

/**
 * MAPLE's ops key lives in Cloud KMS (infra/gcp/kms.tf): an HSM-backed
 * secp256k1 signing key whose private bytes nobody ever holds. This is the
 * @atcute/crypto PrivateKey shape over that key, so @atcute/did-plc's
 * signOperation is none the wiser -- it hands us the DAG-CBOR bytes, we hand
 * back a 64-byte low-S signature, exactly as Secp256k1PrivateKey would.
 *
 * As with Secret Manager in keys.ts, KMS is reached by shelling out to gcloud
 * rather than taking a GCP SDK dependency: this tool sits inside the custody
 * boundary and its dependency tree stays as small as it can be. The signing
 * calls are also what make the audit log -- one entry per operation, naming
 * the person who ran this.
 */

/** A cryptoKeyVersion resource, split the way gcloud wants its flags. */
export interface KmsKeyVersion {
  project: string
  location: string
  keyRing: string
  key: string
  version: string
}

const RESOURCE =
  /^projects\/([^/]+)\/locations\/([^/]+)\/keyRings\/([^/]+)\/cryptoKeys\/([^/]+)(?:\/cryptoKeyVersions\/([^/]+))?$/

/**
 * Accepts the cryptoKey resource (terraform's `identity_ops_key` output) or a
 * specific cryptoKeyVersion. An asymmetric key has no "primary" version, so
 * the key alone means version 1 -- the one terraform creates. A rotated key
 * is named explicitly.
 */
export function parseKmsResource(resource: string): KmsKeyVersion {
  const m = RESOURCE.exec(resource.trim())
  if (!m) {
    throw new Error(
      `not a Cloud KMS key resource: ${resource} (expected projects/…/locations/…/keyRings/…/cryptoKeys/…[/cryptoKeyVersions/N])`
    )
  }
  const [, project, location, keyRing, key, version] = m
  return { project, location, keyRing, key, version: version ?? "1" }
}

export const formatKmsResource = (v: KmsKeyVersion): string =>
  `projects/${v.project}/locations/${v.location}/keyRings/${v.keyRing}/cryptoKeys/${v.key}/cryptoKeyVersions/${v.version}`

/**
 * The two calls that touch Google, behind an interface so the signature
 * plumbing (DER -> compact, low-S) is tested against a real local key and
 * the gcloud implementation stays a thin, obviously-correct shell.
 */
export interface KmsBackend {
  /** SubjectPublicKeyInfo PEM of the key version. */
  publicKeyPem(): Promise<string>
  /** DER-encoded ECDSA signature over sha256(data). */
  sign(data: Uint8Array): Promise<Uint8Array>
}

export function gcloudBackend(v: KmsKeyVersion): KmsBackend {
  const flags = [
    `--project=${v.project}`,
    `--location=${v.location}`,
    `--keyring=${v.keyRing}`,
    `--key=${v.key}`,
    `--version=${v.version}`
  ]
  // gcloud only writes these to files. A private scratch dir per call; the
  // contents are a public key, a digest and a signature, none of them secret.
  const withScratch = async <T>(
    fn: (dir: string) => Promise<T>
  ): Promise<T> => {
    const dir = mkdtempSync(join(tmpdir(), "identity-kms-"))
    try {
      return await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return {
    publicKeyPem: () =>
      withScratch(async dir => {
        const out = join(dir, "public.pem")
        await exec("gcloud", [
          "kms",
          "keys",
          "versions",
          "get-public-key",
          ...flags,
          `--output-file=${out}`
        ])
        return readFileSync(out, "utf8")
      }),
    sign: data =>
      withScratch(async dir => {
        const digest = join(dir, "digest")
        const sig = join(dir, "sig.der")
        // The HSM signs the digest we hand it: what leaves this machine is 32
        // bytes, not the operation. --digest-algorithm names how it was made.
        writeFileSync(digest, createHash("sha256").update(data).digest(), {
          mode: 0o600
        })
        await exec("gcloud", [
          "kms",
          "asymmetric-sign",
          ...flags,
          "--digest-algorithm=sha256",
          `--input-file=${digest}`,
          `--signature-file=${sig}`
        ])
        return new Uint8Array(readFileSync(sig))
      })
  }
}

// SEC 2, ver. 2.0, § 2.4.1 -- same constant @atcute/crypto uses internally.
const SECP256K1_CURVE_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/**
 * DER ECDSA-Sig-Value (SEQUENCE { INTEGER r, INTEGER s }) -> the 64-byte
 * r||s form atproto uses, with s normalised to low-S. Cloud KMS returns DER
 * and does not normalise; the PLC directory (via @atcute/crypto's verify)
 * rejects high-S signatures as malleable.
 */
export function derToCompactLowS(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 0
  const byte = (): number => {
    const b = der[i++]
    if (b === undefined) throw new Error("bad DER signature: truncated")
    return b
  }
  const expect = (tag: number, what: string) => {
    if (byte() !== tag) throw new Error(`bad DER signature: expected ${what}`)
  }
  const length = (): number => {
    let n = byte()
    if (n & 0x80) {
      const bytes = n & 0x7f
      n = 0
      for (let k = 0; k < bytes; k++) n = (n << 8) | byte()
    }
    return n
  }
  const integer = (): bigint => {
    expect(0x02, "INTEGER")
    const n = length()
    let v = 0n
    for (let k = 0; k < n; k++) v = (v << 8n) | BigInt(byte())
    return v
  }
  expect(0x30, "SEQUENCE")
  if (length() !== der.length - i) throw new Error("bad DER signature: length")
  const r = integer()
  let s = integer()
  if (i !== der.length) throw new Error("bad DER signature: trailing bytes")
  const inRange = (v: bigint) => v > 0n && v < SECP256K1_CURVE_ORDER
  if (!inRange(r) || !inRange(s)) {
    throw new Error("bad DER signature: r or s out of range")
  }
  if (s > SECP256K1_CURVE_ORDER >> 1n) s = SECP256K1_CURVE_ORDER - s
  const out = new Uint8Array(64)
  const put = (v: bigint, at: number) => {
    for (let k = 31; k >= 0; k--) {
      out[at + k] = Number(v & 0xffn)
      v >>= 8n
    }
  }
  put(r, 0)
  put(s, 32)
  return out
}

/** SPKI PEM -> compressed 33-byte SEC1 point, the form did:key encodes. */
export function pemToCompressedPoint(pem: string): Uint8Array {
  const jwk = createPublicKey(pem).export({ format: "jwk" })
  if (jwk.kty !== "EC" || jwk.crv !== "secp256k1" || !jwk.x || !jwk.y) {
    throw new Error(
      `KMS public key is not secp256k1 (got ${jwk.kty}/${jwk.crv}); the key must be EC_SIGN_SECP256K1_SHA256`
    )
  }
  const x = Buffer.from(jwk.x, "base64url")
  const y = Buffer.from(jwk.y, "base64url")
  const out = new Uint8Array(33)
  out[0] = (y[31] & 1) === 0 ? 0x02 : 0x03
  out.set(x, 1)
  return out
}

/** atproto's did:key encoding: base58btc of the multicodec prefix + point. */
export const didKeyFor = (compressed: Uint8Array): DidKeyString =>
  `did:key:z${toBase58Btc(
    Uint8Array.from([...SECP256K1_PUBLIC_PREFIX, ...compressed])
  )}`

export class KmsPrivateKey implements PrivateKey {
  readonly type = "secp256k1"
  readonly jwtAlg = "ES256K"

  private constructor(
    private readonly backend: KmsBackend,
    private readonly pem: string,
    private readonly compressed: Uint8Array,
    readonly didKey: DidKeyString
  ) {}

  static async load(backend: KmsBackend): Promise<KmsPrivateKey> {
    const pem = await backend.publicKeyPem()
    const compressed = pemToCompressedPoint(pem)
    return new KmsPrivateKey(backend, pem, compressed, didKeyFor(compressed))
  }

  async sign(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const sig = derToCompactLowS(await this.backend.sign(data))
    // Belt and braces: a signature the directory would reject fails here,
    // before anything irreversible is submitted.
    if (!(await this.verify(sig, data))) {
      throw new Error(
        "KMS returned a signature that does not verify against its own public key"
      )
    }
    return sig
  }

  verify(sig: Uint8Array, data: Uint8Array, options?: VerifyOptions) {
    return verifySigWithDidKey(
      this.didKey,
      new Uint8Array(sig),
      new Uint8Array(data),
      options
    )
  }

  exportPublicKey(format: "did"): Promise<DidKeyString>
  exportPublicKey(format: "jwk"): Promise<JsonWebKey>
  exportPublicKey(format: "multikey"): Promise<string>
  exportPublicKey(format: "raw"): Promise<Uint8Array<ArrayBuffer>>
  exportPublicKey(format: "rawHex"): Promise<string>
  async exportPublicKey(
    format: "did" | "jwk" | "multikey" | "raw" | "rawHex"
  ): Promise<unknown> {
    switch (format) {
      case "did":
        return this.didKey
      case "multikey":
        return this.didKey.slice("did:key:".length)
      case "raw":
        return Uint8Array.from(this.compressed)
      case "rawHex":
        return Buffer.from(this.compressed).toString("hex")
      case "jwk":
        return createPublicKey(this.pem).export({ format: "jwk" })
    }
  }
}
