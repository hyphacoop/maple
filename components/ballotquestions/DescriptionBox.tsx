export const DescriptionBox = ({ description }: { description: string }) => {
  return (
    <div className="ballot-question-accent-surface rounded-4 px-4 py-4">
      <div className="d-flex align-items-start gap-3">
        <div
          className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
          style={{
            width: "2.5rem",
            height: "2.5rem",
            backgroundColor: "var(--bq-accent-fill)",
            color: "var(--bs-secondary)",
            fontWeight: 700
          }}
          aria-hidden="true"
        >
          i
        </div>
        <div>
          <h6 className="mb-2 fw-semibold text-secondary">
            What this question would do
          </h6>
          <p
            className="mb-0"
            style={{
              color: "#4b5563",
              fontSize: "0.96rem",
              lineHeight: 1.6,
              maxWidth: "62ch"
            }}
          >
            {description}
          </p>
        </div>
      </div>
    </div>
  )
}
