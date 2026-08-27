import { getApps, initializeApp } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"

/**
 * Shared Firestore bootstrap for the consumer and its tests.
 * ignoreUndefinedProperties is load-bearing: mapped docs carry undefined for
 * optional record fields the upstream event omits, and a whole-doc set must
 * drop them rather than reject. settings() throws if the db was already used,
 * hence the guard (idempotent re-init in multi-import test processes).
 */
export function initFirestore(projectId: string): Firestore {
  if (getApps().length === 0) initializeApp({ projectId })
  const db = getFirestore()
  try {
    db.settings({ ignoreUndefinedProperties: true })
  } catch {
    // settings() already applied earlier in this process
  }
  return db
}
