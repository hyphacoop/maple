import { Timestamp } from "firebase/firestore"
import { useTranslation } from "next-i18next"
import { useEffect, useState } from "react"
import { ToggleButton } from "react-bootstrap"
import { BillProps } from "../bill/types"
import { Alert, Card, Form, Spinner, Stack } from "../bootstrap"
import { LoadingButton } from "../buttons"
import type { Position } from "../db"
import { maxTestimonyLength } from "../db/testimony/types"
import { TextArea } from "../forms/Input"
import { Internal } from "../links"
import { positionLabels } from "../publish/content"
import {
  AtpTestimonyRecordRef,
  getAtpTestimony,
  mapleDid,
  putAtpTestimony
} from "./api"
import { useAtpAuth } from "./auth"
import { timestampFromIso } from "./mappers"

type OwnTestimony =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; existing: AtpTestimonyRecordRef | null }

const positions: Position[] = ["endorse", "neutral", "oppose"]

/** Minimal testimony form for the ATP bill page: putRecord into the signed-in
 * user's own repo. The deterministic rkey makes resubmission an edit-in-place
 * upsert, so "publish" and "update" are the same write. Deliberately not the
 * components/publish multi-step flow — no drafts, attachments, edit reasons,
 * or legislator routing (see docs/atproto-spike-notes.md #64). Plain useState
 * rather than react-hook-form: the form is a toggle group plus the shared
 * controlled TextArea, and prefills async from the PDS.
 */
export const AtpTestimonyPanel = ({ bill }: BillProps) => {
  const { t } = useTranslation("auth")
  const { agent, session, status } = useAtpAuth()
  const [own, setOwn] = useState<OwnTestimony>({ status: "loading" })
  const [position, setPosition] = useState<Position | undefined>()
  const [content, setContent] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const did = session?.did

  useEffect(() => {
    if (status !== "signedIn" || !did) return
    let cancelled = false
    setOwn({ status: "loading" })
    getAtpTestimony(did, bill.court, bill.id).then(
      existing => {
        if (cancelled) return
        setOwn({ status: "loaded", existing })
        setPosition(existing?.value.position)
        setContent(existing?.value.content ?? "")
      },
      () => {
        if (!cancelled) setOwn({ status: "error" })
      }
    )
    return () => {
      cancelled = true
    }
  }, [status, did, bill.court, bill.id])

  const onSubmit = async () => {
    if (own.status !== "loaded" || !did || !position) return
    const trimmed = content.trim()
    if (!trimmed) return setFormError(t("atpTestimonyContentRequired"))
    // Mirrors the app's Content runtype (exclusive bound); the lexicon's
    // 10000-grapheme cap is inclusive, so this is the stricter of the two.
    if (trimmed.length >= maxTestimonyLength)
      return setFormError(
        t("atpTestimonyContentTooLong", { max: maxTestimonyLength })
      )
    setFormError(null)
    setSubmitting(true)
    try {
      if (!mapleDid) throw new Error("NEXT_PUBLIC_MAPLE_DID is not set")
      await putAtpTestimony(agent, mapleDid, {
        court: bill.court,
        billId: bill.id,
        position,
        content: trimmed,
        // Preserve createdAt across edits: the overwrite is observable as a
        // changed cid on a stable uri, not a reset timestamp.
        publishedAt: own.existing
          ? timestampFromIso(own.existing.value.createdAt)
          : Timestamp.now()
      })
      // Re-fetch rather than trusting local state — the read-back is the point.
      const existing = await getAtpTestimony(did, bill.court, bill.id)
      setOwn({ status: "loaded", existing })
      setPosition(existing?.value.position)
      setContent(existing?.value.content ?? "")
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setFormError(`${t("atpTestimonySubmitFailed")} ${detail}`)
    } finally {
      setSubmitting(false)
    }
  }

  let body
  if (status === "signedOut") {
    body = (
      <>
        <p>{t("atpTestimonySignInPrompt")}</p>
        <Internal href="/atp/login">{t("signIn")}</Internal>
      </>
    )
  } else if (status === "resuming" || own.status === "loading") {
    body = <Spinner animation="border" className="mx-auto" />
  } else if (own.status === "error") {
    body = <Alert variant="danger">{t("atpTestimonyLoadFailed")}</Alert>
  } else {
    const { existing } = own
    body = (
      <Stack gap={3}>
        {existing && (
          <Alert variant="success" className="mb-0">
            <div>{t("atpTestimonyPublished")}</div>
            <div>
              {timestampFromIso(existing.value.createdAt)
                .toDate()
                .toLocaleString()}
            </div>
            <div className="text-break">
              <code>{existing.uri}</code>
            </div>
            <div className="text-break">
              <code>{existing.cid}</code>
            </div>
          </Alert>
        )}
        {formError && (
          <Alert variant="danger" className="mb-0">
            {formError}
          </Alert>
        )}
        <div>
          <Form.Label>{t("atpTestimonyPositionLabel")}</Form.Label>
          <div className="d-flex gap-2">
            {positions.map(p => (
              <ToggleButton
                key={p}
                id={`atp-position-${p}`}
                value={p}
                type="radio"
                variant="outline-secondary"
                checked={position === p}
                onClick={() => setPosition(p)}
              >
                {positionLabels[p]}
              </ToggleButton>
            ))}
          </div>
        </div>
        <TextArea
          label={t("atpTestimonyContentLabel")}
          content={content}
          setContent={c => {
            setContent(c)
            setFormError(null)
          }}
          rows={6}
        />
        <LoadingButton
          loading={submitting}
          disabled={!position}
          onClick={onSubmit}
        >
          {existing ? t("atpTestimonyUpdate") : t("atpTestimonySubmit")}
        </LoadingButton>
      </Stack>
    )
  }

  return (
    <Card className="p-3">
      <h4>{t("atpTestimonyPanelTitle")}</h4>
      {body}
    </Card>
  )
}
