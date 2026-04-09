import { countsByPositions, Testimony } from "./types"

export type TestimonyCountFields = {
  testimonyCount: number
  endorseCount: number
  neutralCount: number
  opposeCount: number
}

/** Updates fields that track testimony counts based on changes to the user's
 * testimony. */
export function updateTestimonyCounts(
  {
    testimonyCount,
    endorseCount,
    neutralCount,
    opposeCount
  }: TestimonyCountFields,
  currentPublication?: Testimony,
  newPublication?: Testimony
): TestimonyCountFields {
  const update: TestimonyCountFields = {
    testimonyCount,
    endorseCount,
    neutralCount,
    opposeCount
  }
  if (currentPublication) {
    const oldPosition = countsByPositions[currentPublication.position]
    update[oldPosition] = Math.max(update[oldPosition] - 1, 0)
    update.testimonyCount = Math.max(update.testimonyCount - 1, 0)
  }
  if (newPublication) {
    const newPosition = countsByPositions[newPublication.position]
    update[newPosition] += 1
    update.testimonyCount += 1
  }
  return update
}
