/**
 * Poll a Firestore document until it satisfies a predicate.
 *
 * One implementation, shared across the package boundary: test/pds.ts wraps it
 * for the read-half smoke test, and the publisher's scripts/e2e-drive.ts imports
 * it directly for the publish loop (infra/atproto/publish-check.sh). Both were
 * near-identical loops with the same 1-2s cadence and the same deadline, and
 * both are the last thing a harness failure prints — so a diagnostic improved in
 * one should not have to be re-typed in the other.
 *
 * NO imports, deliberately. The two packages are separate Firebase deploy units
 * with separate lockfiles, and each one's CI job installs only itself; a leaf
 * with zero dependencies can be imported from either side without dragging
 * firebase-admin, or an install, along with it. Hence the structural DocLike
 * rather than firebase-admin's DocumentReference.
 *
 * Firestore's onSnapshot would be tidier than polling, but the emulator holds
 * the listener open past the deadline; polling keeps the timeout honest.
 */

export interface DocLike<D> {
  readonly path: string
  get(): Promise<{ data(): D | undefined }>
}

export interface WaitOptions {
  timeoutMs: number
  /** Printed on timeout, after the generic diagnosis. Say what to check. */
  hint: string
  /** What is being waited FOR, named in the progress line and the timeout.
   * Omit to identify the document by path alone. */
  label?: string
}

export async function waitForDoc<D>(
  ref: DocLike<D>,
  matches: (data: D) => boolean,
  { timeoutMs, hint, label }: WaitOptions
): Promise<D> {
  const deadline = Date.now() + timeoutMs
  const what = label ? `${label} at ${ref.path}` : ref.path
  process.stdout.write(`waiting for ${what} `)
  for (;;) {
    const data = (await ref.get()).data()
    if (data && matches(data)) {
      process.stdout.write(" arrived\n")
      return data
    }
    if (Date.now() >= deadline) {
      process.stdout.write(" TIMED OUT\n")
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${what}\n` +
          // Which of these two it is decides where to look next, and the
          // difference is invisible from the outside: a stale document that
          // never updated looks exactly like a delivery that never happened.
          (data
            ? "a document IS present but does not match -- an older run left it there; that is not a pass\n"
            : "no document at that path at all\n") +
          hint
      )
    }
    process.stdout.write(".")
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}
