/** Demo content for the #61 seed script: snapshots of four real 194th-court
 * MA bills, fetched from the legislature API on 2026-07-28 and pasted in (the
 * seed script does no live fetching). Distinct from fixtures.ts, whose values
 * are pinned by the validator's round-trip assertions — this data can change
 * freely. Summaries are hand-written demo text, not LLM output; DocumentText
 * is omitted (dropped by billToRecord anyway). */
import { Timestamp } from "firebase/firestore"
import type { Bill } from "components/db/bills"
import { currentGeneralCourt } from "functions/src/shared"

const seedCourt = currentGeneralCourt

/** Snapshot date for fetchedAt: when this data was pulled from the API. */
const fetchedAt = Timestamp.fromDate(new Date("2026-07-28T00:00:00Z"))

const zeroAggregates = {
  testimonyCount: 0,
  endorseCount: 0,
  opposeCount: 0,
  neutralCount: 0
}

export const seedBills: Bill[] = [
  {
    id: "H72",
    court: seedCourt,
    content: {
      Title: "An Act relative to the oversight of cable contracts",
      BillNumber: "H72",
      DocketNumber: "HD301",
      GeneralCourtNumber: seedCourt,
      PrimarySponsor: { Id: "J_B1", Name: "John Barrett, III", Type: 1 },
      Cosponsors: [{ Id: "J_B1", Name: "John Barrett, III", Type: 1 }],
      LegislationTypeName: "Bill",
      Pinslip:
        "By Representative Barrett of North Adams, a petition (accompanied by bill, House, No. 72) of John Barrett, III relative to the oversight of cable contracts.  Advanced Information Technology, the Internet and Cybersecurity."
    },
    cosponsorCount: 1,
    ...zeroAggregates,
    fetchedAt,
    history: [
      {
        Date: "2025-02-27T00:00:00",
        Branch: "House",
        Action:
          "Referred to the committee on Advanced Information Technology, the Internet and Cybersecurity"
      },
      {
        Date: "2025-02-27T00:00:00",
        Branch: "Senate",
        Action: "Senate concurred"
      },
      {
        Date: "2025-06-30T10:39:35.04",
        Branch: "Joint",
        Action: "Hearing scheduled for 07/10/2025 from 01:00 PM-05:00 PM in A-2"
      },
      {
        Date: "2025-09-17T15:43:04.1133333",
        Branch: "House",
        Action:
          "Bill reported favorably by committee and referred to the committee on House Ways and Means"
      }
    ],
    currentCommittee: {
      id: "J33",
      name: "Joint Committee on Advanced Information Technology, the Internet and Cybersecurity"
    },
    topics: [{ category: "Commerce", topic: "Telecommunications" }],
    summary:
      "Requires that license violations by cable operators be referred to the Department of Telecommunications and Cable, and that the department review settlement agreements between issuing authorities and licensees, rejecting any not in the best interest of impacted subscribers."
  },
  {
    id: "S25",
    court: seedCourt,
    content: {
      Title: "An Act amending the charter of the town of Sandwich",
      BillNumber: "S25",
      DocketNumber: "SD2618",
      GeneralCourtNumber: seedCourt,
      PrimarySponsor: { Id: "DAF0", Name: "Dylan A. Fernandes", Type: 1 },
      Cosponsors: [
        { Id: "DAF0", Name: "Dylan A. Fernandes", Type: 1 },
        { Id: "SGX1", Name: "Steven George Xiarhos", Type: 1 }
      ],
      LegislationTypeName: "Bill",
      Pinslip:
        "By Mr. Fernandes, a petition (accompanied by bill, Senate, No. 25) of Dylan A. Fernandes (by vote of the town) for legislation to amend the charter of the town of Sandwich.  Municipalities and Regional Government.  [Local Approval Received.]"
    },
    cosponsorCount: 2,
    ...zeroAggregates,
    fetchedAt,
    history: [
      {
        Date: "2025-03-06T11:09:29.9966667",
        Branch: "Senate",
        Action:
          "Referred to the committee on Municipalities and Regional Government"
      },
      {
        Date: "2025-03-10T16:49:01.54",
        Branch: "House",
        Action: "House concurred"
      },
      {
        Date: "2025-05-05T09:27:21.6466667",
        Branch: "Joint",
        Action: "Hearing scheduled for 05/13/2025 from 01:00 PM-05:00 PM in B-1"
      },
      {
        Date: "2025-06-18T13:21:48.1666667",
        Branch: "Senate",
        Action:
          "Bill reported favorably by committee and placed in the Orders of the Day for the next session"
      },
      {
        Date: "2025-07-17T12:05:48.5866667",
        Branch: "Senate",
        Action: "Read second and ordered to a third reading"
      },
      {
        Date: "2025-12-11T11:28:05.81",
        Branch: "Senate",
        Action: "Accompanied S24"
      }
    ],
    currentCommittee: {
      id: "J10",
      name: "Joint Committee on Municipalities and Regional Government"
    },
    city: "Sandwich",
    summary:
      "Home-rule petition converting the town clerk of Sandwich from an elected to an appointed department-head position, with the elected incumbent serving out the remainder of their term as the first appointed clerk."
  },
  {
    id: "H1234",
    court: seedCourt,
    content: {
      Title: "An Act relative to pharmacy benefit managers",
      BillNumber: "H1234",
      DocketNumber: "HD1358",
      GeneralCourtNumber: seedCourt,
      PrimarySponsor: { Id: "JJL2", Name: "John J. Lawn, Jr.", Type: 1 },
      Cosponsors: [{ Id: "JJL2", Name: "John J. Lawn, Jr.", Type: 1 }],
      LegislationTypeName: "Bill",
      Pinslip:
        "By Representative Lawn of Watertown, a petition (accompanied by bill, House, No. 1234) of John J. Lawn, Jr., relative to pharmacy benefit managers insurance services.  Financial Services."
    },
    cosponsorCount: 1,
    ...zeroAggregates,
    fetchedAt,
    history: [
      {
        Date: "2025-02-27T10:38:52.3833333",
        Branch: "House",
        Action: "Referred to the committee on Financial Services"
      },
      {
        Date: "2025-02-27T10:38:52.3833333",
        Branch: "Senate",
        Action: "Senate concurred"
      },
      {
        Date: "2025-06-03T10:31:26.94",
        Branch: "Joint",
        Action: "Hearing scheduled for 06/10/2025 from 10:30 AM-01:00 PM in A-2"
      },
      {
        Date: "2025-09-18T14:58:28.3733333",
        Branch: "House",
        Action:
          "Bill reported favorably by committee and referred to the committee on House Ways and Means"
      }
    ],
    currentCommittee: {
      id: "J11",
      name: "Joint Committee on Financial Services"
    },
    topics: [{ category: "Health care", topic: "Prescription drugs" }],
    summary:
      "Regulates pharmacy benefit managers: requires at least 80 per cent of estimated drug rebates to reduce insureds' cost-sharing at the point of sale, imposes duties of care and good faith on PBMs, sets network-adequacy and maximum-allowable-cost-list rules with a pharmacy grievance process, bans spread pricing and retroactive claim reductions on clean claims, subjects violators to a 10 per cent surcharge, and protects pharmacists' ability to tell patients about cheaper alternatives."
  },
  {
    id: "H2246",
    court: seedCourt,
    content: {
      Title:
        "An Act to hold property owners accountable for recurring public nuisance",
      BillNumber: "H2246",
      DocketNumber: "HD2151",
      GeneralCourtNumber: seedCourt,
      PrimarySponsor: { Id: "BJA1", Name: "Bruce J. Ayers", Type: 1 },
      Cosponsors: [{ Id: "BJA1", Name: "Bruce J. Ayers", Type: 1 }],
      LegislationTypeName: "Bill",
      Pinslip:
        "By Representative Ayers of Quincy, a petition (accompanied by bill, House, No. 2246) of Bruce J. Ayers relative to holding property owners accountable for recurring municipal public nuisance complaints.  Municipalities and Regional Government."
    },
    cosponsorCount: 1,
    ...zeroAggregates,
    fetchedAt,
    history: [
      {
        Date: "2025-02-27T10:38:52.3833333",
        Branch: "House",
        Action:
          "Referred to the committee on Municipalities and Regional Government"
      },
      {
        Date: "2025-02-27T10:38:52.3833333",
        Branch: "Senate",
        Action: "Senate concurred"
      },
      {
        Date: "2025-06-17T12:57:46.0066667",
        Branch: "Joint",
        Action: "Hearing scheduled for 06/24/2025 from 01:00 PM-05:00 PM in B-1"
      },
      {
        Date: "2025-11-24T12:12:46.2633333",
        Branch: "House",
        Action: "Accompanied a study order, see H4776"
      }
    ],
    currentCommittee: {
      id: "J10",
      name: "Joint Committee on Municipalities and Regional Government"
    },
    summary:
      "Makes property owners financially responsible for police-call costs after ten nuisance-related calls to a property within one year, with collected funds returned to the municipality and enforcement at the local police chief's discretion."
  }
]

/** The bill bob's seed testimony targets. */
export const testimonyBillId = "H1234"

export const bobTestimonyContent =
  "As a community pharmacist in Watertown, I support H.1234. Spread pricing and retroactive claw-backs make it impossible for independent pharmacies to stay open, and patients deserve to see rebate savings at the counter rather than months later. Please report this bill out favorably."
