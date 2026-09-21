import { readFileSync, writeFileSync } from "node:fs"
import type {
  DidKeyString,
  PlcState,
  Service,
  UnsignedOperation
} from "@atcute/did-plc"

/**
 * The identity spec: infra/identity/<env>.json, reviewed like code.
 *
 * It holds PUBLIC material only. The recovery key exists offline and the ops
 * key lives in Secret Manager (ADR 0002 §1); this file names them by their
 * did:key and nothing else. Two fields are written back by the tool rather than
 * by hand -- `did` at genesis, and `verificationMethods.atproto` when the PDS's
 * own signing key is rotated in -- because both are values the network chooses,
 * not values we decide.
 */
export interface IdentitySpec {
  /** Empty until genesis. Once set it is permanent: a different DID is a different identity. */
  did: string
  /** The claimed handle, without the at:// prefix. Mutable: handle changes go
   * through a reviewed spec change and `apply`, never the PDS's updateHandle. */
  handle: string
  /** The PDS this identity's repo lives on. Baked into services.atproto_pds. */
  pdsEndpoint: string
  /** The PLC directory to plan and apply against. Never defaulted -- see requirePlcUrl. */
  plcUrl: string
  /** PRIORITY ORDER, recovery key first: an earlier key can nullify a later key's op. */
  rotationKeys: string[]
  /** The repo signing key. Empty between genesis and the post-createAccount rotation. */
  verificationMethods: { atproto: string }
}

/** The service key and type the atproto network looks for in a DID document. */
export const PDS_SERVICE_ID = "atproto_pds"
export const PDS_SERVICE_TYPE = "AtprotoPersonalDataServer"
/** The verification method key atproto uses for the repo signing key. */
export const SIGNING_KEY_ID = "atproto"

export const specPath = (env: string, repoRoot: URL): URL =>
  new URL(`infra/identity/${env}.json`, repoRoot)

/** The repo root, resolved from this file rather than from the cwd. */
export const REPO_ROOT = new URL("../../../", import.meta.url)

const isDidKey = (s: unknown): s is DidKeyString =>
  typeof s === "string" && s.startsWith("did:key:z")

export function parseSpec(json: unknown, source: string): IdentitySpec {
  // Annotated on the binding, not just the arrow: that is what lets TS treat a
  // bad() call as unreachable and narrow the field it was guarding.
  const bad: (msg: string) => never = msg => {
    throw new Error(`${source}: ${msg}`)
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    bad("must be a JSON object")
  }
  const o = json as Record<string, unknown>

  for (const key of ["did", "handle", "pdsEndpoint", "plcUrl"]) {
    if (typeof o[key] !== "string") bad(`${key} must be a string`)
  }
  if (!Array.isArray(o.rotationKeys)) bad("rotationKeys must be an array")
  const rotationKeys = o.rotationKeys as unknown[]
  // Empty is legal only before genesis: a spec is committed and reviewed before
  // the recovery key is generated offline. Once a DID exists, an empty list
  // would describe an identity nobody can ever change again.
  if (rotationKeys.length === 0 && o.did !== "") {
    bad("rotationKeys must not be empty for a minted identity")
  }
  rotationKeys.forEach((k, i) => {
    if (!isDidKey(k))
      bad(
        `rotationKeys[${i}] must be a did:key string, got ${JSON.stringify(k)}`
      )
  })
  if (new Set(rotationKeys).size !== rotationKeys.length)
    bad("rotationKeys contains duplicates")

  const vm = o.verificationMethods
  if (typeof vm !== "object" || vm === null || Array.isArray(vm)) {
    bad("verificationMethods must be an object")
  }
  const atproto = (vm as Record<string, unknown>)[SIGNING_KEY_ID]
  if (typeof atproto !== "string")
    bad(`verificationMethods.${SIGNING_KEY_ID} must be a string`)
  if (atproto !== "" && !isDidKey(atproto)) {
    bad(
      `verificationMethods.${SIGNING_KEY_ID} must be empty or a did:key string`
    )
  }

  const handle = o.handle as string
  if (handle === "") bad("handle must not be empty")
  if (handle.startsWith("at://"))
    bad("handle must not carry the at:// prefix -- it is added for you")

  const pdsEndpoint = o.pdsEndpoint as string
  if (!/^https?:\/\//.test(pdsEndpoint))
    bad("pdsEndpoint must be an http(s) URL")

  const did = o.did as string
  if (did !== "" && !did.startsWith("did:plc:"))
    bad("did must be empty or a did:plc string")

  return {
    did,
    handle,
    pdsEndpoint,
    plcUrl: o.plcUrl as string,
    rotationKeys: rotationKeys as string[],
    verificationMethods: { atproto: atproto }
  }
}

export const readSpec = (path: URL): IdentitySpec =>
  parseSpec(JSON.parse(readFileSync(path, "utf8")), path.pathname)

/**
 * Rewrite one field of the spec on disk, preserving the rest byte for byte
 * where JSON.stringify allows. Only ever called with values the network chose.
 */
export function updateSpec(
  path: URL,
  patch: Partial<IdentitySpec>
): IdentitySpec {
  const current = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >
  const merged = { ...current, ...patch }
  const next = parseSpec(merged, path.pathname)
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n")
  return next
}

/**
 * A PLC URL is always explicit. Defaulting to plc.directory would mean a typo
 * in the spec silently retargets an irreversible operation at the public
 * network, so an empty value is an error rather than a fallback.
 */
export function requirePlcUrl(spec: IdentitySpec): string {
  if (spec.plcUrl === "") {
    throw new Error(
      "spec.plcUrl is empty: it must name a PLC directory explicitly"
    )
  }
  if (!/^https?:\/\//.test(spec.plcUrl)) {
    throw new Error(
      `spec.plcUrl must be an http(s) URL, got ${JSON.stringify(spec.plcUrl)}`
    )
  }
  return spec.plcUrl.replace(/\/+$/, "")
}

/**
 * The spec expressed in the shape PlcClient.getState() returns, so `plan` is a
 * diff of two values of one type rather than a translation.
 */
export function specToState(spec: IdentitySpec): Omit<PlcState, "did"> {
  const services: Record<string, Service> = {
    [PDS_SERVICE_ID]: { type: PDS_SERVICE_TYPE, endpoint: spec.pdsEndpoint }
  }
  const verificationMethods: Record<string, DidKeyString> = {}
  if (spec.verificationMethods.atproto !== "") {
    verificationMethods[SIGNING_KEY_ID] = spec.verificationMethods
      .atproto as DidKeyString
  }
  return {
    rotationKeys: spec.rotationKeys as DidKeyString[],
    verificationMethods,
    alsoKnownAs: [`at://${spec.handle}`],
    services
  }
}

/** The unsigned operation that would make the live document match the spec. */
export function specToOperation(
  spec: IdentitySpec,
  prev: string | null
): UnsignedOperation {
  const state = specToState(spec)
  return {
    type: "plc_operation",
    prev,
    alsoKnownAs: state.alsoKnownAs,
    rotationKeys: state.rotationKeys,
    verificationMethods: state.verificationMethods,
    services: state.services
  }
}

/**
 * The rotation keys the PDS insists on that the spec does not list.
 *
 * activateAccount asserts its own rotation key is present; `activate` adds
 * exactly these for the length of that one call and removes them again, so the
 * document spends no longer than one operation naming a key the VM holds
 * (ADR 0002 §1).
 */
export const borrowedRotationKeys = (
  spec: IdentitySpec,
  recommended: readonly string[]
): string[] => recommended.filter(key => !spec.rotationKeys.includes(key))
