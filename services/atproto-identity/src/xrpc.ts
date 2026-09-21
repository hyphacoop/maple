import type { PrivateKey } from "@atcute/crypto"

/**
 * The XRPC calls this tool makes, by hand.
 *
 * @atproto/api would do it in fewer lines, but this process holds a rotation
 * key in memory: everything it imports is inside the custody boundary ADR 0002
 * draws, so the dependency list stays as short as it can be. A handful of JSON
 * calls does not justify widening it.
 */

const b64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url")

async function xrpc(
  pdsUrl: string,
  nsid: string,
  init: {
    method: "GET" | "POST"
    body?: unknown
    auth?: string
    params?: Record<string, string>
  }
): Promise<unknown> {
  const url = new URL(`/xrpc/${nsid}`, pdsUrl)
  for (const [k, v] of Object.entries(init.params ?? {}))
    url.searchParams.set(k, v)

  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers["content-type"] = "application/json"
  if (init.auth !== undefined) headers.authorization = `Bearer ${init.auth}`

  const res = await fetch(url, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${nsid} failed: ${res.status} ${res.statusText} ${text}`)
  }
  return text === "" ? {} : JSON.parse(text)
}

/** The PDS's own service DID, which a service JWT must be addressed to. */
export async function describeServer(pdsUrl: string): Promise<{ did: string }> {
  const out = (await xrpc(pdsUrl, "com.atproto.server.describeServer", {
    method: "GET"
  })) as {
    did?: string
  }
  if (typeof out.did !== "string")
    throw new Error("describeServer returned no did")
  return { did: out.did }
}

/**
 * An inter-service JWT, signed with the DID's CURRENT atproto signing key.
 *
 * This is what makes bring-your-own-DID work: the PDS will only accept
 * createAccount for a DID it did not mint if the caller proves control of the
 * key that DID document names. At genesis that key is ours, which is the whole
 * reason genesis generates one and we discard it after the rotation.
 */
export async function createServiceJwt(opts: {
  iss: string
  aud: string
  lxm: string
  key: PrivateKey
  expiresInSeconds?: number
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { typ: "JWT", alg: "ES256K" }
  const payload = {
    iss: opts.iss,
    aud: opts.aud,
    lxm: opts.lxm,
    iat: now,
    exp: now + (opts.expiresInSeconds ?? 60),
    jti: crypto.randomUUID()
  }
  const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(
    Buffer.from(JSON.stringify(payload))
  )}`
  // @atcute/crypto hashes the input itself and emits a low-s compact signature,
  // which is what atproto's ES256K verification expects.
  const sig = await opts.key.sign(new TextEncoder().encode(signingInput))
  return `${signingInput}.${b64url(sig)}`
}

export interface CreatedAccount {
  did: string
  accessJwt: string
  handle: string
}

/**
 * createAccount carrying an existing DID -- the same call the network uses to
 * migrate an account between PDSes. The PDS generates its own signing key and
 * does NOT add its rotation key to the document, because it is not minting the
 * DID (ADR 0002 §1).
 */
export async function createAccountWithDid(opts: {
  pdsUrl: string
  did: string
  handle: string
  email: string
  password: string
  serviceJwt: string
  inviteCode?: string
}): Promise<CreatedAccount> {
  const out = (await xrpc(opts.pdsUrl, "com.atproto.server.createAccount", {
    method: "POST",
    auth: opts.serviceJwt,
    body: {
      did: opts.did,
      handle: opts.handle,
      email: opts.email,
      password: opts.password,
      ...(opts.inviteCode === undefined ? {} : { inviteCode: opts.inviteCode })
    }
  })) as Partial<CreatedAccount>
  if (typeof out.did !== "string" || typeof out.accessJwt !== "string") {
    throw new Error("createAccount returned no did/accessJwt")
  }
  return {
    did: out.did,
    accessJwt: out.accessJwt,
    handle: out.handle ?? opts.handle
  }
}

export async function createSession(opts: {
  pdsUrl: string
  identifier: string
  password: string
}): Promise<{ did: string; accessJwt: string }> {
  const out = (await xrpc(opts.pdsUrl, "com.atproto.server.createSession", {
    method: "POST",
    body: { identifier: opts.identifier, password: opts.password }
  })) as { did?: string; accessJwt?: string }
  if (typeof out.did !== "string" || typeof out.accessJwt !== "string") {
    throw new Error("createSession returned no did/accessJwt")
  }
  return { did: out.did, accessJwt: out.accessJwt }
}

/**
 * Go live.
 *
 * createAccount carrying a `did` is the MIGRATION path, and it lands the
 * account deactivated on purpose: the normal sequence is create, import the
 * repo from the old PDS, then activate. A deactivated account emits nothing to
 * the firehose, so until this call the relay never learns the repo exists.
 *
 * Order matters. Activate only AFTER the document names the PDS's own signing
 * key, or the first commits go out signed by a key the network cannot resolve.
 */
export async function activateAccount(opts: {
  pdsUrl: string
  accessJwt: string
}): Promise<void> {
  await xrpc(opts.pdsUrl, "com.atproto.server.activateAccount", {
    method: "POST",
    auth: opts.accessJwt
  })
}

/** Whether the account is live, and whether the PDS considers the document valid. */
export async function checkAccountStatus(opts: {
  pdsUrl: string
  accessJwt: string
}): Promise<{ activated: boolean; validDid: boolean }> {
  const out = (await xrpc(
    opts.pdsUrl,
    "com.atproto.server.checkAccountStatus",
    {
      method: "GET",
      auth: opts.accessJwt
    }
  )) as { activated?: boolean; validDid?: boolean }
  return { activated: out.activated === true, validDid: out.validDid === true }
}

export interface RecommendedCredentials {
  /** The per-account signing key the PDS generated for itself. */
  signingKey: string
  /**
   * The rotation keys the PDS wants present. The last is its own server-wide
   * key; PDS_RECOVERY_DID_KEY, if configured, is prepended to it. We adopt
   * these only for the instant of activation -- see the `activate` command.
   */
  rotationKeys: string[]
}

/**
 * What the PDS would put in the DID document if it controlled it. We own the
 * document, so this is read for exactly two things: the signing key we adopt
 * permanently, and the rotation keys we adopt transiently.
 */
export async function getRecommendedDidCredentials(opts: {
  pdsUrl: string
  accessJwt: string
}): Promise<RecommendedCredentials> {
  const out = (await xrpc(
    opts.pdsUrl,
    "com.atproto.identity.getRecommendedDidCredentials",
    {
      method: "GET",
      auth: opts.accessJwt
    }
  )) as { verificationMethods?: { atproto?: string }; rotationKeys?: unknown }
  const signingKey = out.verificationMethods?.atproto
  if (typeof signingKey !== "string") {
    throw new Error(
      "getRecommendedDidCredentials returned no verificationMethods.atproto"
    )
  }
  const rotationKeys = Array.isArray(out.rotationKeys)
    ? out.rotationKeys.filter((k): k is string => typeof k === "string")
    : []
  return { signingKey, rotationKeys }
}
