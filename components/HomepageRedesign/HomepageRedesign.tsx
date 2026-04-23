import { useTranslation } from "next-i18next"
import Image from "react-bootstrap/Image"
import { Internal } from "components/links"
import { useCalendarEvents } from "components/HearingsScheduled/calendarEvents"
import styles from "./HomepageRedesign.module.css"

type FeatureItem = {
  icon: string
  body: string
}

type FactItem = {
  icon: string
  text: string
}

function eventUrl(type: "hearing" | "session", id: number) {
  if (type === "hearing") {
    return `https://malegislature.gov/Events/Hearings/Detail/${id}`
  }

  return `https://malegislature.gov/Events/Sessions/Detail/${id}`
}

export default function HomepageRedesign() {
  const { t } = useTranslation("homepage")
  const { loading, eventList } = useCalendarEvents()
  const facts: FactItem[] = [
    {
      icon: "/speaker-with-pen.svg",
      text: t("didYouKnow.submit")
    },
    {
      icon: "/images/clock.svg",
      text: t("didYouKnow.deadline")
    },
    {
      icon: "/open-envelope.svg",
      text: t("didYouKnow.legislators")
    }
  ]

  const features: FeatureItem[] = [
    {
      icon: "/homepage/feature-opinion.svg",
      body: t("features.research")
    },
    {
      icon: "/homepage/feature-person.svg",
      body: t("features.publish")
    },
    {
      icon: "/homepage/feature-report.svg",
      body: t("features.share")
    }
  ]

  const upcomingHearings = eventList
    .filter(event => event.type === "hearing")
    .slice(0, 4)

  return (
    <main className={styles.page}>
      <section className={styles.sectionShell}>
        <div className={styles.hero}>
          <div className={styles.heroVisual}>
            <div className={styles.heroMap} aria-hidden="true" />
            <Image
              className={styles.statehouse}
              src="/statehouse.svg"
              alt=""
              aria-hidden="true"
            />
          </div>
          <div className={styles.heroContent}>
            <h1 className={styles.heroTitle}>{t("hero.title")}</h1>
            <p className={styles.heroBody}>{t("hero.body")}</p>
            <div className={styles.heroActions}>
              <Internal href="/bills" className={styles.primaryAction}>
                {t("hero.primaryAction")}
              </Internal>
              <Internal
                href="/about/mission-and-goals"
                className={styles.secondaryAction}
              >
                {t("hero.secondaryAction")}
              </Internal>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.sectionShell}>
        <div className={styles.didYouKnow} aria-labelledby="homepage-facts">
          <h2 id="homepage-facts" className={styles.sectionTitle}>
            {t("didYouKnow.title")}
          </h2>
          <div className={styles.factGrid}>
            {facts.map(fact => (
              <article key={fact.text} className={styles.factCard}>
                <Image
                  className={styles.factIcon}
                  src={fact.icon}
                  alt=""
                  aria-hidden="true"
                />
                <p className={styles.factText}>{fact.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.explainer}>
        <div className={styles.sectionShell}>
          <div className={styles.explainerInner}>
            <div className={styles.explainerCopy}>
              <h2 className={styles.explainerTitle}>{t("explainer.title")}</h2>
              <p className={styles.explainerBody}>{t("explainer.body")}</p>
              <Internal href="/bills" className={styles.primaryAction}>
                {t("explainer.action")}
              </Internal>
            </div>
            <div className={styles.explainerVisual}>
              <Image
                className={styles.appPreview}
                src="/maple-1.png"
                alt={t("hearings.appPreviewAlt")}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.sectionShell}>
        <div className={styles.features} aria-labelledby="homepage-features">
          <h2 id="homepage-features" className={styles.sectionTitle}>
            {t("features.title")}
          </h2>
          <div className={styles.featureLayout}>
            <div className={styles.featurePreviewWrap}>
              <Image
                className={styles.featurePreview}
                src="/maple-1.png"
                alt={t("hearings.appPreviewAlt")}
              />
            </div>
            <div className={styles.featureList}>
              {features.map(feature => (
                <article key={feature.icon} className={styles.featureItem}>
                  <div className={styles.featureIconWrap}>
                    <Image
                      className={styles.featureIcon}
                      src={feature.icon}
                      alt=""
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <p className={styles.featureBody}>{feature.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.hearingsBand}>
        <div
          className={`${styles.sectionShell} ${styles.hearings}`}
          aria-labelledby="homepage-upcoming-hearings"
        >
          <div className={styles.hearingsHeader}>
            <h2
              id="homepage-upcoming-hearings"
              className={styles.hearingsTitle}
            >
              {t("hearings.title")}
            </h2>
            <Internal href="/bills" className={styles.hearingsActionDesktop}>
              {t("hearings.action")}
            </Internal>
          </div>
          {loading ? (
            <p className={styles.hearingsEmpty}>{t("hearings.loading")}</p>
          ) : upcomingHearings.length ? (
            <div className={styles.hearingGrid}>
              {upcomingHearings.map(event => (
                <article
                  key={`${event.type}-${event.id}`}
                  className={styles.hearingCard}
                >
                  <div className={styles.hearingDate}>
                    <div className={styles.hearingMonth}>{event.month}</div>
                    <div className={styles.hearingDay}>{event.date}</div>
                  </div>
                  <div className={styles.hearingBody}>
                    {event.location ? (
                      <div className={styles.hearingMeta}>{event.location}</div>
                    ) : null}
                    <a
                      href={eventUrl(event.type, event.id)}
                      className={styles.hearingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {event.name}
                    </a>
                    <p className={styles.hearingTopic}>{t("hearings.topic")}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.hearingsEmpty}>
              {t("hearingsScheduled.noEvents")}
            </p>
          )}
          <Internal href="/bills" className={styles.hearingsActionMobile}>
            {t("hearings.action")}
          </Internal>
        </div>
      </section>
    </main>
  )
}
