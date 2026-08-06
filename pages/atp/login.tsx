import { useTranslation } from "next-i18next"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useAtpAuth } from "components/atproto/auth"
import {
  Alert,
  Card,
  Col,
  Container,
  Form,
  Row,
  Spinner,
  Stack
} from "components/bootstrap"
import { LoadingButton, OutlineButton } from "components/buttons"
import Input from "components/forms/Input"
import PasswordInput from "components/forms/PasswordInput"
import { createPage } from "components/page"
import { createGetStaticTranslationProps } from "components/translations"

type AtpLoginForm = {
  identifier: string
  password: string
}

function AtpLoginPage() {
  const { t } = useTranslation("auth")
  const { session, status, login, logout } = useAtpAuth()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<AtpLoginForm>()

  const onSubmit = handleSubmit(async ({ identifier, password }) => {
    setSubmitError(null)
    setSubmitting(true)
    try {
      await login(identifier, password)
    } catch {
      // The PDS returns the identical error for an unknown account and a
      // wrong password, so a more specific message would be a lie.
      setSubmitError(t("atpSignInFailed") ?? "Sign-in failed.")
    } finally {
      setSubmitting(false)
    }
  })

  return (
    <Container className="py-5">
      <Row className="justify-content-center">
        <Col xs={12} sm={10} md={8} lg={6}>
          <Card className="p-4 shadow-lg">
            <h2 className="text-center">{t("atpSignInTitle")}</h2>

            {status === "resuming" ? (
              <Row>
                <Spinner animation="border" className="mx-auto" />
              </Row>
            ) : session ? (
              <Stack gap={3}>
                <Alert variant="success" className="mb-0">
                  {t("atpSignedIn")}
                </Alert>
                <div>
                  <div>
                    <strong>{t("atpHandle")}</strong> {session.handle}
                  </div>
                  <div>
                    <strong>{t("atpDid")}</strong> <code>{session.did}</code>
                  </div>
                </div>
                <OutlineButton
                  label={t("signOut") ?? "Sign Out"}
                  onClick={() => logout()}
                />
              </Stack>
            ) : (
              <Form onSubmit={onSubmit} noValidate>
                {submitError && <Alert variant="danger">{submitError}</Alert>}

                <Stack gap={3}>
                  <Input
                    label={t("atpHandleLabel")}
                    type="text"
                    {...register("identifier", {
                      required: t("atpHandleRequired") ?? "Handle is required"
                    })}
                    error={errors.identifier?.message}
                  />

                  <PasswordInput
                    label={t("password") ?? "Password"}
                    {...register("password", {
                      required:
                        t("atpPasswordRequired") ?? "Password is required"
                    })}
                    error={errors.password?.message}
                  />

                  <LoadingButton
                    type="submit"
                    className="w-100"
                    loading={submitting}
                  >
                    {t("signIn")}
                  </LoadingButton>
                </Stack>
              </Form>
            )}
          </Card>
        </Col>
      </Row>
    </Container>
  )
}

export default createPage({
  Page: AtpLoginPage
})

export const getStaticProps = createGetStaticTranslationProps([
  "auth",
  "common",
  "footer"
])
