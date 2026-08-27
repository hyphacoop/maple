import type { DocumentReference, Firestore } from "firebase-admin/firestore"
import type { CursorStore } from "@bsky/jetstream"

/**
 * The cursor document for one jetstream host.
 *
 * A v2 cursor is a `seq` in a single host's sequence space — it means something
 * different on another host, and nothing at all on a v1 jetstream. Keying the
 * document by host is what stops a run against one jetstream from resuming at
 * an offset another one wrote. Callers pass their configured URL rather than
 * composing a path, so the keying rule lives here with the invariant it serves.
 *
 * The harness (infra/atproto/recovery.sh) reads this path back out of the
 * consumer's startup log rather than re-deriving it, so this stays the only
 * implementation.
 */
export const cursorDocPath = (jetstreamUrl: string): string =>
  `atpJetstreamMeta/cursor-${new URL(jetstreamUrl).host
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()}`

/**
 * Durable cursor for the Jetstream runner, persisted as a single Firestore
 * document, one per jetstream host (see cursorDocPath).
 *
 * The runner calls save() with its contiguous acked watermark after
 * essentially every event, so writes are coalesced to at most one per
 * second. Each save() promise resolves only after its seq (or a newer one)
 * has been written — the runner awaits the last save() during its shutdown
 * flush, so the final cursor always lands.
 */
export class FirestoreCursorStore implements CursorStore {
  private readonly ref: DocumentReference
  private firstLoad?: Promise<number | undefined>
  private nextSeq = 0
  private pendingSave?: Promise<void>

  /** Prefer forJetstream(); the raw path exists for tests. */
  constructor(
    db: Firestore,
    docPath: string,
    private readonly coalesceMs = 1000
  ) {
    this.ref = db.doc(docPath)
  }

  static forJetstream(db: Firestore, jetstreamUrl: string) {
    return new FirestoreCursorStore(db, cursorDocPath(jetstreamUrl))
  }

  load(): Promise<number | undefined> {
    return (this.firstLoad ??= this.ref.get().then(snap => {
      const seq = snap.get("seq")
      return typeof seq === "number" ? seq : undefined
    }))
  }

  save(seq: number): Promise<void> {
    this.nextSeq = seq
    return (this.pendingSave ??= this.writeSoon())
  }

  private async writeSoon(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.coalesceMs))
    this.pendingSave = undefined
    await this.ref.set({ seq: this.nextSeq })
  }
}
