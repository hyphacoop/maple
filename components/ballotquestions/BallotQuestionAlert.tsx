import ReactMarkdown from "react-markdown"
import { QuestionTooltip } from "../tooltip"

export function BallotQuestionAlert({
  alertFlag,
  alertTip
}: {
  alertFlag: string | null
  alertTip?: string | null
}) {
  if (!alertFlag) return null

  return (
    <aside
      className="ballot-question-alert d-flex align-items-center gap-3 rounded-4 px-3 py-3"
      aria-label="Important ballot question notice"
    >
      <span className="ballot-question-alert-icon" aria-hidden="true">
        !
      </span>
      <div className="ballot-question-alert-content d-flex align-items-center gap-2 flex-wrap">
        <ReactMarkdown
          components={{
            a: ({ node: _node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
            p: ({ node: _node, ...props }) => <span {...props} />
          }}
        >
          {alertFlag}
        </ReactMarkdown>
        {alertTip ? <QuestionTooltip text={alertTip} /> : null}
      </div>
    </aside>
  )
}
