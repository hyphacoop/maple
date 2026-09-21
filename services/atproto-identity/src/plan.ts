import type { PlcState } from "@atcute/did-plc"
import { clientFor } from "./plc.js"
import { SIGNING_KEY_ID, specToState, type IdentitySpec } from "./spec.js"

export interface Change {
  field: string
  live: string
  spec: string
}

export type PlanResult =
  | { status: "unminted"; changes: [] }
  | { status: "absent"; changes: [] }
  | { status: "incomplete"; changes: Change[]; reason: string }
  | { status: "clean"; changes: [] }
  | { status: "drift"; changes: Change[] }

const show = (v: unknown): string =>
  v === undefined ? "(unset)" : JSON.stringify(v)

/** Compare only the fields the spec owns; the DID itself is not one of them. */
export function diffState(live: PlcState, spec: IdentitySpec): Change[] {
  const want = specToState(spec)
  const changes: Change[] = []

  const push = (field: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      changes.push({ field, live: show(a), spec: show(b) })
  }

  push("rotationKeys", live.rotationKeys, want.rotationKeys)
  push("alsoKnownAs", live.alsoKnownAs, want.alsoKnownAs)

  const keys = new Set([
    ...Object.keys(live.services),
    ...Object.keys(want.services)
  ])
  for (const k of [...keys].sort()) {
    push(`services.${k}`, live.services[k], want.services[k])
  }

  // verificationMethods.atproto is empty in the spec between genesis and the
  // post-createAccount rotation; that is reported as "incomplete", not drift.
  const vmKeys = new Set([
    ...Object.keys(live.verificationMethods),
    ...Object.keys(want.verificationMethods)
  ])
  for (const k of [...vmKeys].sort()) {
    if (k === SIGNING_KEY_ID && spec.verificationMethods.atproto === "")
      continue
    push(
      `verificationMethods.${k}`,
      live.verificationMethods[k],
      want.verificationMethods[k]
    )
  }

  return changes
}

export async function plan(spec: IdentitySpec): Promise<PlanResult> {
  if (spec.did === "") return { status: "unminted", changes: [] }

  const client = clientFor(spec)
  let live: PlcState
  try {
    live = await client.getState(spec.did as PlcState["did"])
  } catch (err) {
    if (err instanceof Error && /404|not found/i.test(err.message)) {
      return { status: "absent", changes: [] }
    }
    throw err
  }

  const changes = diffState(live, spec)
  if (spec.verificationMethods.atproto === "") {
    return {
      status: "incomplete",
      changes,
      reason:
        `verificationMethods.${SIGNING_KEY_ID} is empty in the spec: the PDS account has not been ` +
        `created and its signing key not rotated in yet (see rotate-signing-key)`
    }
  }
  return changes.length === 0
    ? { status: "clean", changes: [] }
    : { status: "drift", changes }
}

export function formatPlan(spec: IdentitySpec, result: PlanResult): string {
  const head = `${spec.did || "(no did yet)"} @ ${spec.plcUrl}`
  switch (result.status) {
    case "unminted":
      return `${head}\n  the spec has no did: this identity has not been minted (run genesis)`
    case "absent":
      return `${head}\n  the directory does not know this did`
    case "clean":
      return `${head}\n  no changes: the document matches the spec`
    case "incomplete":
    case "drift": {
      const lines = result.changes.map(
        c => `  ${c.field}\n    live: ${c.live}\n    spec: ${c.spec}`
      )
      const reason =
        result.status === "incomplete" ? `\n  ${result.reason}` : ""
      return `${head}${reason}${lines.length ? "\n" + lines.join("\n") : ""}`
    }
  }
}

/** Non-zero for anything a human still has to act on. Only "clean" is green. */
export const exitCodeFor = (result: PlanResult): number =>
  result.status === "clean" ? 0 : 1
