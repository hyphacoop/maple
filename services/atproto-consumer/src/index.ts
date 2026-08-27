import { Jetstream } from "@bsky/jetstream"
import { FirestoreCursorStore } from "./cursor-store.js"
import { initFirestore } from "./db.js"
import { buildIndexer } from "./indexer.js"

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
  const db = initFirestore(PROJECT_ID)

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

  const { indexer, stats } = buildIndexer(db)
  const logStats = (tag: string) =>
    console.log(
      `[consumer] ${tag} creates=${stats.creates} updates=${stats.updates} deletes=${stats.deletes} invalid=${stats.invalid}`
    )

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
