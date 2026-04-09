import "@testing-library/jest-dom"
import { render, screen } from "@testing-library/react"
import { BillTitle } from "./BillTitle"

const mockUseCurrentTestimonyDetails = jest.fn()

jest.mock("./testimonyDetailSlice", () => ({
  useCurrentTestimonyDetails: () => mockUseCurrentTestimonyDetails()
}))

const bill = {
  id: "H5005",
  court: 194,
  content: {
    BillNumber: "H5005",
    Title: "An Act relative to a petition title"
  }
} as any

describe("BillTitle", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("links regular testimony to the bill", () => {
    mockUseCurrentTestimonyDetails.mockReturnValue({
      bill,
      ballotQuestion: null,
      revision: { ballotQuestionId: null }
    })

    const { container } = render(<BillTitle />)

    const link = screen.getByRole("link", {
      name: "H.5005: An Act relative to a petition title"
    })
    expect(link).toHaveAttribute("href", "/bills/194/H5005")
    expect(container.querySelector("h3")).toHaveTextContent(
      "H.5005: An Act relative to a petition title"
    )
  })

  it("links ballot question testimony to the ballot question", () => {
    mockUseCurrentTestimonyDetails.mockReturnValue({
      bill,
      ballotQuestion: {
        id: "25-14",
        title: "Nature for All"
      },
      revision: { ballotQuestionId: "25-14" }
    })

    const { container } = render(<BillTitle />)

    const link = screen.getByRole("link", {
      name: "Ballot Question 25-14: Nature for All"
    })
    expect(link).toHaveAttribute("href", "/ballotQuestions/25-14")
    expect(container.querySelector("h3")).toHaveTextContent(
      "Ballot Question 25-14: Nature for All"
    )
  })
})
