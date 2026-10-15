import { formatTestimony, formatTestimonyPlaintext } from "components/testimony"
import { useProfile } from "../../db"
import { formatBillId } from "../../formatting"
import { maple, siteUrl } from "../../links"
import { conferenceActions, positionActions } from "../content"
import { BillPosition, ConferencePosition } from "../../db"
import { usePublishState } from "./usePublishState"

/** Generates the email sent to legislators. */
export const useTestimonyEmail = () => {
  const {
    share,
    position,
    bill,
    content,
    authorUid,
    ballotQuestionId,
    conferenceId
  } = usePublishState()
  const { profile } = useProfile()

  if (ballotQuestionId) {
    return { ready: false } as const
  }

  const to = share.recipients
      .map(r => `${r.Name} <${r.EmailAddress}>`)
      .join(";"),
    billId = formatBillId(bill?.id!),
    title = bill?.content.Title.trim(),
    intro = ConferencePosition.guard(position)
      ? `As your constituent, I am writing to urge the conference committee on bill ${billId}: "${title}" to ${conferenceActions[position]}.`
      : `As your constituent, I am writing to let you know that I ${
          positionActions[position as BillPosition]
        } bill ${billId}: "${title}".`,
    testimonyUrl =
      authorUid &&
      bill &&
      siteUrl(
        maple.userTestimony({
          authorUid,
          billId: bill.id,
          court: bill.court,
          ballotQuestionId,
          conferenceId
        })
      ),
    cta = `You can see my full testimony at ${testimonyUrl}`,
    ending = `Thank you for taking the time to read this email.\n\nSincerely,\n${
      profile?.fullName ?? ""
    }`,
    subjectPosition =
      position == "endorse"
        ? "Support of"
        : position == "oppose"
        ? "Opposition to"
        : "Opinion on",
    subject = ConferencePosition.guard(position)
      ? `Conference committee on Bill ${billId}: ${conferenceActions[position]}`
      : `${subjectPosition} Bill ${billId}`

  const markdownBody = [intro, content, cta, ending]
    .filter(Boolean)
    .join("\n\n")

  const plainBody = formatTestimonyPlaintext(markdownBody),
    htmlBody = formatTestimony(markdownBody).__html

  const mailToUrl = `mailto:${to}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(plainBody)}`

  if (profile) {
    return { ready: true, mailToUrl, body: htmlBody, to } as const
  } else {
    return { ready: false } as const
  }
}
