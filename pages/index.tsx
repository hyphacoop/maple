import HomepageRedesign from "components/HomepageRedesign/HomepageRedesign"
import { createPage } from "components/page"
import { createGetStaticTranslationProps } from "components/translations"

export default createPage({
  Page: () => <HomepageRedesign />
})

export const getStaticProps = createGetStaticTranslationProps([
  "auth",
  "common",
  "homepage",
  "footer",
  "testimony"
])
