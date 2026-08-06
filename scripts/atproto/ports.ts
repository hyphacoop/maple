/** Ports for the throwaway local ATProto dev network. In their own module
 * because dev-env.ts boots the network at import time, so other scripts can't
 * import constants from it. */
export const PLC_PORT = 2582
export const PDS_PORT = 2583
export const defaultPdsUrl = `http://localhost:${PDS_PORT}`
