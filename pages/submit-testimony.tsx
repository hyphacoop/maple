import { useEffect, useState } from "react"
import { useRouter } from "next/router"
import { requireAuth, useAuth } from "../components/auth"
import { isActiveBallotQuestionPhase } from "../components/ballotquestions/status"
import { dbService } from "../components/db"
import { createPage } from "../components/page"
import {
  usePublishService,
  useSyncRouterAndStore
} from "../components/publish/hooks"
import { SubmitTestimonyForm } from "../components/publish/SubmitTestimonyForm"
import { createGetStaticTranslationProps } from "components/translations"
import { useFlags } from "components/featureFlags"

export default createPage({
  titleI18nKey: "titles.submit_testimony",
  Page: requireAuth(() => <SubmitTestimonyPage />)
})

function SubmitTestimonyPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { conferences } = useFlags()
  const [isAllowed, setIsAllowed] = useState(false)

  useEffect(() => {
    if (!router.isReady) return

    if (user && !user.emailVerified) {
      void router.replace(`/profile?id=${user.uid}`)
      return
    }

    const ballotQuestionId =
      typeof router.query.ballotQuestionId === "string"
        ? router.query.ballotQuestionId
        : undefined

    // Conference testimony is only offered while conferences are flagged on.
    if (typeof router.query.conferenceId === "string" && !conferences) {
      void router.replace("/")
      return
    }

    if (!ballotQuestionId) {
      setIsAllowed(true)
      return
    }

    let active = true
    setIsAllowed(false)

    dbService()
      .getBallotQuestion({ id: ballotQuestionId })
      .then(ballotQuestion => {
        if (!active) return

        if (
          ballotQuestion &&
          isActiveBallotQuestionPhase(ballotQuestion.ballotStatus)
        ) {
          setIsAllowed(true)
          return
        }

        void router.replace(
          ballotQuestion
            ? `/ballotQuestions/${ballotQuestionId}`
            : "/ballotQuestions"
        )
      })
      .catch(() => {
        if (active) void router.replace("/ballotQuestions")
      })

    return () => {
      active = false
    }
  }, [conferences, router, user])

  if (!isAllowed) return null

  return <SubmitTestimonyContent />
}

function SubmitTestimonyContent() {
  useSyncRouterAndStore()

  return (
    <>
      <usePublishService.Provider />
      <SubmitTestimonyForm />
    </>
  )
}

export const getStaticProps = createGetStaticTranslationProps([
  "auth",
  "attachment",
  "common",
  "footer",
  "testimony",
  "editProfile"
])
