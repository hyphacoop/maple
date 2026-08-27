import type { DocumentReference } from "firebase-admin/firestore"

/**
 * Appview-owned fields to carry across indexed writes, as field -> default.
 * The default applies when the current doc is missing or lacks the field,
 * mirroring the scraper's `current?.testimonyCount ?? 0` shape in
 * functions/src/bills/bills.ts.
 */
export type PreservedFields = Record<string, unknown>

/**
 * Write `doc` wholesale, carrying each preserved field forward from the
 * current doc. A whole-doc set — deliberately not merge:true, which would
 * keep stale record-owned fields when the upstream record drops an optional
 * field. Read-then-write is not transactional; same-record ordering is
 * guaranteed by LexIndexer's per-record-path serialization within a run.
 */
export async function setPreserving(
  ref: DocumentReference,
  doc: Record<string, unknown>,
  preserved: PreservedFields
): Promise<void> {
  const snap = await ref.get()
  const out = { ...doc }
  for (const [field, fallback] of Object.entries(preserved)) {
    const current = snap.get(field)
    out[field] = current !== undefined ? current : fallback
  }
  await ref.set(out)
}
