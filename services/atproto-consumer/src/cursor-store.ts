import type { DocumentReference, Firestore } from "firebase-admin/firestore"
import type { CursorStore } from "@bsky/jetstream"

/**
 * Durable cursor for the Jetstream runner, persisted as a single Firestore
 * document. v2 cursors are `seq` values and are not portable to a v1
 * jetstream host.
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

  constructor(
    db: Firestore,
    docPath = "atpJetstreamMeta/cursor",
    private readonly coalesceMs = 1000
  ) {
    this.ref = db.doc(docPath)
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
