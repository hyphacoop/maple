import { logger } from "firebase-functions"
import { onDocumentWritten } from "firebase-functions/v2/firestore"
import type { PdsClient } from "./agent.js"
import { pdsPassword, readConfig } from "./config.js"
import { initFirestore } from "./db.js"
import { publishDocument, type PublishResult } from "./publish.js"
import { billRecord, hearingRecord, type RecordType } from "./records.js"

const db = initFirestore()

/** Cached across invocations on a warm instance: AtpAgent refreshes its own
 * access token, and logging in per event would burn the PDS's createSession
 * rate limit for no benefit. */
let client: Promise<PdsClient> | undefined

async function connect(): Promise<PdsClient> {
  const config = readConfig()
  if (!config) throw new Error("atproto publisher is not configured")
  // Imported here rather than at module scope so a cold instance that only
  // ever sees unchanged documents — the overwhelmingly common case, since the
  // scraper rewrites all ~8000 bills daily — never pays the ~300ms of loading
  // @atproto/api.
  client ??= import("./agent.js")
    .then(m => m.PdsClient.login(config))
    .catch(e => {
      // Do not cache a failed login: the next event should retry rather than
      // inherit a rejected promise for the life of the instance.
      client = undefined
      throw e
    })
  return client
}

function report(kind: string, id: string, result: PublishResult) {
  switch (result.status) {
    case "published":
      logger.info(`published ${kind} ${id}`, { cid: result.cid })
      return
    case "unchanged":
      logger.debug(`${kind} ${id} unchanged, not republished`)
      return
    case "invalid":
      logger.error(`${kind} ${id} failed lexicon validation`, {
        message: result.message
      })
      return
    case "unmappable":
      logger.warn(`${kind} ${id} could not be mapped`, {
        message: result.message
      })
  }
}

let warnedUnconfigured = false

/**
 * One trigger per record type, built from the table in records.ts. A third
 * record type should be another call here, not another copy of this body.
 *
 * `retry: false` matters: a transient PDS outage must not queue thousands of
 * redelivered events. The next scrape writes the document again, and the hash
 * comparison makes that cheap.
 */
function publishTrigger<D>(type: RecordType<D>, id: (params: any) => string) {
  return onDocumentWritten(
    { document: type.document, secrets: [pdsPassword], retry: false },
    async event => {
      const doc = event.data?.after?.data() as D | undefined
      // Deleting records for documents that vanish upstream is out of scope
      //; a delete leaves the record standing rather than silently
      // dropping it. `accepts` screens out the other document types that share
      // a collection — /events also holds sessions and special events.
      if (!doc || !type.accepts(doc)) return

      // Checked before any PDS work: the codebase can deploy before the PDS exists
      // stands up a dev PDS, and every trigger should then no-op loudly-once
      // rather than throw on each of ~8000 daily events.
      if (!readConfig()) {
        if (!warnedUnconfigured) {
          warnedUnconfigured = true
          logger.warn(
            "atproto publisher is not configured (ATP_PDS_URL / " +
              "ATP_PDS_HANDLE / ATP_PDS_PASSWORD); publishing is disabled"
          )
        }
        return
      }

      const kind = type.nsid.split(".").pop()!
      report(
        kind,
        id(event.params),
        await publishDocument(db, connect, type, doc)
      )
    }
  )
}

export const publishBill = publishTrigger(
  billRecord,
  p => `${p.court}/${p.billId}`
)

export const publishHearing = publishTrigger(hearingRecord, p =>
  String(p.eventId)
)
