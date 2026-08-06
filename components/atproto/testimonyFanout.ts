/** The cross-user testimony fan-out (#65), kept free of runtime @atproto/api
 * imports: that package is ESM-only down its dependency tree and next/jest
 * doesn't transform node_modules, so anything jest imports must reference the
 * PDS through the AtpReadClient seam. useAtprotoTestimonyListing.ts supplies
 * the real client.
 *
 * ATProto has no cross-repo query primitive without an AppView, so listing a
 * bill's testimony means walking every repo on the PDS: one sync.listRepos
 * walk, then per repo a describeRepo (author handle + skip repos without our
 * collection) and a listRecords over org.mapletestimony.testimony filtered
 * by bill. docs/atproto-spike-notes.md #65 records the costs this measures.
 */
import { countBy } from "lodash"
import type { Bill } from "../db/bills"
import type { Testimony } from "../db/testimony"
import type { MapleTestimonyRecord } from "./lexicons"
import { recordRkey, testimonyNsid } from "./lexicons"
import { testimonyFromRecord } from "./mappers"

/** The three XRPC reads the fan-out needs, injectable for tests. */
export interface AtpReadClient {
  listRepos(cursor?: string): Promise<{
    cursor?: string
    repos: { did: string }[]
  }>
  describeRepo(did: string): Promise<{ handle: string; collections: string[] }>
  listRecords(
    did: string,
    cursor?: string
  ): Promise<{ cursor?: string; records: { uri: string; value: unknown }[] }>
}

/** The issue's probe: what a single bill page costs without an AppView. */
export interface FanoutStats {
  repoCount: number
  listRepoPages: number
  describeCalls: number
  listRecordsCalls: number
  skippedNoCollection: number
  failedRepos: number
  matchingRecords: number
  elapsedMs: number
}

/** Bill's own denormalized counter fields, so the result can be spread
 * straight into the bill object TestimonyCounts renders — and a Bill rename
 * breaks the build instead of silently orphaning that spread. */
export type AtpTestimonyCounts = Pick<
  Bill,
  "testimonyCount" | "endorseCount" | "opposeCount" | "neutralCount"
>

export interface AtpTestimonyListing {
  testimony: Testimony[]
  counts: AtpTestimonyCounts
  stats: FanoutStats
}

const countPositions = (testimony: Testimony[]): AtpTestimonyCounts => {
  const byPosition = countBy(testimony, t => t.position)
  return {
    testimonyCount: testimony.length,
    endorseCount: byPosition.endorse ?? 0,
    opposeCount: byPosition.oppose ?? 0,
    neutralCount: byPosition.neutral ?? 0
  }
}

/** Every account's testimony on one bill, gathered repo by repo. A repo that
 * fails (e.g. 502 for a DID left over from a previous PDS instance, notes
 * #64) is skipped so one dead account can't empty the listing. */
export async function collectBillTestimony(
  client: AtpReadClient,
  court: number,
  billId: string,
  billTitle: string
): Promise<AtpTestimonyListing> {
  const started = Date.now()
  const stats: FanoutStats = {
    repoCount: 0,
    listRepoPages: 0,
    describeCalls: 0,
    listRecordsCalls: 0,
    skippedNoCollection: 0,
    failedRepos: 0,
    matchingRecords: 0,
    elapsedMs: 0
  }

  const dids: string[] = []
  let repoCursor: string | undefined
  do {
    const page = await client.listRepos(repoCursor)
    stats.listRepoPages++
    dids.push(...page.repos.map(r => r.did))
    // A PDS may return a cursor alongside the final full page; an empty page
    // means there is nothing left regardless.
    repoCursor = page.repos.length > 0 ? page.cursor : undefined
  } while (repoCursor)
  stats.repoCount = dids.length

  const settled = await Promise.allSettled(
    dids.map(async did => {
      const desc = await client.describeRepo(did)
      stats.describeCalls++
      if (!desc.collections.includes(testimonyNsid)) {
        stats.skippedNoCollection++
        return []
      }
      const matches: Testimony[] = []
      let cursor: string | undefined
      do {
        const page = await client.listRecords(did, cursor)
        stats.listRecordsCalls++
        for (const rec of page.records) {
          const value = rec.value as MapleTestimonyRecord
          if (value.court !== court || value.billId !== billId) continue
          const testimony = testimonyFromRecord(value, {
            did,
            handle: desc.handle,
            rkey: rec.uri.slice(rec.uri.lastIndexOf("/") + 1),
            billTitle
          })
          // The mapper's id is the raw AT-URI; percent-encode it here because
          // TestimonyItem interpolates the id into a /testimony/:id href,
          // where the URI's slashes trip next/router's validation. (The link
          // is dead for ATProto records either way — delete on graduation.)
          matches.push({ ...testimony, id: encodeURIComponent(testimony.id) })
        }
        cursor = page.records.length > 0 ? page.cursor : undefined
      } while (cursor)
      return matches
    })
  )

  const testimony: Testimony[] = []
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") testimony.push(...result.value)
    else {
      stats.failedRepos++
      console.warn(`[atp] skipping repo ${dids[i]}:`, result.reason)
    }
  })

  testimony.sort(
    (a, b) =>
      b.publishedAt.toMillis() - a.publishedAt.toMillis() ||
      a.id.localeCompare(b.id)
  )
  stats.matchingRecords = testimony.length
  stats.elapsedMs = Date.now() - started

  console.info(
    `[atp] #65 fan-out for ${recordRkey(court, billId)}: ` +
      `${stats.repoCount} repos (${stats.listRepoPages} listRepos pages), ` +
      `${stats.describeCalls} describeRepo + ${stats.listRecordsCalls} ` +
      `listRecords calls, ${stats.skippedNoCollection} without collection, ` +
      `${stats.failedRepos} failed, ${stats.matchingRecords} matching ` +
      `records in ${stats.elapsedMs}ms`
  )
  return { testimony, counts: countPositions(testimony), stats }
}

/** ViewTestimony's tab semantics: Organizations vs Individuals is a binary
 * split on `authorRole === "organization"` (the Firestore listing spells the
 * individual side as a role list, but that's a query-mechanics artifact).
 * Every ATProto author maps to "user" — nothing in the protocol says who is
 * an organization — so the Organizations tab is honestly empty. */
export function filterByAuthorRole(
  items: Testimony[],
  authorRole?: string
): Testimony[] {
  if (!authorRole) return items
  const wantOrg = authorRole === "organization"
  return items.filter(t => (t.authorRole === "organization") === wantOrg)
}

/** In-memory analogue of a startAfter cursor: the page begins after the item
 * whose id is the pageKey. An unknown key (findIndex -1) falls back to the
 * first page, which only happens transiently after a refine reset. */
export function slicePage(
  items: Testimony[],
  itemsPerPage: number,
  pageKey: string | null
): Testimony[] {
  const start =
    pageKey === null ? 0 : items.findIndex(i => i.id === pageKey) + 1
  return items.slice(start, start + itemsPerPage)
}
