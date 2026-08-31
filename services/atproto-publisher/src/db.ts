import { getApps, initializeApp } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"

/**
 * Shared Firestore bootstrap for the publisher and its tests, mirroring
 * services/atproto-consumer/src/db.ts so the two cannot drift.
 *
 * settings() throws if the database has already been used, hence the guard:
 * a test process importing several modules would otherwise re-initialise it.
 */
export function initFirestore(projectId?: string): Firestore {
  if (getApps().length === 0) {
    initializeApp(projectId ? { projectId } : undefined)
  }
  const db = getFirestore()
  try {
    db.settings({ ignoreUndefinedProperties: true })
  } catch {
    // settings() already applied earlier in this process
  }
  return db
}
