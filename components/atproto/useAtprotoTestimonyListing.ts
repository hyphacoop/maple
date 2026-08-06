/** Cross-user testimony listing hook for the /atp bill page (#65).
 *
 * The fan-out itself lives in testimonyFanout.ts (kept importable by jest);
 * this module owns the real AtpAgent-backed client, the page-lifetime cache,
 * and the createTableHook adapter that makes the result a drop-in source for
 * ViewTestimony. The full listing is fetched up front — pagination and the
 * header position counts are both computed in memory, because neither
 * "page 2" nor "how many endorse" exists as a protocol query without an
 * AppView.
 */
import { AtpAgent } from "@atproto/api"
import { useEffect, useMemo } from "react"
import { useAsync } from "react-async-hook"
import type { Bill } from "../db/bills"
import type { Testimony } from "../db/testimony"
import {
  TestimonyFilterOptions,
  UsePublishedTestimonyListing
} from "../db/testimony/usePublishedTestimonyListing"
import { createTableHook } from "../db/createTableHook"
import { atpServiceUrl } from "./auth"
import { recordRkey, testimonyNsid } from "./lexicons"
import {
  AtpReadClient,
  AtpTestimonyListing,
  collectBillTestimony,
  filterByAuthorRole,
  slicePage
} from "./testimonyFanout"

const pageLimit = 100

const defaultClient = (): AtpReadClient => {
  const agent = new AtpAgent({ service: atpServiceUrl })
  return {
    listRepos: async cursor =>
      (await agent.com.atproto.sync.listRepos({ limit: pageLimit, cursor }))
        .data,
    describeRepo: async repo =>
      (await agent.com.atproto.repo.describeRepo({ repo })).data,
    listRecords: async (repo, cursor) =>
      (
        await agent.com.atproto.repo.listRecords({
          repo,
          collection: testimonyNsid,
          limit: pageLimit,
          cursor
        })
      ).data
  }
}

/** One-entry promise cache so the table hook's per-page getItems calls and
 * the counts fetch share a single fan-out. Lives for the page: a browser
 * refresh re-fans-out (how new testimony appears), while paging and tab
 * clicks stay in memory. Client-side re-navigation reuses stale data — an
 * accepted spike limitation (notes #65). */
let cache: { key: string; promise: Promise<AtpTestimonyListing> } | null = null

function getBillTestimony(
  court: number,
  billId: string,
  billTitle: string
): Promise<AtpTestimonyListing> {
  const key = recordRkey(court, billId)
  if (cache?.key === key) return cache.promise
  const promise = collectBillTestimony(
    defaultClient(),
    court,
    billId,
    billTitle
  )
  cache = { key, promise }
  // A failed fan-out shouldn't poison every later call.
  promise.catch(() => {
    if (cache?.promise === promise) cache = null
  })
  return promise
}

type Refinement = {
  court?: number
  billId?: string
  /** Not a filter — join data for the mapper. It rides in the refinement
   * because createTableHook's module-scope getItems has no other channel. */
  billTitle?: string
  authorRole?: string
  representativeId?: string
  senatorId?: string
}

async function getItems(
  refinement: Refinement,
  itemsPerPage: number,
  pageKey: string | null
): Promise<Testimony[]> {
  const { court, billId, billTitle, authorRole } = refinement
  if (court === undefined || billId === undefined) return []
  const listing = await getBillTestimony(court, billId, billTitle ?? "")
  return slicePage(
    filterByAuthorRole(listing.testimony, authorRole),
    itemsPerPage,
    pageKey
  )
}

const useTable = createTableHook<Testimony, Refinement, string>({
  getPageKey: i => i.id,
  getItems,
  name: "atproto testimony"
})

/** Drop-in ViewTestimony source ({ items, pagination, setFilter }) plus the
 * real position counts for the bill header, all from one fan-out. `counts`
 * is undefined until the fan-out resolves. */
export function useAtprotoTestimonyListing(bill: Bill) {
  const { court, id: billId } = bill
  const billTitle = bill.content.Title

  const { pagination, items, refine, refinement } = useTable({
    representativeId: undefined,
    senatorId: undefined,
    authorRole: undefined,
    court,
    billId,
    billTitle
  })

  useEffect(() => {
    if (
      refinement.court !== court ||
      refinement.billId !== billId ||
      refinement.billTitle !== billTitle
    )
      refine({ court, billId, billTitle })
  }, [billId, billTitle, court, refine, refinement])

  const counts = useAsync(
    () => getBillTestimony(court, billId, billTitle).then(l => l.counts),
    [court, billId, billTitle]
  )

  return useMemo(
    () => ({
      pagination,
      setFilter: (r: TestimonyFilterOptions | null) =>
        refine({
          representativeId: undefined,
          senatorId: undefined,
          authorRole: undefined,
          ...r
        }),
      // ViewTestimony only reads items.result, but UseAsyncReturn is
      // invariant in its deps tuple (execute's parameters), so the Firestore
      // hook's items type isn't directly interchangeable with ours.
      items: items as unknown as UsePublishedTestimonyListing["items"],
      counts: counts.result
    }),
    [pagination, items, refine, counts.result]
  )
}
