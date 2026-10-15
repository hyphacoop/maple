import type { BillPosition, ConferencePosition, Position } from "../db"

export const positionActions: Record<BillPosition, string> = {
  neutral: "am neutral on",
  endorse: "endorse",
  oppose: "oppose"
}

/** The conference positions in the order every view lists them. */
export const conferencePositions: readonly ConferencePosition[] = [
  "passSenateVersion",
  "passHouseVersion",
  "passSomething",
  "passNothing"
]

/** What a conference testimony asks the committee to do, after "to". */
export const conferenceActions: Record<ConferencePosition, string> = {
  passNothing: "pass nothing",
  passSomething: "pass something",
  passSenateVersion: "pass the Senate version",
  passHouseVersion: "pass the House version"
}

export const positionLabels: Record<Position, string> = {
  neutral: "Neutral",
  endorse: "Endorse",
  oppose: "Oppose",
  passNothing: "Pass nothing",
  passSomething: "Pass something",
  passSenateVersion: "Pass the Senate version",
  passHouseVersion: "Pass the House version"
}

export const calloutLabels = {
  houseChair: "Committee House Chair",
  senateChair: "Committee Senate Chair",
  yourRepresentative: "Your Representative",
  yourSenator: "Your Senator"
}
