import { Timestamp } from "functions/src/firebase"
import { Script } from "./types"

const ballotQuestionId = "25-15"
const court = 192
const billId = "H10"
const electionYear = new Date().getFullYear()

const title =
  "Limited Legalization and Regulation of Certain Natural Psychedelic Substances"

const description =
  "This proposal would allow adults 21 and older to grow, possess, and use certain natural psychedelic substances under limited and regulated conditions."

const fullSummary =
  "This proposed law would allow persons aged 21 and older to grow, possess, and use certain natural psychedelic substances in certain circumstances. The psychedelic substances allowed would be two substances found in mushrooms (psilocybin and psilocin) and three substances found in plants (dimethyltryptamine, mescaline, and ibogaine). These substances could be purchased at an approved location for use under the supervision of a licensed facilitator. This proposed law would otherwise prohibit any retail sale of natural psychedelic substances. This proposed law would also provide for the regulation and taxation of these psychedelic substances."

const figmaTestimonies = [
  {
    uid: "thea-davis",
    id: "bq-25-15-thea-davis",
    publishedAt: "2026-03-20T12:00:00Z",
    position: "neutral",
    authorDisplayName: "Thea Davis",
    authorRole: "user",
    fullName: "Thea Davis",
    content:
      "I see potential benefits in regulating substances that are already being used by some people, rather than leaving everything unregulated. At the same time, I have concerns about enforcement, taxation, and how communities would be affected. I would support keeping retail sales prohibited, which helps limit commercialization. Overall, I am undecided and would like to see more data from other states or pilot programs before forming a strong opinion."
  },
  {
    uid: "rafael-klein",
    id: "bq-25-15-rafael-klein",
    publishedAt: "2026-03-21T12:00:00Z",
    position: "oppose",
    authorDisplayName: "Rafael Klein",
    authorRole: "user",
    fullName: "Rafael Klein",
    content:
      "I oppose this ballot initiative. While I understand the intent to regulate and control use, I worry that legalizing these substances, even in limited circumstances, sends the wrong message and could lead to increased misuse over time. I am also concerned about the long-term health effects and whether the state is prepared to handle unintended consequences. In my view, more research and stronger safeguards are needed before making a change of this magnitude."
  },
  {
    uid: "alicia-nguyen",
    id: "bq-25-15-alicia-nguyen",
    publishedAt: "2026-03-22T12:00:00Z",
    position: "endorse",
    authorDisplayName: "Alicia Nguyen",
    authorRole: "user",
    fullName: "Alicia Nguyen",
    content:
      "I strongly support this initiative because it takes a careful, responsible approach to psychedelic substances by limiting access to natural sources, requiring licensed facilitators, and prohibiting general retail sales. This proposal seems designed to reduce harm, encourage healing, and bring these substances into a regulated framework that we can understand better. Regulation and education are far better than criminalization, which has not worked and has caused real harm. This proposal feels thoughtful and measured."
  },
  {
    uid: "karen-whitfield",
    id: "bq-25-15-karen-whitfield",
    publishedAt: "2026-03-23T12:00:00Z",
    position: "oppose",
    authorDisplayName: "Karen Whitfield",
    authorRole: "user",
    fullName: "Karen Whitfield",
    content:
      "I am generally open to learning more about this proposal, but I still have some questions. I appreciate that the initiative limits access to adults over 21 and requires supervised use through licensed facilitators. That said, I would like clearer information about how facilitators would be trained and regulated, and how public health impacts would be monitored over time. I am not firmly for or against the proposal yet, but I believe these details are important before moving forward."
  }
] as const

export const script: Script = async ({ db }) => {
  const ballotQuestionRef = db.doc(`ballotQuestions/${ballotQuestionId}`)
  const billRef = db.doc(`generalCourts/${court}/bills/${billId}`)

  await ballotQuestionRef.set(
    {
      id: ballotQuestionId,
      billId,
      court,
      electionYear,
      type: "initiative_statute",
      ballotStatus: "ballot",
      ballotQuestionNumber: 4,
      relatedBillIds: [billId],
      description,
      atAGlance: [
        { label: "Who", value: "Adults 21 and older" },
        {
          label: "What substances",
          value: "Psilocybin, psilocin, DMT, mescaline, ibogaine"
        },
        {
          label: "How",
          value: "Limited personal use and supervised use at approved locations"
        },
        { label: "Retail sales", value: "Not allowed" },
        {
          label: "Oversight",
          value: "Licensed facilitators, state regulation, and taxation"
        }
      ],
      fullSummary,
      pdfUrl: null
    },
    { merge: true }
  )

  const billSnap = await billRef.get()
  if (billSnap.exists) {
    const bill = billSnap.data() as any
    await billRef.set(
      {
        content: {
          ...bill.content,
          Title: title
        }
      },
      { merge: true }
    )
  }

  const existing = await db
    .collectionGroup("publishedTestimony")
    .where("ballotQuestionId", "==", ballotQuestionId)
    .get()

  const batch = db.batch()
  existing.docs.forEach(doc => batch.delete(doc.ref))

  for (const testimony of figmaTestimonies) {
    batch.set(
      db.doc(`profiles/${testimony.uid}`),
      {
        fullName: testimony.fullName,
        role: testimony.authorRole,
        public: true
      },
      { merge: true }
    )

    batch.set(
      db.doc(`users/${testimony.uid}/publishedTestimony/${testimony.id}`),
      {
        billId,
        court,
        position: testimony.position,
        content: testimony.content,
        attachmentId: null,
        editReason: null,
        ballotQuestionId,
        authorUid: testimony.uid,
        authorDisplayName: testimony.authorDisplayName,
        authorRole: testimony.authorRole,
        billTitle: title,
        version: 1,
        public: true,
        publishedAt: Timestamp.fromDate(new Date(testimony.publishedAt)),
        updatedAt: Timestamp.fromDate(new Date(testimony.publishedAt)),
        draftAttachmentId: null,
        fullName: testimony.fullName
      },
      { merge: true }
    )
  }

  await batch.commit()

  console.log(
    `Updated ${ballotQuestionId} to use Figma placeholder copy and seeded ${figmaTestimonies.length} testimony examples.`
  )
}
