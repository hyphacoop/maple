import "@testing-library/jest-dom"
import { fireEvent, render, screen } from "@testing-library/react"
import { ConferenceDetails } from "./ConferenceDetails"
import type { ConferencePageProps } from "./types"

jest.mock("next-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length
        ? `${key} ${Object.values(opts).join(" ")}`
        : key,
    i18n: { language: "en" }
  }),
  // The key, the values and the links it would wrap, so a test can find the
  // link targets without an i18n instance.
  Trans: ({
    i18nKey,
    values = {},
    components = {}
  }: {
    i18nKey: string
    values?: Record<string, unknown>
    components?: Record<string, JSX.Element>
  }) => (
    <span data-testid={i18nKey}>
      {Object.values(values).join(" ")}
      {Object.values(components)}
    </span>
  )
}))

jest.mock("usehooks-ts", () => ({ useMediaQuery: () => false }))

let mockLegislators = false
jest.mock("../featureFlags", () => ({
  useFlags: () => ({
    legislators: mockLegislators,
    hearingsAndTranscriptions: true
  })
}))

const profile = { representative: { id: "AHP1" } }
jest.mock("../db", () => ({ useProfile: () => ({ profile }) }))

const mockListing = jest.fn()
jest.mock("../db/testimony/usePublishedTestimonyListing", () => ({
  usePublishedTestimonyListing: (r: unknown) => mockListing(r)
}))

const conference: ConferencePageProps["conference"] = {
  id: "student-learning-and-mental-health",
  name: "Phone-Free Schools",
  court: 194,
  title: "An Act to promote student learning and mental health",
  senateBillId: "S2581",
  houseBillId: "H5366",
  status: "appointed"
}

const props: ConferencePageProps = {
  conference,
  conferences: [
    conference,
    {
      id: "data-privacy",
      court: 194,
      name: "Data Privacy",
      title: "An Act establishing the Massachusetts data privacy act",
      senateBillId: "S2619",
      houseBillId: "H5479",
      status: "appointed"
    }
  ],
  conferees: [
    {
      memberCode: "BPC0",
      branch: "Senate",
      chair: true,
      name: "Brendan P. Crighton",
      party: "Democrat",
      district: "Third Essex",
      seat: "senate-3-essex"
    },
    {
      memberCode: "MJR0",
      branch: "Senate",
      chair: false,
      name: "Michael J. Rodrigues",
      party: "Democrat",
      district: "First Bristol and Plymouth",
      seat: "senate-1-bristol-plymouth"
    },
    {
      memberCode: "PJD0",
      branch: "Senate",
      chair: false,
      name: "Peter J. Durant",
      party: "Republican",
      district: "Worcester and Hampshire",
      seat: "senate-worcester-hampshire"
    },
    {
      memberCode: "AHP1",
      branch: "House",
      chair: true,
      name: "Alice Hanlon Peisch",
      party: "Democrat",
      district: "14th Norfolk",
      seat: "house-14-norfolk"
    },
    {
      memberCode: "FAM1",
      branch: "House",
      chair: false,
      name: "Frank A. Moran",
      party: "Democrat",
      district: "17th Essex",
      seat: "house-17-essex"
    },
    {
      memberCode: "DTV1",
      branch: "House",
      chair: false,
      name: "David T. Vieira",
      party: "Republican",
      district: "3rd Barnstable",
      seat: "house-3-barnstable"
    }
  ],
  hearings: [
    {
      id: "hearing-5710",
      eventId: 5710,
      startsAt: Date.UTC(2026, 5, 4, 17)
    }
  ],
  testimony: {
    canonicalBillId: "S2581",
    status: "appointed",
    testimonyCount: 3,
    counts: {
      passNothing: 0,
      passSomething: 1,
      passSenateVersion: 2,
      passHouseVersion: 0
    }
  }
}

const published = (id: string, position: string, fullName: string) => ({
  id,
  position,
  fullName,
  content: `${fullName} wants ${position}`
})

beforeEach(() => {
  mockListing.mockReturnValue({
    items: {
      status: "success",
      result: [
        published("t1", "passSenateVersion", "Ada"),
        published("t2", "passSomething", "Grace"),
        published("t3", "passSenateVersion", "Edsger")
      ]
    },
    pagination: { hasNextPage: false, hasPreviousPage: false }
  })
})

