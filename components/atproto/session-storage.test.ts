import type { AtpSessionData } from "@atproto/api"
import {
  atpSessionStorageKey,
  clearAtpSession,
  readAtpSession,
  writeAtpSession
} from "./session-storage"

const session: AtpSessionData = {
  did: "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
  handle: "alice.test",
  accessJwt: "access-jwt",
  refreshJwt: "refresh-jwt",
  active: true
}

beforeEach(() => localStorage.clear())

describe("session storage", () => {
  it("round-trips a session", () => {
    writeAtpSession(session)
    expect(readAtpSession()).toEqual(session)
  })

  it("returns null when nothing is stored", () => {
    expect(readAtpSession()).toBeNull()
  })

  it("clears and returns null for corrupt JSON", () => {
    localStorage.setItem(atpSessionStorageKey, "{not json")
    expect(readAtpSession()).toBeNull()
    expect(localStorage.getItem(atpSessionStorageKey)).toBeNull()
  })

  it("clears and returns null for well-formed JSON of the wrong shape", () => {
    localStorage.setItem(atpSessionStorageKey, JSON.stringify({ did: 42 }))
    expect(readAtpSession()).toBeNull()
    expect(localStorage.getItem(atpSessionStorageKey)).toBeNull()
  })

  it("clearAtpSession removes the stored session", () => {
    writeAtpSession(session)
    clearAtpSession()
    expect(readAtpSession()).toBeNull()
  })
})
