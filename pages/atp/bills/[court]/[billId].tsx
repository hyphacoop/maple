import { GetServerSideProps } from "next"
import { serverSideTranslations } from "next-i18next/serverSideTranslations"
import { z } from "zod"
import { getAtpBill, mapleDid } from "components/atproto/api"
import { AtpBillDetails } from "components/atproto/AtpBillDetails"
import { AtpSetupAlert } from "components/atproto/AtpSetupAlert"
import { Bill } from "components/db"
import { createPage } from "components/page"

const Query = z.object({ court: z.coerce.number(), billId: z.string() })

export default createPage<{ bill: Bill | null }>({
  titleI18nKey: "titles.bill",
  Page: ({ bill }) =>
    bill ? <AtpBillDetails bill={bill} /> : <AtpSetupAlert />
})

export const getServerSideProps: GetServerSideProps = async ctx => {
  const locale = ctx.locale ?? ctx.defaultLocale ?? "en"
  const translations = await serverSideTranslations(locale, [
    "auth",
    "common",
    "footer",
    "testimony"
  ])

  const query = Query.safeParse(ctx.query)
  if (!query.success) return { notFound: true }

  if (!mapleDid) return { props: { bill: null, ...translations } }

  const bill = await getAtpBill(mapleDid, query.data.court, query.data.billId)
  if (!bill) return { notFound: true }

  return {
    props: { bill: JSON.parse(JSON.stringify(bill)), ...translations }
  }
}
