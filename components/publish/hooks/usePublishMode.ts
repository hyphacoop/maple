import { getPublishMode } from "../mode"
import { usePublishState } from "./usePublishState"

export const usePublishMode = () => {
  const { ballotQuestionId, conferenceId } = usePublishState()
  return getPublishMode(ballotQuestionId, conferenceId)
}
