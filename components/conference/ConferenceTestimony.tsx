import { groupBy } from "lodash"
import { useTranslation } from "next-i18next"
import styled from "styled-components"
import { usePublishedTestimonyListing } from "../db/testimony/usePublishedTestimonyListing"
import { Internal, maple } from "../links"
import { conferencePositions, positionLabels } from "../publish/content"
import { formUrl } from "../publish/formUrl"
import { PaginationButtons } from "../table/PaginationButtons"
import { trimContent } from "../TestimonyCallout/TestimonyCallout"
import { isConferenceOpen } from "./status"
import { Card, CardTitle, DottedInternal, Eyebrow } from "./styles"
import { ConferenceTestimonyView } from "./types"

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1.25rem;

  h2 {
    margin: 0;
  }
`

const Add = styled(Internal)`
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: var(--maple-radius-pill);
  background: var(--maple-brand-primary);
  color: white;
  font-weight: 600;
  text-decoration: none;
  &:hover {
    background: var(--maple-brand-primary-strong);
    color: white;
  }
`

const Stances = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 1.5rem;
`

const Count = styled.span`
  margin-left: 0.375rem;
  color: var(--maple-text-muted);
  font-weight: 400;
`

const List = styled.ul`
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  font-size: 0.875rem;
  line-height: 1.5;

  li + li {
    margin-top: 0.75rem;
  }
`

const Quote = styled.p`
  margin: 0.125rem 0 0;
  color: var(--maple-text-muted);
`

const Empty = styled.p`
  margin: 0;
  font-size: 0.8125rem;
  color: var(--maple-text-muted);
`

/**
 * Testimony on the conference, grouped by what it asks the committee to do.
 * The counts come from the conference document; the lists are one page of
 * the newest testimony.
 */
export function ConferenceTestimony({
  court,
  conferenceId,
  testimony: { canonicalBillId, status, testimonyCount, counts }
}: {
  court: number
  conferenceId: string
  testimony: ConferenceTestimonyView
}) {
  const { t } = useTranslation("conferences")
  const { items, pagination } = usePublishedTestimonyListing({
    court,
    conferenceId
  })
  const byStance = groupBy(
    items.status === "success" ? items.result : [],
    "position"
  )

  return (
    <Card>
      <Head>
        <CardTitle>
          {t("testimony_title")}
          <Count>{t("testimony_total", { count: testimonyCount })}</Count>
        </CardTitle>
        {isConferenceOpen(status) ? (
          <Add
            href={formUrl(
              canonicalBillId,
              court,
              "position",
              undefined,
              conferenceId
            )}
          >
            {t("testimony_add")}
          </Add>
        ) : (
          <Empty>{t("testimony_closed")}</Empty>
        )}
      </Head>
      <Stances>
        {conferencePositions.map(stance => (
          <section key={stance} aria-label={positionLabels[stance]}>
            <Eyebrow>
              {positionLabels[stance]}
              <Count>{counts[stance]}</Count>
            </Eyebrow>
            {byStance[stance]?.length ? (
              <List>
                {byStance[stance].map(item => (
                  <li key={item.id}>
                    <DottedInternal
                      href={maple.testimony({ publishedId: item.id })}
                    >
                      {item.fullName}
                    </DottedInternal>
                    <Quote>{trimContent(item.content, 140)}</Quote>
                  </li>
                ))}
              </List>
            ) : (
              <Empty>{t("testimony_none")}</Empty>
            )}
          </section>
        ))}
      </Stances>
      {(pagination.hasPreviousPage || pagination.hasNextPage) && (
        <PaginationButtons pagination={pagination} />
      )}
    </Card>
  )
}
