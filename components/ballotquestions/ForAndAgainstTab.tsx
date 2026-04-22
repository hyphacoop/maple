import type { ReactNode } from "react"
import { BallotQuestion } from "../db"

export const ForAndAgainstTab = ({
  ballotQuestion
}: {
  ballotQuestion: BallotQuestion
}) => {
  return (
    <div className="d-grid gap-4">
      <SectionCard>
        <div className="d-flex align-items-start gap-3 mb-0">
          <div
            className="maple-icon-chip rounded-4 d-flex align-items-center justify-content-center flex-shrink-0"
            style={{
              width: "3rem",
              height: "3rem"
            }}
          >
            <BalanceGlyph />
          </div>
          <div>
            <h2 className="h4 mb-1 text-secondary">Arguments</h2>
            <p className="text-body-secondary small mb-0 lh-lg">
              As provided by law, the 150-word arguments are written by
              proponents and opponents of each question, and reflect their
              opinions. The Commonwealth of Massachusetts does not endorse these
              arguments, and does not certify the truth or accuracy of any
              statement made in these arguments. The names of the individuals
              and organizations who wrote each argument, and any written
              comments by others about each argument, are on file in the Office
              of the Secretary of the Commonwealth.
            </p>
          </div>
        </div>
      </SectionCard>

      {ballotQuestion.inFavor && (
        <SectionCard>
          <h3 className="h5 mb-3 text-dark">Argument in favor</h3>
          {ballotQuestion.campaignFinancials?.support &&
            ballotQuestion.campaignFinancials.support.length > 0 && (
              <div className="mb-3">
                {ballotQuestion.campaignFinancials.support.map(entry => (
                  <div
                    key={entry.committee}
                    className="maple-eyebrow small mb-2"
                  >
                    {entry.committee}
                  </div>
                ))}
              </div>
            )}
          <div
            className="maple-muted-surface rounded-4 px-4 py-4 lh-lg"
            style={{ whiteSpace: "pre-wrap" }}
          >
            {ballotQuestion.inFavor}
          </div>
        </SectionCard>
      )}

      {ballotQuestion.against && (
        <SectionCard>
          <h3 className="h5 mb-3 text-dark">Argument against</h3>
          {ballotQuestion.campaignFinancials?.oppose &&
            ballotQuestion.campaignFinancials.oppose.length > 0 && (
              <div className="mb-3">
                {ballotQuestion.campaignFinancials.oppose.map(entry => (
                  <div
                    key={entry.committee}
                    className="maple-eyebrow small mb-2"
                  >
                    {entry.committee}
                  </div>
                ))}
              </div>
            )}
          <div
            className="maple-muted-surface rounded-4 px-4 py-4 lh-lg"
            style={{ whiteSpace: "pre-wrap" }}
          >
            {ballotQuestion.against}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

function SectionCard({ children }: { children: ReactNode }) {
  return (
    <section className="maple-surface rounded-4 px-4 py-4">{children}</section>
  )
}

function BalanceGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        display: "block",
        transform: "translateY(-1px)"
      }}
    >
      <path
        d="M4 19H20"
        stroke="var(--maple-border-accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12 3V18"
        stroke="var(--maple-border-accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle
        cx="5"
        cy="12"
        r="2.5"
        stroke="var(--maple-brand-primary)"
        strokeWidth="1.5"
        fill="var(--maple-surface-accent)"
      />
      <circle
        cx="19"
        cy="12"
        r="2.5"
        stroke="var(--maple-brand-primary)"
        strokeWidth="1.5"
        fill="var(--maple-surface-accent)"
      />
      <path
        d="M12 3L7 12"
        stroke="var(--maple-border-accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 3L17 12"
        stroke="var(--maple-border-accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
