import { BillPosition, Testimony } from "./types"
import { usePublishedTestimonyListing } from "./usePublishedTestimonyListing"

/** Recent testimony for the homepage callouts, which draw a vote on a bill.
 * Conference testimony takes no such vote, so it is left out. */
export function useRecentTestimony(limit?: number) {
  const { items } = usePublishedTestimonyListing({})

  return items.status === "success"
    ? items.result
        ?.filter((t): t is Testimony & { position: BillPosition } =>
          BillPosition.guard(t.position)
        )
        .slice(0, limit)
    : []
}
