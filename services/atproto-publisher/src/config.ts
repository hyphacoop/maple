import { defineSecret } from "firebase-functions/params"
import type { PdsConfig } from "./agent.js"

/**
 * PDS credentials, split the way functions/src/search/client.ts already splits
 * Typesense: the endpoint and identity are plain configuration, the password
 * is a Secret Manager secret. ADR 0001 fixes Secret Manager as the home for
 * "PDS admin password, signing key material, consumer credentials".
 */
export const pdsPassword = defineSecret("ATP_PDS_PASSWORD")

/** Undefined until a real dev PDS exists, and that is deliberate: the
 * codebase can deploy before there is anywhere to publish to, and every
 * trigger no-ops loudly-once rather than throwing on each of ~8000 daily
 * events. */
export function readConfig(): PdsConfig | undefined {
  const service = process.env.ATP_PDS_URL
  const identifier = process.env.ATP_PDS_HANDLE
  const password = process.env.ATP_PDS_PASSWORD
  if (!service || !identifier || !password) return undefined
  return { service, identifier, password }
}
