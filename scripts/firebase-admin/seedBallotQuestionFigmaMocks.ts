import { Timestamp } from "functions/src/firebase"
import { Script } from "./types"

const court = 192
const electionYear = new Date().getFullYear()

const authors = {
  thea: {
    uid: "thea-davis",
    authorDisplayName: "Thea Davis",
    authorRole: "user",
    fullName: "Thea Davis"
  },
  rafael: {
    uid: "rafael-klein",
    authorDisplayName: "Rafael Klein",
    authorRole: "user",
    fullName: "Rafael Klein"
  },
  alicia: {
    uid: "alicia-nguyen",
    authorDisplayName: "Alicia Nguyen",
    authorRole: "user",
    fullName: "Alicia Nguyen"
  },
  karen: {
    uid: "karen-whitfield",
    authorDisplayName: "Karen Whitfield",
    authorRole: "user",
    fullName: "Karen Whitfield"
  }
} as const

type DemoQuestion = {
  id: string
  billId: string
  ballotQuestionNumber: number | null
  ballotStatus:
    | "qualifying"
    | "certified"
    | "ballot"
    | "legislature"
    | "enacted"
    | "failed"
    | "withdrawn"
  type:
    | "initiative_statute"
    | "initiative_constitutional"
    | "legislative_referral"
    | "constitutional_amendment"
    | "advisory"
  title: string
  description: string
  fullSummary: string
  atAGlance: { label: string; value: string }[]
  testimonies: Array<{
    id: string
    publishedAt: string
    position: "endorse" | "oppose" | "neutral"
    content: string
    author: keyof typeof authors
  }>
}

const demoQuestions: DemoQuestion[] = [
  {
    id: "25-15",
    billId: "H10",
    ballotQuestionNumber: 4,
    ballotStatus: "ballot",
    type: "initiative_statute",
    title:
      "Limited Legalization and Regulation of Certain Natural Psychedelic Substances",
    description:
      "This proposal would allow adults 21 and older to grow, possess, and use certain natural psychedelic substances under limited and regulated conditions.",
    fullSummary:
      "This proposed law would allow persons aged 21 and older to grow, possess, and use certain natural psychedelic substances in certain circumstances. The psychedelic substances allowed would be two substances found in mushrooms (psilocybin and psilocin) and three substances found in plants (dimethyltryptamine, mescaline, and ibogaine). These substances could be purchased at an approved location for use under the supervision of a licensed facilitator. This proposed law would otherwise prohibit any retail sale of natural psychedelic substances. This proposed law would also provide for the regulation and taxation of these psychedelic substances.",
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
    testimonies: [
      {
        author: "thea",
        id: "bq-25-15-thea-davis",
        publishedAt: "2026-03-20T12:00:00Z",
        position: "neutral",
        content:
          "I see potential benefits in regulating substances that are already being used by some people, rather than leaving everything unregulated. At the same time, I have concerns about enforcement, taxation, and how communities would be affected. I would support keeping retail sales prohibited, which helps limit commercialization. Overall, I am undecided and would like to see more data from other states or pilot programs before forming a strong opinion."
      },
      {
        author: "rafael",
        id: "bq-25-15-rafael-klein",
        publishedAt: "2026-03-21T12:00:00Z",
        position: "oppose",
        content:
          "I oppose this ballot initiative. While I understand the intent to regulate and control use, I worry that legalizing these substances, even in limited circumstances, sends the wrong message and could lead to increased misuse over time. I am also concerned about the long-term health effects and whether the state is prepared to handle unintended consequences. In my view, more research and stronger safeguards are needed before making a change of this magnitude."
      },
      {
        author: "alicia",
        id: "bq-25-15-alicia-nguyen",
        publishedAt: "2026-03-22T12:00:00Z",
        position: "endorse",
        content:
          "I strongly support this initiative because it takes a careful, responsible approach to psychedelic substances by limiting access to natural sources, requiring licensed facilitators, and prohibiting general retail sales. This proposal seems designed to reduce harm, encourage healing, and bring these substances into a regulated framework that we can understand better. Regulation and education are far better than criminalization, which has not worked and has caused real harm. This proposal feels thoughtful and measured."
      },
      {
        author: "karen",
        id: "bq-25-15-karen-whitfield",
        publishedAt: "2026-03-23T12:00:00Z",
        position: "oppose",
        content:
          "I am generally open to learning more about this proposal, but I still have some questions. I appreciate that the initiative limits access to adults over 21 and requires supervised use through licensed facilitators. That said, I would like clearer information about how facilitators would be trained and regulated, and how public health impacts would be monitored over time. I am not firmly for or against the proposal yet, but I believe these details are important before moving forward."
      }
    ]
  },
  {
    id: "25-16",
    billId: "H1001",
    ballotQuestionNumber: 5,
    ballotStatus: "certified",
    type: "initiative_statute",
    title: "Require Front-of-Package Warnings for Ultra-Processed Foods",
    description:
      "This proposal would require certain packaged foods with high levels of added sugar, sodium, or saturated fat to carry a front-of-package warning label.",
    fullSummary:
      "This proposed law would require manufacturers of certain packaged foods sold in Massachusetts to display a front-of-package warning when a product exceeds state-defined thresholds for added sugar, sodium, or saturated fat. Supporters argue the labels would improve consumer awareness and public health. Opponents argue the proposal could increase costs and create labeling burdens for producers and retailers.",
    atAGlance: [
      { label: "Applies to", value: "Certain packaged foods sold in Massachusetts" },
      { label: "Requires", value: "Front-of-package health warning labels" },
      { label: "Focus", value: "Added sugar, sodium, and saturated fat" },
      { label: "Exemptions", value: "Some small producers and fresh items" }
    ],
    testimonies: [
      {
        author: "thea",
        id: "bq-25-16-thea-davis",
        publishedAt: "2026-03-18T12:00:00Z",
        position: "endorse",
        content:
          "I support this ballot question because consumers deserve clearer, faster information when making food choices. A simple front-of-package label could help families compare products without needing to decode small-print nutrition panels in the grocery aisle."
      },
      {
        author: "rafael",
        id: "bq-25-16-rafael-klein",
        publishedAt: "2026-03-19T12:00:00Z",
        position: "oppose",
        content:
          "I am not convinced the proposed warning labels would be implemented fairly or consistently. This feels like a blunt regulatory tool that could impose costs on smaller businesses without clearly changing long-term health outcomes."
      },
      {
        author: "alicia",
        id: "bq-25-16-alicia-nguyen",
        publishedAt: "2026-03-20T12:00:00Z",
        position: "endorse",
        content:
          "This proposal is a modest, practical public-health measure. We already label products in many ways, and this would simply make nutrition risks more visible at the point of purchase."
      }
    ]
  },
  {
    id: "25-17",
    billId: "H1002",
    ballotQuestionNumber: null,
    ballotStatus: "qualifying",
    type: "initiative_statute",
    title: "Create a Small-Donor Public Matching Program for State Elections",
    description:
      "This proposal would establish a public matching system for qualifying small-dollar contributions in statewide and legislative elections.",
    fullSummary:
      "This proposed law would create a voluntary public campaign financing program that matches qualifying small-dollar donations for participating candidates. Supporters argue the proposal would reduce reliance on large donors and broaden participation. Opponents argue it would use public funds for campaign activity and may not reduce outside spending as intended.",
    atAGlance: [
      { label: "Creates", value: "A public matching fund program for campaigns" },
      { label: "Goal", value: "Increase the influence of small-dollar donors" },
      { label: "Participation", value: "Voluntary for qualifying candidates" },
      { label: "Funding source", value: "Public dollars appropriated for the program" }
    ],
    testimonies: [
      {
        author: "thea",
        id: "bq-25-17-thea-davis",
        publishedAt: "2026-03-15T12:00:00Z",
        position: "endorse",
        content:
          "I support this proposal because it could give ordinary residents more influence in elections. Matching small donations is one of the few reforms that seems capable of shifting candidate attention away from high-dollar fundraising."
      },
      {
        author: "rafael",
        id: "bq-25-17-rafael-klein",
        publishedAt: "2026-03-16T12:00:00Z",
        position: "neutral",
        content:
          "I like the goal of increasing participation, but I would want stronger guardrails and reporting requirements before supporting public matching. The concept is promising, but the details matter a lot."
      },
      {
        author: "karen",
        id: "bq-25-17-karen-whitfield",
        publishedAt: "2026-03-17T12:00:00Z",
        position: "oppose",
        content:
          "I oppose using public money for campaign matching. Even if the intent is good, I would rather see those funds used for direct public services than political activity."
      }
    ]
  }
]

