/**
 * Record key conventions. These live here and nowhere else.
 *
 * The lexicons declare `"key": "any"` and tell consumers to treat the rkey as
 * opaque, precisely so these can change without becoming a Firestore migration.
 * Nothing may parse them back.
 *
 * Their own module, with NO imports, because the consumer's test event builders
 * (services/atproto-consumer/test/events.ts) import them across the package
 * boundary to build events that look like the real ones. That import is safe
 * only because this file drags nothing with it: the two packages are separate
 * Firebase deploy units with separate lockfiles, `firebase deploy` packs only
 * the source directory, and each package's CI job installs only itself. A leaf
 * with zero dependencies satisfies all three; src/records.ts, which imports
 * firebase-admin and the generated lexicons, would satisfy none.
 *
 * Why unify at all, when the consumer never parses an rkey (its
 * src/records.ts derives every document id from record FIELDS, deliberately, so
 * that a rename here is not a Firestore migration): so that the harness's smoke
 * test seeds at the rkey a real publisher would write. Spelled separately, the
 * two agreed only by coincidence, and a change here would have left the smoke
 * test green against an rkey nothing in production produces — that is, no longer
 * evidence about the real path, which is the one thing it exists to be.
 */

export const billRkey = (court: number, billId: string) => `${court}-${billId}`
export const hearingRkey = (hearingId: number) => String(hearingId)
