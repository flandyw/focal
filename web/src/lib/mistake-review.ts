import { getMistakeSchedule, type Mistake, type MistakeReviewState } from "@/lib/exam-data"

const DAY_MS = 24 * 60 * 60 * 1000

export type MistakeProgressSummary = {
  activeCards: number
  matureCards: number
  masteryPercent: number
  reviewsCompleted: number
  recallRate: number | null
  recallDelta: number | null
  strengthenedCards: number
  newlyMatureCards: number
}

function isSuccessfulReview(result: NonNullable<Mistake["reviewHistory"]>[number]["result"]) {
  return result !== "again" && result !== "incorrect"
}

export function getMistakeProgress(
  mistakes: Mistake[],
  now = new Date(),
  windowDays = 30,
): MistakeProgressSummary {
  const activeMistakes = mistakes.filter((mistake) => !mistake.suspended)
  const matureCards = activeMistakes.filter((mistake) => getMistakeSchedule(mistake).resolved).length
  const windowEnd = now.getTime()
  const windowStart = windowEnd - windowDays * DAY_MS
  const previousStart = windowStart - windowDays * DAY_MS
  const recentReviews = activeMistakes.flatMap((mistake) => mistake.reviewHistory ?? [])
    .filter((review) => {
      const completedAt = new Date(review.completedAt).getTime()
      return completedAt >= windowStart && completedAt <= windowEnd
    })
  const previousReviews = activeMistakes.flatMap((mistake) => mistake.reviewHistory ?? [])
    .filter((review) => {
      const completedAt = new Date(review.completedAt).getTime()
      return completedAt >= previousStart && completedAt < windowStart
    })
  const recallRate = recentReviews.length
    ? recentReviews.filter((review) => isSuccessfulReview(review.result)).length / recentReviews.length * 100
    : null
  const previousRecallRate = previousReviews.length
    ? previousReviews.filter((review) => isSuccessfulReview(review.result)).length / previousReviews.length * 100
    : null
  let strengthenedCards = 0
  let newlyMatureCards = 0

  for (const mistake of activeMistakes) {
    const reviews = [...(mistake.reviewHistory ?? [])].toSorted((first, second) => first.completedAt.localeCompare(second.completedAt))
    let previousInterval = 0
    let wasMature = false
    let strengthened = false
    let newlyMature = false
    for (const review of reviews) {
      const completedAt = new Date(review.completedAt).getTime()
      const interval = review.intervalDays ?? 0
      if (completedAt >= windowStart && completedAt <= windowEnd) {
        if (isSuccessfulReview(review.result) && interval > previousInterval) strengthened = true
        if (!wasMature && interval >= 21) newlyMature = true
      }
      previousInterval = interval
      if (interval >= 21) wasMature = true
    }
    if (strengthened) strengthenedCards += 1
    if (newlyMature) newlyMatureCards += 1
  }

  return {
    activeCards: activeMistakes.length,
    matureCards,
    masteryPercent: activeMistakes.length ? matureCards / activeMistakes.length * 100 : 0,
    reviewsCompleted: recentReviews.length,
    recallRate,
    recallDelta: recallRate !== null && previousRecallRate !== null ? recallRate - previousRecallRate : null,
    strengthenedCards,
    newlyMatureCards,
  }
}

export type MistakeQueueCounts = Record<MistakeReviewState, number> & {
  due: number
  scheduled: number
  mature: number
  suspended: number
}

export function getMistakeQueueCounts(mistakes: Mistake[], now = new Date()): MistakeQueueCounts {
  const counts: MistakeQueueCounts = { new: 0, learning: 0, review: 0, relearning: 0, due: 0, scheduled: 0, mature: 0, suspended: 0 }
  const timestamp = now.getTime()
  for (const mistake of mistakes) {
    if (mistake.suspended) {
      counts.suspended += 1
      continue
    }
    const schedule = getMistakeSchedule(mistake)
    if (schedule.resolved) counts.mature += 1
    if (new Date(schedule.dueAt).getTime() <= timestamp) {
      counts.due += 1
      counts[schedule.state] += 1
    } else {
      counts.scheduled += 1
    }
  }
  return counts
}

export function formatReviewInterval(dueAt: string, from = new Date()): string {
  const milliseconds = Math.max(0, new Date(dueAt).getTime() - from.getTime())
  const minutes = Math.max(1, Math.round(milliseconds / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 60) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 24) return `${months}mo`
  return `${Math.round(months / 12)}y`
}

export function buildRevisionPriorities(mistakes: Mistake[]) {
  const counts = new Map<string, { category: string; unresolved: number; resolved: number }>()
  for (const mistake of mistakes) {
    const entry = counts.get(mistake.category) ?? { category: mistake.category, unresolved: 0, resolved: 0 }
    entry[mistake.resolved ? "resolved" : "unresolved"] += 1
    counts.set(mistake.category, entry)
  }
  return [...counts.values()].toSorted(
    (first, second) => second.unresolved - first.unresolved ||
      second.unresolved + second.resolved - (first.unresolved + first.resolved),
  )
}

export function buildRevisionQueue(mistakes: Mistake[]) {
  const rank = new Map(buildRevisionPriorities(mistakes).map((item, index) => [item.category, index]))
  return mistakes.filter((mistake) => !mistake.resolved).toSorted(
    (first, second) => (rank.get(first.category) ?? 0) - (rank.get(second.category) ?? 0) ||
      first.updatedAt.localeCompare(second.updatedAt),
  )
}