export const script: Script = async ({ db }) => {
  const batch = db.batch()

  for (const question of demoQuestions) {
    const ballotQuestionRef = db.doc(`ballotQuestions/${question.id}`)
    const billRef = db.doc(`generalCourts/${court}/bills/${question.billId}`)

    batch.set(
      ballotQuestionRef,
      {
        id: question.id,
        billId: question.billId,
        court,
        electionYear,
        type: question.type,
        ballotStatus: question.ballotStatus,
        ballotQuestionNumber: question.ballotQuestionNumber,
        relatedBillIds: [question.billId],
        description: question.description,
        atAGlance: question.atAGlance,
        fullSummary: question.fullSummary,
        pdfUrl: null
      },
      { merge: true }
    )

    const billSnap = await billRef.get()
    if (billSnap.exists) {
      const bill = billSnap.data() as any
      batch.set(
        billRef,
        {
          content: {
            ...bill.content,
            Title: question.title
          }
        },
        { merge: true }
      )
    }

    const existing = await db
      .collectionGroup("publishedTestimony")
      .where("ballotQuestionId", "==", question.id)
      .get()

    existing.docs.forEach(doc => batch.delete(doc.ref))

    for (const seededTestimony of question.testimonies) {
      const author = authors[seededTestimony.author]

      batch.set(
        db.doc(`profiles/${author.uid}`),
        {
          fullName: author.fullName,
          role: author.authorRole,
          public: true
        },
        { merge: true }
      )

      batch.set(
        db.doc(`users/${author.uid}/publishedTestimony/${seededTestimony.id}`),
        {
          billId: question.billId,
          court,
          position: seededTestimony.position,
          content: seededTestimony.content,
          attachmentId: null,
          editReason: null,
          ballotQuestionId: question.id,
          authorUid: author.uid,
          authorDisplayName: author.authorDisplayName,
          authorRole: author.authorRole,
          billTitle: question.title,
          version: 1,
          public: true,
          publishedAt: Timestamp.fromDate(new Date(seededTestimony.publishedAt)),
          updatedAt: Timestamp.fromDate(new Date(seededTestimony.publishedAt)),
          draftAttachmentId: null,
          fullName: author.fullName
        },
        { merge: true }
      )
    }
  }

  await batch.commit()

  console.log(
    `Seeded ${demoQuestions.length} ballot questions and ${demoQuestions.reduce(
      (count, question) => count + question.testimonies.length,
      0
    )} testimony examples.`
  )
}
