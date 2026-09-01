import { isDidString, type DidString } from "@atproto/lex"
import {
  Jetstream,
  websocketTransport,
  type JetstreamConsumer,
  type LexIndexer
} from "@bsky/jetstream"
import { FirestoreCursorStore, cursorDocPath } from "./cursor-store.js"
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

/**
 * Repos to accept records from, comma-separated. Unset means no DID filter:
 * the NSID filter alone is already safe on the public network, where nothing
 * emits org.mapletestimony.*. A filter that defaulted to matching NOTHING
 * would instead make a misconfigured consumer look exactly like a healthy
 * idle one, which is the failure mode the local harness exists to catch.
 * Deployments pin it to MAPLE's own DID.
 */
function parseDids(raw: string): DidString[] {
  const dids = raw
    .split(",")
    .map(d => d.trim())
    .filter(Boolean)
  // Validate rather than cast. A typo'd DID — a handle, a stray quote, a
  // trailing character — is accepted by the server as a filter matching
  // nothing, which produces exactly the healthy-looking idle consumer this
  // setting's default was chosen to avoid. Fail at startup instead.
  const invalid = dids.filter(d => !isDidString(d))
  if (invalid.length)
    throw new Error(`MAPLE_DIDS contains invalid DIDs: ${invalid.join(", ")}`)
  return dids as DidString[]
}

const MAPLE_DIDS = parseDids(process.env.MAPLE_DIDS ?? "")

/** The runner reads `collections`/`dids`/`kinds` off the consumer to build the
 * server-side filter; LexIndexer declares the first two but has no place to
 * put DIDs, so the filter is declared at this seam. Enumerating the interface
 * by hand is the cost: a future fourth declaration would be honoured when
 * MAPLE_DIDS is unset and silently dropped when it is set. Pushing `dids` into
 * LexIndexerOpts upstream would retire this wrapper. */
function withDidFilter(
  indexer: LexIndexer,
  dids: DidString[]
): JetstreamConsumer {
  if (dids.length === 0) return indexer
  return {
    collections: indexer.collections,
    kinds: indexer.kinds,
    dids,
    run: (stream, ctx) => indexer.run(stream, ctx)
  }
}

async function main() {
  const db = initFirestore(PROJECT_ID)

  console.log(
    `[consumer] jetstream=${JETSTREAM_URL} project=${PROJECT_ID} firestore=${
      process.env.FIRESTORE_EMULATOR_HOST ?? "LIVE"
    } cursor=${cursorDocPath(JETSTREAM_URL)}`
  )

  const cursor = FirestoreCursorStore.forJetstream(db, JETSTREAM_URL)
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
    await jetstream.runner(withDidFilter(indexer, MAPLE_DIDS)).live({
      cursor,
      signal: abort.signal,
      onError: err => console.warn(`[consumer] recoverable: ${err.message}`),
      onInfo: info =>
        console.warn(
          `[consumer] server advisory ${info.name}: ${info.message ?? ""}`
        ),
      // The line that means "attached to the tail", and the one every harness
      // waiter greps for (lib.sh's CONSUMER_READY). It has to come from the
      // transport: the cursor decision above is logged BEFORE .live() opens the
      // websocket, so waiting on that resumes roughly a second early, and on a
      // cursorless start anything published in that window is not late, it is
      // gone. onConnect fires per connection, so the line stays honest across a
      // reconnect too.
      liveTransport: websocketTransport({
        onConnect: () =>
          console.log(`[consumer] subscribed to ${JETSTREAM_URL}`)
      })
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
