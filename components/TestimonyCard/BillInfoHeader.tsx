import { Col, Row } from "react-bootstrap"
import { Internal, maple } from "components/links"
import { Testimony } from "components/db"
import { formatBillId, formatConferenceLabel } from "components/formatting"
import { PositionLabel } from "./PositionBug"

function formatBallotQuestionLabel(ballotQuestionId: string) {
  return `Ballot Question ${ballotQuestionId}`
}

export const BillInfoHeader = ({
  testimony,
  billLink,
  publishedDate
}: {
  testimony: Testimony
  billLink: string
  publishedDate: string
}) => {
  const ballotQuestionId = testimony.ballotQuestionId ?? undefined
  const conferenceId = testimony.conferenceId ?? undefined
  const policyLink = ballotQuestionId
    ? `/ballotQuestions/${ballotQuestionId}`
    : conferenceId
    ? maple.conference({ court: testimony.court, id: conferenceId })
    : billLink
  const policyLabel = ballotQuestionId
    ? formatBallotQuestionLabel(ballotQuestionId)
    : conferenceId
    ? formatConferenceLabel(testimony.billId)
    : formatBillId(testimony.billId)
  const policyTitle =
    testimony.billTitle ||
    (ballotQuestionId
      ? formatBallotQuestionLabel(ballotQuestionId)
      : "Bill Title")

  return (
    <>
      <Row>
        <Col xs="auto">
          <h4 className="mt-0 mb-0">
            <Internal className={`text-decoration-none`} href={policyLink}>
              {policyLabel}
            </Internal>
          </h4>
        </Col>
        <Col xs="auto" className="p-0 align-items-center d-flex">
          <PositionLabel position={testimony.position} />
        </Col>
      </Row>
      <Row className="mt-1 mb-2">
        <Col>
          <h5 className={`mb-0`}>{policyTitle}</h5>
        </Col>
        <Col className={`ms-auto d-flex justify-content-sm-end`}>
          <p className={`mb-0`}>{publishedDate}</p>
        </Col>
      </Row>
    </>
  )
}
