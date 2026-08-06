import { useTranslation } from "next-i18next"
import { BillNumber } from "../bill/BillNumber"
import { Committees, Hearing, Sponsors } from "../bill/SponsorsAndCommittees"
import { Status } from "../bill/Status"
import { Summary } from "../bill/Summary"
import { BillProps } from "../bill/types"
import { Col, Container, Row } from "../bootstrap"
import { Back } from "../shared/CommonComponents"
import ViewTestimony from "../TestimonyCard/ViewTestimony"
import { AtpTestimonyPanel } from "./AtpTestimonyPanel"
import { useAtprotoTestimonyListing } from "./useAtprotoTestimonyListing"

/** BillDetails recomposed from its presentation-only children, for bills
 * sourced from ATProto records instead of Firestore. Everything coupled to
 * Firebase stays out: auth/flags, testimony form, follow button, bill
 * tracker. The testimony listing and header counters come from the #65
 * fan-out over every repo on the PDS, replacing the mapper's zeros once it
 * resolves.
 */
export const AtpBillDetails = ({ bill }: BillProps) => {
  const { t } = useTranslation("common")
  const { counts, ...testimonyListing } = useAtprotoTestimonyListing(bill)

  // Summary gates its hearing-video UI on hearingIds *presence* (not length),
  // and that UI fetches hearings from Firestore — omit the field entirely.
  const displayBill = { ...bill, hearingIds: undefined, ...counts }

  return (
    <Container className="mt-3 mb-3">
      <Row>
        <Col>
          <Back href="/atp/bills">{t("back_to_bills")}</Back>
        </Col>
      </Row>
      {bill.history.length > 0 ? (
        <Row className="align-items-end justify-content-start">
          <Col md={2}>
            <BillNumber bill={bill} />
          </Col>
          <Col
            xs={10}
            md={6}
            className="mb-3 ms-auto d-flex justify-content-end"
          >
            <Status bill={bill} />
          </Col>
        </Row>
      ) : (
        <Row>
          <Col>
            <BillNumber bill={bill} />
          </Col>
        </Row>
      )}
      <Row className="my-2">
        <Col>
          <Summary bill={displayBill} />
        </Col>
      </Row>
      <Row className="mt-4">
        <Col md={8}>
          <Sponsors bill={bill} className="pb-1" />
        </Col>
        <Col md={4}>
          <Committees bill={bill} className="mt-4 pb-1" />
          <Hearing
            bill={bill}
            className="bg-secondary d-flex justify-content-center mt-4 pb-1 text-light"
          />
        </Col>
      </Row>
      <Row className="mt-2">
        <Col md={8}>
          <div id="testimonies">
            {/* allowEdit off: editing lives in AtpTestimonyPanel, and the
                isUser check compares Firebase uids to DIDs anyway. */}
            <ViewTestimony
              {...testimonyListing}
              onProfilePage={false}
              allowEdit={false}
            />
          </div>
        </Col>
        <Col md={4}>
          <AtpTestimonyPanel bill={bill} />
        </Col>
      </Row>
    </Container>
  )
}
