import { useTranslation } from "next-i18next"
import { Alert, Container } from "../bootstrap"

/** Shown when NEXT_PUBLIC_MAPLE_DID is unset or the configured repo doesn't
 * exist on the PDS — both routine after an atp:dev restart, and both config
 * problems that a 404 would misreport as missing data. */
export const AtpSetupAlert = () => {
  const { t } = useTranslation("auth")
  return (
    <Container className="mt-3 mb-3">
      <Alert variant="warning">
        <Alert.Heading>{t("atpSetupNeededTitle")}</Alert.Heading>
        <p className="mb-0">{t("atpSetupNeededBody")}</p>
      </Alert>
    </Container>
  )
}
