import type { AtpSessionData } from "@atproto/api"

/** localStorage key for the persisted ATProto session. */
export const atpSessionStorageKey = "maple.atproto.session"

const isSessionData = (v: unknown): v is AtpSessionData => {
  if (typeof v !== "object" || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.did === "string" &&
    typeof s.handle === "string" &&
    typeof s.accessJwt === "string" &&
    typeof s.refreshJwt === "string"
  )
}

/** Read the persisted session, clearing storage if the stored value is unusable. */
export const readAtpSession = (): AtpSessionData | null => {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(atpSessionStorageKey)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isSessionData(parsed)) return parsed
  } catch {
    // fall through to clear
  }
  clearAtpSession()
  return null
}

export const writeAtpSession = (session: AtpSessionData): void => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(atpSessionStorageKey, JSON.stringify(session))
}

export const clearAtpSession = (): void => {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(atpSessionStorageKey)
}
