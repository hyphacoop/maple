import { ToggleButton, ToggleButtonProps } from "react-bootstrap"
import styled from "styled-components"
import { Image, Row, Col } from "../bootstrap"
import { BillPosition, Position } from "../db"
import { useAppDispatch } from "../hooks"
import { conferencePositions, positionLabels } from "./content"
import { usePublishState } from "./hooks"
import { FormNavigation, Next } from "./NavigationButtons"
import { setPosition } from "./redux"
import { StepHeader } from "./StepHeader"
import { useMediaQuery } from "usehooks-ts"
import { usePublishCopy } from "./hooks"

export const ChooseStance = styled(({ ...rest }) => {
  const { copy, t } = usePublishCopy()
  const { position: currentPosition, conferenceId } = usePublishState()
  const dispatch = useAppDispatch()
  const isMobile = useMediaQuery("(max-width: 768px)")
  const props = (position: Position) => ({
    position,
    checked: currentPosition === position,
    onClick: () => void dispatch(setPosition(position))
  })
  const hasPosition = Boolean(currentPosition)
  return (
    <div {...rest}>
      <StepHeader step={1}>
        {conferenceId
          ? t("conference.submitTestimonyForm.chooseStance")
          : copy(
              "submitTestimonyForm.chooseStance",
              "ballotQuestion.submitTestimonyForm.chooseStance"
            )}
      </StepHeader>
      <Row className="d-flex gap-3 justify-content-center mt-4">
        {(conferenceId ? conferencePositions : billPositions).map(position => (
          <Col
            key={position}
            md={conferenceId ? 2 : 3}
            xs={12}
            className="d-flex justify-content-center"
          >
            <PositionButton {...props(position)} isMobile={isMobile} />
          </Col>
        ))}
      </Row>

      <FormNavigation status right={<Next disabled={!hasPosition} />} />
    </div>
  )
})``

const billPositions: readonly BillPosition[] = ["endorse", "neutral", "oppose"]

const PositionButton = styled<
  { position: Position; isMobile: boolean } & Pick<
    ToggleButtonProps,
    "onClick" | "checked"
  >
>(({ position, isMobile, ...rest }) => {
  // Conference positions have no icons yet; their buttons are labels alone.
  const icons: Record<BillPosition, React.ReactNode> = {
    neutral: (
      <Image
        alt=""
        src="/thumbs-up.svg"
        style={{ transform: "scaleY(-1) rotate(-0.25turn)" }}
      />
    ),
    endorse: <Image alt="" src="/thumbs-up.svg" />,
    oppose: (
      <Image alt="" src="/thumbs-up.svg" style={{ transform: "scaleY(-1)" }} />
    )
  }
  const icon = icons[position as BillPosition]
  return (
    <ToggleButton
      id={`${position}-btn`}
      value={position}
      type="radio"
      {...rest}
      variant="outline-secondary"
    >
      {icon}
      <div className={icon ? "mt-3" : ""}>{positionLabels[position]}</div>
    </ToggleButton>
  )
})`
  border-radius: 0.5rem;
  display: block;
  aspect-ratio: 1;
  width: ${props => (props.isMobile ? "100%" : "8rem")};
  height: 8rem;
`
