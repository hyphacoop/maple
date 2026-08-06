import { AtpAgent, AtpSessionData, AtpSessionEvent } from "@atproto/api"
import { useCallback, useEffect, useMemo, useState } from "react"
import { createService } from "../service"
import {
  clearAtpSession,
  readAtpSession,
  writeAtpSession
} from "./session-storage"

/** The PDS this deployment talks to. The seed script prints the value to put
 * in .env.local; the default matches the local dev network (yarn atp:dev). */
export const atpServiceUrl =
  process.env.NEXT_PUBLIC_ATP_PDS_URL ?? "http://localhost:2583"

export type AtpAuthStatus = "resuming" | "signedIn" | "signedOut"

export interface AtpAuth {
  agent: AtpAgent
  session: AtpSessionData | null
  status: AtpAuthStatus
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

/**
 * Credential-session auth against the ATProto PDS. Deliberately independent of
 * the Firebase auth service and its redux slice — the spike runs both side by
 * side. Session state lives in this context and localStorage only.
 */
export const { Provider, useServiceChecked: useAtpAuth } =
  createService<AtpAuth>(() => {
    const [session, setSession] = useState<AtpSessionData | null>(null)
    const [status, setStatus] = useState<AtpAuthStatus>("resuming")

    const agent = useMemo(
      () =>
        new AtpAgent({
          service: atpServiceUrl,
          persistSession: (evt: AtpSessionEvent, sess?: AtpSessionData) => {
            if (sess) writeAtpSession(sess)
            else if (evt === "expired" || evt === "create-failed")
              clearAtpSession()
            // network-error: keep storage so the next load retries the refresh
            setSession(sess ?? null)
            setStatus(sess ? "signedIn" : "signedOut")
          }
        }),
      []
    )

    useEffect(() => {
      const stored = readAtpSession()
      if (!stored) {
        setStatus("signedOut")
        return
      }
      // Success and hard failures both fire persistSession, which settles
      // state. The catch only needs to settle transient failures where the
      // agent kept the session (see CredentialSession.resumeSession docs).
      agent.resumeSession(stored).catch(() => {
        const kept = agent.session
        setSession(kept ?? null)
        setStatus(kept ? "signedIn" : "signedOut")
      })
    }, [agent])

    const login = useCallback(
      async (identifier: string, password: string) => {
        await agent.login({ identifier, password })
      },
      [agent]
    )

    const logout = useCallback(async () => {
      try {
        await agent.logout()
      } catch {
        // best effort — clear locally regardless
      }
      clearAtpSession()
      setSession(null)
      setStatus("signedOut")
    }, [agent])

    return useMemo(
      () => ({ agent, session, status, login, logout }),
      [agent, session, status, login, logout]
    )
  })
