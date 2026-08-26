import { initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { Jetstream, LexIndexer } from "@bsky/jetstream"
import { app } from "@bsky/sdk/lexicons"
import { FirestoreCursorStore } from "./cursor-store.js"
import { toProfileDoc } from "./mapper.js"

// This slice only ever writes to a local Firestore emulator. Default
// FIRESTORE_EMULATOR_HOST before firebase-admin initializes so an unset
// environment can't silently point at a real project; writing anywhere else
// requires the explicit ALLOW_LIVE_FIRESTORE=true opt-out.
if (
  !process.env.FIRESTORE_EMULATOR_HOST &&
  process.env.ALLOW_LIVE_FIRESTORE !== "true"
) {
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080"
}

const JETSTREAM_URL =
  process.env.JETSTREAM_URL ?? "https://jetstream.us-east.bsky.network"
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "demo-dtp"

async function main() {
  initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore()
  db.settings({ ignoreUndefinedProperties: true })
  const profiles = db.collection("atpJetstreamProfiles")

  console.log(
    `[consumer] jetstream=${JETSTREAM_URL} project=${PROJECT_ID} firestore=${
      process.env.FIRESTORE_EMULATOR_HOST ?? "LIVE"
    }`
  )

  const cursor = new FirestoreCursorStore(db)
  const resumeSeq = await cursor.load()
  console.log(
    resumeSeq === undefined
      ? "[consumer] no stored cursor, starting from the live tip"
      : `[consumer] resuming from stored cursor seq=${resumeSeq}`
  )

  const stats = { creates: 0, updates: 0, deletes: 0, invalid: 0 }
  const logStats = (tag: string) =>
    console.log(
      `[consumer] ${tag} creates=${stats.creates} updates=${stats.updates} deletes=${stats.deletes} invalid=${stats.invalid}`
    )

  const indexer = new LexIndexer()
    .commit(app.bsky.actor.profile, {
      put: async e => {
        if (e.operation === "update") {
          stats.updates++
          return
        }
        stats.creates++
        const doc = toProfileDoc(e, new Date().toISOString())
        await profiles.doc(e.did).set(doc)
        console.log(
          `[consumer] indexed new profile ${e.did}${
            doc.displayName ? ` (${doc.displayName})` : ""
          }`
        )
      },
      del: async e => {
        stats.deletes++
        await profiles.doc(e.did).delete()
      }
    })
    .onValidationError(e => {
      stats.invalid++
      console.warn(
        `[consumer] skipped schema-invalid record ${e.uri}: ${e.error.message}`
      )
    })

  setInterval(() => logStats("stats"), 30_000).unref()

  const abort = new AbortController()
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => {
      console.log(`[consumer] received ${sig}, shutting down`)
      abort.abort()
    })

  const jetstream = new Jetstream(JETSTREAM_URL)
  try {
    await jetstream.runner(indexer).live({
      cursor,
      signal: abort.signal,
      onError: err => console.warn(`[consumer] recoverable: ${err.message}`),
      onInfo: info =>
        console.warn(
          `[consumer] server advisory ${info.name}: ${info.message ?? ""}`
        )
    })
  } catch (err) {
    // The underlying ws-client raises AbortError on signal abort, so a
    // requested shutdown surfaces here rather than as a clean return.
    if (!abort.signal.aborted) throw err
  }
  logStats("stopped cleanly:")
}

main().catch(err => {
  console.error("[consumer] fatal:", err)
  process.exit(1)
})
