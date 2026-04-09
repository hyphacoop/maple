import { formatBillId } from "components/formatting"
import { Internal, maple } from "components/links"
import styled from "styled-components"
import { useCurrentTestimonyDetails } from "./testimonyDetailSlice"

export const BillTitle = styled(props => {
  const { ballotQuestion, bill, revision } = useCurrentTestimonyDetails()
  const ballotQuestionId = revision.ballotQuestionId ?? undefined

  const href = ballotQuestionId
    ? maple.ballotQuestion({ id: ballotQuestionId })
    : maple.bill(bill)
  const title = ballotQuestionId
    ? `Ballot Question ${ballotQuestionId}: ${
        ballotQuestion?.title || bill.content.Title
      }`
    : `${formatBillId(bill.content.BillNumber)}: ${bill.content.Title}`

  return (
    <h3 {...props}>
      <Internal href={href}>{title}</Internal>
    </h3>
  )
})`
  font-size: 2rem;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
`
