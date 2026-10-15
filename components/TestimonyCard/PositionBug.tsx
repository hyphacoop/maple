import { Image } from "react-bootstrap"
import { useTranslation } from "next-i18next"
import { ConferencePosition, Position } from "../db"
import { StancePill } from "./StancePill"

export function PositionLabel({ position }: { position: Position }) {
  const { t } = useTranslation("profile")

  if (ConferencePosition.guard(position))
    return (
      <div>
        <StancePill position={position} />
      </div>
    )

  const iconSrc = `/thumbs-${position}.svg`
  return (
    <div>
      <Image alt={t(`position.${position}`)} src={iconSrc} />
    </div>
  )
}
