import type { PrivateKey } from "@atcute/crypto"
import type { DidKeyString, DidPlcString, Operation } from "@atcute/did-plc"
import { plan } from "./plan.js"
import {
  auditLogUrl,
  clientFor,
  disputesFor,
  genesisOperation,
  readLog,
  submit,
  tipCid
} from "./plc.js"
import { specToOperation, updateSpec, type IdentitySpec } from "./spec.js"

export class SafetyError extends Error {
  override readonly name = "SafetyError"
}

/**
 * The rails that stand between a reviewed spec and an identity that cannot be
 * recovered. Each one guards a mistake that is silent at apply time and
 * permanent afterwards; --i-mean-it is deliberately ugly to type.
 */
export function assertSafeRotationKeys(
  liveKeys: readonly string[],
  specKeys: readonly string[],
  iMeanIt: boolean
): void {
  if (specKeys.length === 0) {
    throw new SafetyError(
      "this operation would leave rotationKeys empty: the identity would be lost forever"
    )
  }
  if (liveKeys.length === 0) return

  if (iMeanIt) return

  // Checked before the recovery-key rail below, which it subsumes: when every
  // key goes at once the first one goes too, and "no key is left to nullify
  // this" is the more accurate thing to say about it.
  const dropped = liveKeys.filter(k => !specKeys.includes(k))
  if (dropped.length === liveKeys.length) {
    throw new SafetyError(
      `this operation replaces every existing rotation key at once, so no current key could ` +
        `nullify it afterwards. Pass --i-mean-it if that is the intent.`
    )
  }

  const recovery = liveKeys[0]!
  if (!specKeys.includes(recovery)) {
    throw new SafetyError(
      `this operation removes the FIRST rotation key (${recovery}), the one that can nullify ` +
        `everything the ops key does. That is the recovery key in ADR 0002 §1. ` +
        `Pass --i-mean-it if you are deliberately rotating it out.`
    )
  }
}

export interface ApplyOptions {
  iMeanIt?: boolean
}

export interface Applied {
  did: DidPlcString
  op: Operation
  auditLog: string
}

/**
 * Genesis. The DID falls out of the signed operation, so this is the one step
 * that cannot be retried into the same result: a second run mints a second
 * identity. Refusing when the spec already names a DID is what makes re-running
 * the harness (or a nervous operator) safe.
 */
export async function applyGenesis(
  path: URL,
  spec: IdentitySpec,
  key: PrivateKey
): Promise<Applied> {
  if (spec.did !== "") {
    throw new SafetyError(
      `the spec already names ${spec.did}. Genesis mints a NEW identity; it does not re-mint an ` +
        `existing one. Clear the did only if you mean to abandon that identity.`
    )
  }
  if (spec.rotationKeys.length === 0) {
    throw new SafetyError(
      "the spec has no rotationKeys. A genesis operation with an empty list mints an identity " +
        "nobody can ever change: put the recovery key first, then the ops key (ADR 0002 §1)."
    )
  }
  if (spec.verificationMethods.atproto === "") {
    throw new SafetyError(
      "genesis needs a signing key in verificationMethods.atproto (an initial one this tool " +
        "generates, rotated to the PDS's own key right after createAccount)"
    )
  }

  const { did, op } = await genesisOperation(spec, key)
  await clientFor(spec).submitOperation(did, op)
  updateSpec(path, { did })
  return { did, op, auditLog: auditLogUrl(spec, did) }
}

/** Reconcile the live document to the spec, signing with a rotation key. */
export async function applySpec(
  spec: IdentitySpec,
  key: PrivateKey,
  opts: ApplyOptions = {}
): Promise<Applied> {
  if (spec.did === "") {
    throw new SafetyError("the spec has no did: run genesis first")
  }
  const did = spec.did as DidPlcString
  const client = clientFor(spec)

  const current = await plan(spec)
  if (current.status === "clean") {
    throw new SafetyError(
      "nothing to apply: the document already matches the spec"
    )
  }
  if (current.status === "absent") {
    throw new SafetyError(
      `${did} is not in this directory: apply cannot create it, genesis can`
    )
  }

  const live = await client.getState(did)
  assertSafeRotationKeys(
    live.rotationKeys,
    spec.rotationKeys,
    opts.iMeanIt === true
  )

  const op = await submit(
    client,
    did,
    specToOperation(spec, await tipCid(client, did)),
    key
  )
  return { did, op, auditLog: auditLogUrl(spec, did) }
}

/**
 * Nullify an operation with a higher-priority key. `prev` points at the
 * operation BEFORE the disputed one, which is what makes the directory treat
 * the fork as an override rather than a normal append; the 72-hour window is
 * enforced by the directory itself.
 */
export async function applyNullify(
  spec: IdentitySpec,
  key: PrivateKey,
  keyDid: string
): Promise<Applied> {
  if (spec.did === "") throw new SafetyError("the spec has no did")
  const did = spec.did as DidPlcString
  const client = clientFor(spec)

  const { canonical } = await readLog(client, did)
  const candidates = disputesFor(canonical, keyDid as DidKeyString)
  if (candidates.length === 0) {
    throw new SafetyError(
      `${keyDid} has nothing it can nullify: either it does not outrank the signer of any recent ` +
        `operation, or the 72-hour dispute window has closed on all of them`
    )
  }
  // The EARLIEST disputable operation, which discards everything after it --
  // deliberately the widest blast radius available. An attacker who signed one
  // operation may have signed several, and forking from the earliest point this
  // key outranks removes all of them at once. Nothing legitimate is lost by
  // that: the operation we submit is the whole spec, so every intended field is
  // restored in the same step. (Verified on the harness: nullifying also
  // discarded a legitimate signing-key rotation, and the following plan was
  // still clean because the spec carried that key.)
  const target = candidates[0]!
  const op = await submit(
    client,
    did,
    specToOperation(spec, target.base.cid),
    key
  )
  return { did, op, auditLog: auditLogUrl(spec, did) }
}
