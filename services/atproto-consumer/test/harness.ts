import { randomUUID } from "node:crypto"
import type { Firestore } from "firebase-admin/firestore"
import type { EventBatch, LexIndexer, RawEvent } from "@bsky/jetstream"
import { initFirestore } from "../src/db.js"
import { batch } from "./events.js"

/**
 * Emulator-only Firestore handle: the emulator default mirrors index.ts's
 * safety guard so tests can never touch a real project, and the bootstrap is
 * the production one so its settings can't drift from the deployed consumer.
 */
export function testDb(): Firestore {
  process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080"
  return initFirestore("demo-dtp")
}

/** Unique per-test namespace: parallel-safe against a shared emulator, no teardown. */
export const uniqueName = (prefix: string) => `${prefix}-${randomUUID()}`

export interface RunEventsOpts {
  /** Events per EventBatch; default = all in one batch. */
  batchSize?: number
  /** Hang guard only — cannot fire on a healthy finite run. */
  timeoutMs?: number
}

/**
 * Drives the real indexer through a finite stream, exactly as the Jetstream
 * runner would. run() resolves when the iterable ends and rejects on the
 * first handler error; acks fire only for handled (or skipped) events.
 */
export async function runEvents(
  indexer: LexIndexer,
  events: RawEvent[],
  opts: RunEventsOpts = {}
): Promise<{ acked: number[] }> {
  const acked: number[] = []
  const size = opts.batchSize ?? events.length
  async function* stream(): AsyncGenerator<EventBatch<RawEvent>> {
    for (let i = 0; i < events.length; i += size) {
      yield batch(events.slice(i, i + size))
    }
  }
  await indexer.run(stream(), {
    ack: evt => acked.push(evt.seq),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000)
  })
  return { acked }
}
