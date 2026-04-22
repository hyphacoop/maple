import type { ReactNode } from "react"
import { BallotQuestion } from "../db"
import { QuestionTooltip } from "../tooltip"

type CampaignFinanceEntry = {
  committee: string
  cashRaised: number
  spent: number
  inKind: number
}

export const CampaignFinancialsTab = ({
  ballotQuestion
}: {
  ballotQuestion: BallotQuestion
}) => {
  const support = ballotQuestion.campaignFinancials?.support ?? []
  const oppose = ballotQuestion.campaignFinancials?.oppose ?? []

  return (
    <div className="d-grid gap-4">
      <SectionCard>
        <h2 className="h4 mb-1 text-secondary d-flex align-items-center gap-1">
          Campaign Financials
          <QuestionTooltip text="Committee receipts and expenditures are filed with the Office of Campaign and Political Finance." />
        </h2>
        <p className="text-body-secondary small mb-0">
          Committee receipts and expenditures from the 2024 ballot question
          filings.{" "}
          <a
            href="https://www.ocpf.us/Reports/ballotquestionreports"
            target="_blank"
            rel="noopener noreferrer"
          >
            View source reports
          </a>
        </p>
      </SectionCard>

      {support.length > 0 && (
        <SectionCard>
          <div className="maple-eyebrow mb-3">Support</div>
          <div className="d-grid gap-3">
            {support.map(entry => (
              <FinanceCard key={entry.committee} entry={entry} />
            ))}
          </div>
        </SectionCard>
      )}

      {oppose.length > 0 && (
        <SectionCard>
          <div className="maple-eyebrow mb-3">Oppose</div>
          <div className="d-grid gap-3">
            {oppose.map(entry => (
              <FinanceCard key={entry.committee} entry={entry} />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

const SectionCard = ({ children }: { children: ReactNode }) => (
  <section className="maple-surface rounded-4 p-4">{children}</section>
)

const FinanceCard = ({ entry }: { entry: CampaignFinanceEntry }) => (
  <div className="maple-muted-surface rounded-4 p-3 p-lg-4">
    <div className="fw-semibold text-dark mb-3">{entry.committee}</div>
    <div className="row g-3">
      <Metric label="Cash raised" value={formatMoney(entry.cashRaised)} />
      <Metric label="Cash spent" value={formatMoney(entry.spent)} />
      <Metric
        label="Non-cash donations raised"
        value={formatMoney(entry.inKind)}
      />
      <Metric
        label="Total cash value of campaign"
        value={formatMoney(entry.cashRaised + entry.inKind)}
        tooltip="Cash raised plus non-cash donations"
      />
    </div>
  </div>
)

const Metric = ({
  label,
  value,
  tooltip
}: {
  label: string
  value: string
  tooltip?: string
}) => (
  <div className="col-12 col-md-3">
    <div className="maple-eyebrow mb-1 d-flex align-items-center gap-1">
      {label}
      {tooltip && <QuestionTooltip text={tooltip} />}
    </div>
    <div className="fw-semibold text-dark">{value}</div>
  </div>
)

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value)
