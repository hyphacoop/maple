import { useTranslation } from "next-i18next"
import CardBootstrap from "react-bootstrap/Card"
import { useMediaQuery } from "usehooks-ts"
import { Col, Row } from "../bootstrap"
import { Internal } from "components/links"
import { capitalize } from "lodash"
import { truncateText } from "components/formatting"
import { ConferencePosition } from "components/db"
import { StancePill } from "components/TestimonyCard/StancePill"

export const NewsfeedBallotQuestionCardBody = ({
  ballotQuestionId,
  ballotStatus,
  header,
  timestamp
}: {
  ballotQuestionId?: string
  ballotStatus?: string
  header?: string
  timestamp?: string
}) => {
  const { t } = useTranslation("common")
  return (
    <CardBootstrap.Body className="p-2">
      {ballotStatus && (
        <CardBootstrap.Text className="text-body-secondary small mb-2">
          Status updated to: <strong>{ballotStatus}</strong>
        </CardBootstrap.Text>
      )}
      <CardBootstrap.Text className="text-body-secondary small mb-0">
        {t("newsfeed.actionTaken")}
        {timestamp}
      </CardBootstrap.Text>
      {ballotQuestionId && (
        <Internal
          href={`/ballotQuestions/${ballotQuestionId}`}
          className="small"
        >
          View ballot question
        </Internal>
      )}
    </CardBootstrap.Body>
  )
}

interface NewsfeedCardBodyProps {
  billText?: string
  position?: string
  text?: string
  timestamp?: string
  testimonyId?: string
  type?: string
}

export const NewsfeedBillCardBody = (props: NewsfeedCardBodyProps) => {
  const { position, text, timestamp } = props
  const { t } = useTranslation("common")
  const isMobile = useMediaQuery("(max-width: 550px)")
  return (
    <CardBootstrap.Body className={`p-0`}>
      <div
        className={`align-items-center bg-info d-flex mx-2 mt-1 mb-2 p-2 rounded`}
      >
        {isMobile ? (
          <>
            <Col className={`d-flex align-items-center flex-column m-2`}>
              <img
                src="\images\clock.svg"
                height="105.6"
                width="105.6"
                alt={position}
                className={`m-3`}
              />
              <CardBootstrap.Text className={`mb-0 mt-2`}>
                <strong>{truncateText(text, 600)}</strong>
              </CardBootstrap.Text>
              <>
                {t("newsfeed.actionTaken")}
                {timestamp}
              </>
            </Col>
          </>
        ) : (
          <>
            <img
              src="\images\clock.svg"
              height="105.6"
              width="105.6"
              alt={position}
              className={`m-3`}
            />
            <Col className={`m-2`}>
              <CardBootstrap.Text className={`mb-0`}>
                <strong>{truncateText(text, 600)}</strong>
              </CardBootstrap.Text>
              <>
                {t("newsfeed.actionTaken")}
                {timestamp}
              </>
            </Col>
          </>
        )}
      </div>
    </CardBootstrap.Body>
  )
}

/** A bill position's thumb and label, or a conference position's pill. */
const PositionMark = ({
  position,
  size,
  labelClassName
}: {
  position: string
  size: { height: string; width: string }
  labelClassName: string
}) =>
  ConferencePosition.guard(position) ? (
    <StancePill position={position} />
  ) : (
    <>
      <img src={`/thumbs-${position}.svg`} {...size} alt={position} />
      <div className={labelClassName}>{capitalize(position)}</div>
    </>
  )

export const NewsfeedTestimonyCardBody = (props: NewsfeedCardBodyProps) => {
  const { billText, position, text, testimonyId, timestamp } = props
  const isMobile = useMediaQuery("(max-width: 576px)")

  let endorsementColor = ""

  switch (position) {
    case "endorse":
      endorsementColor = `text-success`
      break
    case "oppose":
      endorsementColor = `text-warning`
      break
    default:
      endorsementColor = `text-secondary`
      break
  }

  return (
    <div>
      <CardBootstrap.Body className={`p-2`}>
        <CardBootstrap.Text className={`text-secondary mb-2`}>
          <strong>{billText}</strong>
        </CardBootstrap.Text>
        <Row className={`bg-body mx-0 mt-1 rounded`}>
          {isMobile ? (
            <Col className={`d-flex flex-column m-2 w-100`} xs="2">
              <div className={`align-self-center justify-content-center my-3`}>
                {position && (
                  <PositionMark
                    position={position}
                    size={{ height: "108", width: "106.5" }}
                    labelClassName={`${endorsementColor} fs-5`}
                  />
                )}
              </div>
              <strong className={`mb-4`}>{`"${truncateText(
                text,
                600
              )}"`}</strong>
            </Col>
          ) : (
            <>
              {position && (
                <Col
                  className={`d-flex align-self-center flex-column m-2`}
                  xs="2"
                >
                  <PositionMark
                    position={position}
                    size={{ height: "72", width: "72" }}
                    labelClassName={endorsementColor}
                  />
                </Col>
              )}
              <Col
                className={`d-flex align-self-center justify-content-center`}
              >
                <strong className={`m-4`}>{`"${truncateText(
                  text,
                  600
                )}"`}</strong>
              </Col>
            </>
          )}
        </Row>
        <NewsfeedTestimonyCardTail
          testimonyId={testimonyId}
          timestamp={timestamp}
        />
      </CardBootstrap.Body>
    </div>
  )
}

const NewsfeedTestimonyCardTail = (props: NewsfeedCardBodyProps) => {
  const { testimonyId, timestamp } = props
  const { t } = useTranslation("common")
  const isMobile = useMediaQuery("(max-width: 576px)")
  return (
    <>
      {isMobile ? (
        <Col className={`d-flex flex-wrap mt-2 mb-2`}>
          <Row className={`w-100`}>
            <div>
              {t("newsfeed.endorsementPost")}
              {timestamp}
            </div>
          </Row>
          <Row className={`w-100`}>
            <Internal href={`/testimony/${testimonyId}`}>
              <div>{t("newsfeed.viewFullTestimony")}</div>
            </Internal>
          </Row>
        </Col>
      ) : (
        <div className={`d-flex justify-content-between mt-2 mb-2`}>
          <div>
            {t("newsfeed.endorsementPost")}
            {timestamp}
          </div>
          <Internal href={`/testimony/${testimonyId}`}>
            <div>{t("newsfeed.viewFullTestimony")}</div>
          </Internal>
        </div>
      )}
    </>
  )
}
