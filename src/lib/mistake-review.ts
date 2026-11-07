import { getMistakeSchedule, type Mistake, type MistakeReviewState } from "./exam-data.js"

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
  let recentReviews = 0, recentRecalled = 0, previousReviews = 0, previousRecalled = 0
  let strengthenedCards = 0
  let newlyMatureCards = 0

  for (const mistake of activeMistakes) {
    const reviews = (mistake.reviewHistory ?? []).toSorted((first, second) => first.completedAt.localeCompare(second.completedAt))
    let previousInterval = 0
    let wasMature = false
    let strengthened = false
    let newlyMature = false
    for (const review of reviews) {
      const completedAt = Date.parse(review.completedAt)
      const successful = isSuccessfulReview(review.result)
      if (completedAt >= previousStart && completedAt < windowStart) {
        previousReviews++
        if (successful) previousRecalled++
      }
      const interval = review.intervalDays ?? 0
      if (completedAt >= windowStart && completedAt <= windowEnd) {
        recentReviews++
        if (successful) recentRecalled++
        if (successful && interval > previousInterval) strengthened = true
        if (!wasMature && interval >= 21) newlyMature = true
      }
      previousInterval = interval
      if (interval >= 21) wasMature = true
    }
    if (strengthened) strengthenedCards += 1
    if (newlyMature) newlyMatureCards += 1
  }

  const recallRate = recentReviews ? recentRecalled / recentReviews * 100 : null
  const previousRecallRate = previousReviews ? previousRecalled / previousReviews * 100 : null
  return {
    activeCards: activeMistakes.length,
    matureCards,
    masteryPercent: activeMistakes.length ? matureCards / activeMistakes.length * 100 : 0,
    reviewsCompleted: recentReviews,
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
    if (Date.parse(schedule.dueAt) <= timestamp) {
      counts.due += 1
      counts[schedule.state] += 1
    } else {
      counts.scheduled += 1
    }
  }
  return counts
}

export function formatReviewInterval(dueAt: string, from = new Date()): string {
  const milliseconds = Math.max(0, Date.parse(dueAt) - from.getTime())
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
  return [...counts.values()].sort(
    (first, second) => second.unresolved - first.unresolved ||
      second.unresolved + second.resolved - (first.unresolved + first.resolved),
  )
}
