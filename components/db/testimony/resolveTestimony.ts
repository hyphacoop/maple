import {
  collection,
  collectionGroup,
  getDocs,
  query,
  where
} from "firebase/firestore"
import { first } from "lodash"
import { firestore } from "../../firebase"
import {
  matchesTestimonyScope,
  TestimonyScope
} from "functions/src/testimony/scope"

/** Resolves the current draft and publication refs for a given user and bill. */
export const resolveBillTestimony = async (
  uid: string,
  court: number,
  billId: string,
  scope?: TestimonyScope
) => {
  const [published, draft] = await Promise.all([
    getPublishedTestimony(uid, court, billId, scope),
    getDraftTestimony(uid, billId, scope)
  ])
  return {
    draft: first(draft)?.ref,
    publication: first(published)?.ref
  }
}

function getPublishedTestimony(
  uid: string,
  court: number,
  billId: string,
  scope?: TestimonyScope
) {
  return getDocs(
    query(
      collectionGroup(firestore, "publishedTestimony"),
      where("authorUid", "==", uid),
      where("billId", "==", billId),
      where("court", "==", court)
    )
  ).then(snapshot =>
    snapshot.docs.filter(doc => matchesTestimonyScope(doc.data(), scope))
  )
}

function getDraftTestimony(
  uid: string,
  billId: string,
  scope?: TestimonyScope
) {
  return getDocs(
    query(
      collection(firestore, `users/${uid}/draftTestimony`),
      where("billId", "==", billId)
    )
  ).then(snapshot =>
    snapshot.docs.filter(doc => matchesTestimonyScope(doc.data(), scope))
  )
}
