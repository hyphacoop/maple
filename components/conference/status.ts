import type { Conference } from "../db/conferences"

/** Testimony is taken only while the committee is still sitting. The server
 * enforces the same rule when publishing. */
export const isConferenceOpen = (status: Conference["status"]) =>
  status === "appointed"
