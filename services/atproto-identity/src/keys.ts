import { execFile } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { promisify } from "node:util"
import {
  parsePrivateMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
  type PrivateKey
} from "@atcute/crypto"
import type { DidKeyString } from "@atcute/did-plc"
import { gcloudBackend, KmsPrivateKey, parseKmsResource } from "./kms.js"

const exec = promisify(execFile)

/**
 * Where a rotation key comes from. MAPLE's ops key is a Cloud KMS key
 * (infra/gcp/kms.tf) signed with by a person in iam/'s identity_signers --
 * never by a service account (ADR 0002 §1). The file source exists for the
 * local harness, whose keys are per-run scratch; Secret Manager remains for
 * keys that are bytes somewhere, like a recovery rehearsal.
 */
export type KeySource =
  | { kind: "file"; path: string }
  | { kind: "secret"; secretId: string; project: string }
  | { kind: "kms"; resource: string }

/**
 * secp256k1 private keys are accepted in the two shapes this project already
 * has: the bare hex the PDS uses for PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX,
 * and the multikey `z...` form @atcute/crypto exports.
 */
export async function importPrivateKey(
  material: string
): Promise<Secp256k1PrivateKey> {
  const trimmed = material.trim()
  if (trimmed === "") throw new Error("key material is empty")

  if (trimmed.startsWith("z")) {
    const found = parsePrivateMultikey(trimmed)
    if (found.type !== "secp256k1") {
      throw new Error(`expected a secp256k1 key, got ${found.type}`)
    }
    return Secp256k1PrivateKey.importRaw(found.privateKeyBytes)
  }

  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error("key material is neither a multikey (z...) nor hex")
  }
  if (trimmed.length !== 64) {
    throw new Error(
      `a secp256k1 private key is 32 bytes (64 hex chars), got ${trimmed.length}`
    )
  }
  return Secp256k1PrivateKey.importRaw(
    Uint8Array.from(Buffer.from(trimmed, "hex"))
  )
}

/**
 * Read a key without ever putting it on a command line or in a log. The
 * Secret Manager path shells out to gcloud rather than taking a GCP SDK
 * dependency: this tool holds a rotation key in memory, so its dependency tree
 * is part of the custody boundary and stays as small as it can be.
 */
export async function loadPrivateKey(source: KeySource): Promise<PrivateKey> {
  if (source.kind === "file") {
    return importPrivateKey(readFileSync(source.path, "utf8"))
  }
  if (source.kind === "kms") {
    return KmsPrivateKey.load(gcloudBackend(parseKmsResource(source.resource)))
  }
  const { stdout } = await exec("gcloud", [
    "secrets",
    "versions",
    "access",
    "latest",
    `--secret=${source.secretId}`,
    `--project=${source.project}`
  ])
  return importPrivateKey(stdout)
}

export interface GeneratedKey {
  didKey: DidKeyString
  /** Hex, matching the form the PDS and Secret Manager already use. */
  privateKeyHex: string
}

export async function generateKey(): Promise<GeneratedKey> {
  const key = await Secp256k1PrivateKeyExportable.createKeypair()
  return {
    didKey: await key.exportPublicKey("did"),
    privateKeyHex: await key.exportPrivateKey("rawHex")
  }
}

/** Write private material to disk readable only by its owner. */
export function writePrivateKeyFile(path: string, privateKeyHex: string): void {
  writeFileSync(path, privateKeyHex + "\n", { mode: 0o600 })
}