describe("ConferenceDetails", () => {
  it("names the six, the chairs, the bills and the hearing", () => {
    const { container } = render(<ConferenceDetails {...props} />)

    for (const name of [
      "B. Crighton",
      "M. Rodrigues",
      "P. Durant",
      "A. Peisch",
      "F. Moran",
      "D. Vieira"
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getAllByText("chair")).toHaveLength(2)

    const byline = screen.getByTestId("byline")
    expect(byline).toHaveTextContent("S.2581")
    expect(byline).toHaveTextContent("H.5366")
    expect(container.querySelector('a[href="/bills/194/S2581"]')).toBeTruthy()
    expect(container.querySelector('a[href="/bills/194/H5366"]')).toBeTruthy()

    expect(screen.getByText(/hearing_held June 4, 2026/)).toHaveAttribute(
      "href",
      "/hearing/5710"
    )
    expect(screen.getByText("seats_lit senate 3 40")).toBeInTheDocument()
    expect(screen.getByText("seats_lit house 3 160")).toBeInTheDocument()
  })

  it("marks the viewer's own legislator", () => {
    render(<ConferenceDetails {...props} />)
    // Under the name in place of the district, and as the star on the portrait.
    expect(screen.getByText("your_representative")).toBeInTheDocument()
    expect(screen.getByLabelText("your_representative")).toBeInTheDocument()
    expect(screen.queryByText("14th Norfolk")).not.toBeInTheDocument()
    expect(screen.getByText("Third Essex")).toBeInTheDocument()
  })

  it("lists every conference in the rail with the current one marked", () => {
    const { container } = render(<ConferenceDetails {...props} />)
    const other = 'a[href="/conferences/194/data-privacy"]'
    expect(container.querySelectorAll(other)).toHaveLength(1)
    expect(container.querySelector('a[aria-current="page"]')).toHaveTextContent(
      "Phone-Free Schools"
    )
    // The phone picker opens the same list from the title.
    fireEvent.click(screen.getByLabelText("pick_conference"))
    expect(container.querySelectorAll(other)).toHaveLength(2)
  })

  it("lights a district when a conferee is pointed at", () => {
    const { container } = render(<ConferenceDetails {...props} />)
    const peisch = screen.getByRole("button", { name: /Peisch,/ })
    fireEvent.pointerEnter(peisch.parentElement!)
    expect(peisch).toHaveAttribute("aria-pressed", "true")
    const cell = container.querySelector(
      'polygon[aria-label="A. Peisch"][aria-pressed="true"]'
    )
    // Painted by party, and painted inline so the shared polygon rule in the
    // stylesheet cannot cover it; the other lit seats sit back.
    expect(cell).toHaveStyle({ fill: "#4682d5", fillOpacity: 1 })
    expect(
      container.querySelector('polygon[aria-label="D. Vieira"]')
    ).toHaveStyle({ fill: "#b53333", fillOpacity: 0.45 })
  })

  describe("conferee names", () => {
    afterEach(() => {
      mockLegislators = false
    })

    it("never nests a link in a button", () => {
      const { container } = render(<ConferenceDetails {...props} />)
      expect(container.querySelector("button a, a button")).toBeNull()
    })

    it("sends the name to malegislature.gov as an external link", () => {
      render(<ConferenceDetails {...props} />)
      const name = screen.getByText("A. Peisch").closest("a")!
      expect(name).toHaveAttribute(
        "href",
        expect.stringMatching(
          /^https:\/\/malegislature\.gov\/Legislators\/Profile\//
        )
      )
      expect(name).toHaveAttribute("target", "_blank")
    })

    it("keeps the name in the app when legislator pages are on", () => {
      mockLegislators = true
      render(<ConferenceDetails {...props} />)
      const name = screen.getByText("A. Peisch").closest("a")!
      expect(name.getAttribute("href")).toMatch(/^\/legislators\/194\//)
      expect(name).not.toHaveAttribute("target")
    })
  })

  it("lists testimony under its stance, with the stored counts", () => {
    render(<ConferenceDetails {...props} />)

    expect(mockListing).toHaveBeenCalledWith({
      court: 194,
      conferenceId: "student-learning-and-mental-health"
    })
    const senate = screen.getByRole("region", {
      name: "Pass the Senate version"
    })
    expect(senate).toHaveTextContent("2")
    expect(senate).toHaveTextContent("Ada")
    expect(senate).toHaveTextContent("Edsger")
    expect(senate).not.toHaveTextContent("Grace")
    expect(
      screen.getByRole("region", { name: "Pass something" })
    ).toHaveTextContent("Grace")
    expect(
      screen.getByRole("region", { name: "Pass nothing" })
    ).toHaveTextContent("testimony_none")
    expect(screen.getByText("testimony_add")).toHaveAttribute(
      "href",
      "/submit-testimony?billId=S2581&court=194&step=position&conferenceId=student-learning-and-mental-health"
    )
  })

  it("keeps the testimony but stops asking for more once the committee is done", () => {
    render(
      <ConferenceDetails
        {...props}
        testimony={{ ...props.testimony, status: "reportFiled" }}
      />
    )

    expect(screen.queryByText("testimony_add")).not.toBeInTheDocument()
    expect(screen.getByText("testimony_closed")).toBeInTheDocument()
    expect(
      screen.getByRole("region", { name: "Pass the Senate version" })
    ).toHaveTextContent("Ada")
  })
})
