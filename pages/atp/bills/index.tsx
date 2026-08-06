import { GetServerSideProps } from "next"
import { useTranslation } from "next-i18next"
import { serverSideTranslations } from "next-i18next/serverSideTranslations"
import { listAtpBills, mapleDid } from "components/atproto/api"
import { AtpSetupAlert } from "components/atproto/AtpSetupAlert"
import { Container } from "components/bootstrap"
import { Card as MapleCard } from "components/Card"
import { ListItem } from "components/Card/CardListItem"
import { Bill } from "components/db"
import { formatBillId } from "components/formatting"
import { Internal } from "components/links"
import { createPage } from "components/page"

const AtpBillsPage = ({ bills }: { bills: Bill[] | null }) => {
  const { t } = useTranslation("auth")

  if (bills === null) return <AtpSetupAlert />

  return (
    <Container className="mt-3 mb-3">
      {bills.length === 0 ? (
        <p>{t("atpNoBills")}</p>
      ) : (
        <MapleCard
          header={t("atpBillsHeading")}
          initialRowCount={bills.length}
          items={bills.map(bill => (
            <ListItem
              key={`${bill.court}-${bill.id}`}
              billName={formatBillId(bill.id)}
              billDescription={bill.content.Title}
              element={
                <Internal
                  className="text-white text-nowrap"
                  href={`/atp/bills/${bill.court}/${bill.id}`}
                >
                  {t("atpViewBill")}
                </Internal>
              }
            />
          ))}
        />
      )}
    </Container>
  )
}

export default createPage({
  Page: AtpBillsPage
})

export const getServerSideProps: GetServerSideProps = async ctx => {
  const locale = ctx.locale ?? ctx.defaultLocale ?? "en"
  const translations = await serverSideTranslations(locale, [
    "auth",
    "common",
    "footer"
  ])

  if (!mapleDid) return { props: { bills: null, ...translations } }

  const bills = await listAtpBills(mapleDid)
  return {
    props: {
      bills:
        bills &&
        JSON.parse(
          JSON.stringify(
            [...bills].sort((a, b) => a.id.localeCompare(b.id, "en"))
          )
        ),
      ...translations
    }
  }
}
