/** Hand-written types for the org.mapletestimony.* lexicons.
 *
 * These mirror lexicons/org/mapletestimony/{bill,testimony}.json. We skip
 * lex-cli codegen for the spike: the generated client would pull in codegen
 * tooling from the ESM-only @atproto train, and two records are easy to keep
 * in sync by hand.
 */
import type { ComAtprotoRepoStrongRef } from "@atproto/api"
import type { BillTopic } from "../db/bills"
import type { Position } from "../db/testimony/types"

export const billNsid = "org.mapletestimony.bill"
export const testimonyNsid = "org.mapletestimony.testimony"

/** Record key for both collections: one bill record per bill, one testimony
 * record per bill per user. Safe under the rkey charset [A-Za-z0-9._:~-]. */
export const recordRkey = (court: number, billId: string) =>
  `${court}-${billId}`

export interface MapleMemberReference {
  id: string
  name: string
  /** 1 = Legislative Member, 2 = Committee, 3 = Public Request, 4 = Special
   * Request */
  memberType: number
}

export interface MapleBillContent {
  title: string
  billNumber: string
  docketNumber: string
  generalCourtNumber: number
  primarySponsor?: MapleMemberReference
  cosponsors: MapleMemberReference[]
  legislationTypeName: string
  pinslip: string
}

export interface MapleHistoryAction {
  date?: string
  branch: string
  action: string
}

export interface MapleCommitteeMember {
  id: string
  name: string
  email?: string
}

export interface MapleCommittee {
  id: string
  name: string
  houseChair?: MapleCommitteeMember
  senateChair?: MapleCommitteeMember
}

/** Declared as a type alias (not interface) so it gets an implicit index
 * signature and is assignable to putRecord's `Record<string, unknown>`. */
export type MapleBillRecord = {
  $type: typeof billNsid
  court: number
  billId: string
  content: MapleBillContent
  history: MapleHistoryAction[]
  currentCommittee?: MapleCommittee
  city?: string
  /** Same shape as the app type; passed through the mappers unchanged. */
  topics?: BillTopic[]
  summary?: string
  hearingIds?: string[]
  nextHearingAt?: string
  fetchedAt: string
}

/** Type alias for the same reason as MapleBillRecord. */
export type MapleTestimonyRecord = {
  $type: typeof testimonyNsid
  bill: ComAtprotoRepoStrongRef.Main
  court: number
  billId: string
  position: Position
  content: string
  createdAt: string
}
