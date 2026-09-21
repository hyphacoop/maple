import type { PrivateKey } from "@atcute/crypto"
import {
  deriveDidFromGenesisOp,
  getDisputeCandidates,
  PlcClient,
  processIndexedEntryLog,
  signOperation,
  validateIncomingOp
} from "@atcute/did-plc"
import type {
  DidKeyString,
  DidPlcString,
  IndexedEntryWithSigner,
  Operation,
  UnsignedOperation
} from "@atcute/did-plc"
import { requirePlcUrl, specToOperation, type IdentitySpec } from "./spec.js"

/**
 * A client is only ever constructed from the spec's own plcUrl. PlcClient
 * defaults to https://plc.directory when given nothing, and an irreversible
 * operation must never reach the public directory because a field was blank.
 */
export const clientFor = (spec: IdentitySpec): PlcClient =>
  new PlcClient({ serviceUrl: requirePlcUrl(spec) })

export const auditLogUrl = (spec: IdentitySpec, did: string): string =>
  `${requirePlcUrl(spec)}/${did}/log/audit`

/** The canonical (non-nullified) log, and whatever has been nullified out of it. */
export async function readLog(client: PlcClient, did: DidPlcString) {
  const entries = await client.getAuditLog(did)
  return processIndexedEntryLog(did, entries)
}

/** The CID a new operation must point `prev` at: the tip of the canonical log. */
export async function tipCid(
  client: PlcClient,
  did: DidPlcString
): Promise<string> {
  const { canonical } = await readLog(client, did)
  const tip = canonical.at(-1)
  if (!tip) throw new Error(`${did} has an empty operation log`)
  return tip.cid
}

/**
 * Sign and submit. validateIncomingOp is the library's own pre-submit check
 * (size limits, counts, duplicates); running it here means a malformed
 * operation fails locally rather than as an opaque 400 from the directory.
 */
export async function submit(
  client: PlcClient,
  did: DidPlcString,
  unsigned: UnsignedOperation,
  key: PrivateKey
): Promise<Operation> {
  const signed = await signOperation(unsigned, key)
  validateIncomingOp(signed)
  await client.submitOperation(did, signed)
  return signed
}

/**
 * Genesis: the one create-exactly-once step. The DID is derived from the signed
 * operation itself, which is why it cannot be chosen and why re-running this
 * against the same spec would mint a second, unrelated identity.
 */
export async function genesisOperation(
  spec: IdentitySpec,
  key: PrivateKey
): Promise<{ did: DidPlcString; op: Operation }> {
  const signed = await signOperation(specToOperation(spec, null), key)
  validateIncomingOp(signed)
  return { did: await deriveDidFromGenesisOp(signed), op: signed }
}

/**
 * Operations a given rotation key may still nullify. The 72-hour window and the
 * "earlier key in the list outranks later ones" rule are the library's
 * (DISPUTE_WINDOW, isAuthorizedForDispute), not ours -- the recovery rehearsal
 * rehearsed in test:live asserts against the same logic the directory enforces.
 */
export function disputesFor(
  canonical: IndexedEntryWithSigner[],
  key: DidKeyString
) {
  return getDisputeCandidates(canonical, key)
}
