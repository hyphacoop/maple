import { scopeParams } from "../links"
import type { Step } from "./redux"

/** The testimony form at a step, for a bill or a ballot question or
 * conference on it. Kept apart from the publish hooks so a page can link to
 * the form without loading them. */
export const formUrl = (
  billId: string,
  court: number,
  step: Step = "position",
  ballotQuestionId?: string,
  conferenceId?: string
) =>
  `/submit-testimony?${new URLSearchParams({
    billId,
    court: String(court),
    step,
    ...scopeParams({ ballotQuestionId, conferenceId })
  })}`
