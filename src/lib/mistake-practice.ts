import { getMistakeSchedule, normalizeMistakeReviewPreferences, type Mistake, type MistakeReviewPreferences, type PracticeContext, type ReviewRating } from "./exam-data"

export const PRACTICE_FINISHES = [
  { id: "graphite", label: "Graphite", xp: 0, color: "#687582" },
  { id: "moss", label: "Moss", xp: 100, color: "#59846c" },
  { id: "cobalt", label: "Cobalt", xp: 300, color: "#668bd0" },
  { id: "amber", label: "Amber", xp: 600, color: "#c89a49" },
] as const

export function practiceDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function practiceWeek(now: Date): string {
  const monday = new Date(now)
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  return practiceDay(monday)
}

const recalled = (result: string) => ["good", "easy", "correct"].includes(result)
const shaky = (result: string) => ["again", "hard", "incorrect", "assisted"].includes(result)
export function practiceHistory(mistake: Mistake) {
  return [...new Map((mistake.reviewHistory ?? []).map((review) => [review.id, review])).values()]
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt) || a.id.localeCompare(b.id))
}
export function isRematch(mistake: Mistake): boolean {
  const last = practiceHistory(mistake).at(-1)
  return !!last && shaky(last.result)
}
export function recallStrength(mistake: Mistake): number {
  return Math.min(3, new Set(practiceHistory(mistake).filter((review) => recalled(review.result)).map((review) => practiceDay(new Date(review.completedAt)))).size)
}

export function practiceMissionCards(mistakes: Mistake[], mission: string, now: Date): Mistake[] {
  const today = practiceDay(now)
  return mistakes.filter((mistake) => {
    if (mistake.suspended || mission === "rematch" && !isRematch(mistake)) return false
    const history = practiceHistory(mistake)
    return !history.some((review, i) => practiceDay(new Date(review.completedAt)) === today && (mission === "confidence" ? !!review.confidence : mission === "rematch" ? i > 0 && shaky(history[i - 1].result) : true))
  }).sort((a, b) => Date.parse(getMistakeSchedule(a).dueAt) - Date.parse(getMistakeSchedule(b).dueAt) || a.id.localeCompare(b.id))
}

export function practiceFeedback(mistake: Mistake, rating: ReviewRating, context: PracticeContext): string {
  if (recalled(rating) && context.confidence === "low") return "Recalled it, even with low confidence."
  if (recalled(rating) && isRematch(mistake)) return "Rematch recovered."
  if (context.confidence === "high" && shaky(rating)) return "Blind spot spotted. Added to your rematches."
  return recalled(rating) ? "Recall strengthened." : "Attempt saved. A rematch is ready when you are."
}

export function getPracticeProgress(mistakes: Mistake[], now = new Date()) {
  const today = practiceDay(now)
  const week = practiceWeek(now)
  const days = new Map<string, { cards: Set<string>; rematches: Set<string>; predictions: Set<string> }>()
  const weeks = new Map<string, { cards: Set<string>; target: number }>()
  let calibrated = 0, predictions = 0
  for (const mistake of mistakes) {
    let previous = ""
    for (const review of practiceHistory(mistake)) {
      if (Date.parse(review.completedAt) > now.getTime()) continue
      const day = practiceDay(new Date(review.completedAt))
      const entry = days.get(day) ?? { cards: new Set<string>(), rematches: new Set<string>(), predictions: new Set<string>() }
      entry.cards.add(mistake.id)
      if (shaky(previous)) entry.rematches.add(mistake.id)
      if (review.confidence) {
        entry.predictions.add(mistake.id)
        predictions++
        if (review.confidence === "high" && recalled(review.result) || review.confidence === "medium" && ["hard", "assisted"].includes(review.result) || review.confidence === "low" && ["again", "incorrect"].includes(review.result)) calibrated++
      }
      days.set(day, entry)
      if (review.challengeWeek && review.challengeSize && practiceWeek(new Date(review.completedAt)) === review.challengeWeek) {
        const challenge = weeks.get(review.challengeWeek) ?? { cards: new Set<string>(), target: 0 }
        challenge.cards.add(mistake.id)
        challenge.target = Math.max(challenge.target, review.challengeSize)
        weeks.set(review.challengeWeek, challenge)
      }
      previous = review.result
    }
  }
  // ponytail: rewards are derived from the shared review ledger, so retries and syncing cannot award XP twice.
  const dailyXP = (entry: NonNullable<ReturnType<typeof days.get>>) => entry.cards.size * 10 + (entry.cards.size >= 5 ? 20 : 0) + (entry.rematches.size >= 2 ? 20 : 0) + (entry.predictions.size >= 3 ? 20 : 0)
  const weeklyXP = [...weeks.values()].filter((entry) => entry.cards.size >= entry.target).length * 75
  const xp = [...days.values()].reduce((sum, entry) => sum + dailyXP(entry), 0) + weeklyXP
  const current = days.get(today)
  const quests = [
    { id: "daily", label: "Put in five", detail: "Review five different mistakes", done: current?.cards.size ?? 0, target: 5 },
    { id: "rematch", label: "Second look", detail: "Revisit two difficult mistakes", done: current?.rematches.size ?? 0, target: 2 },
    { id: "confidence", label: "Call your confidence", detail: "Predict your recall on three cards", done: current?.predictions.size ?? 0, target: 3 },
  ]
  const weekly = weeks.get(week)
  const active = mistakes.filter((mistake) => !mistake.suspended)
  const practiced = active.filter((mistake) => practiceHistory(mistake).some((review) => practiceDay(new Date(review.completedAt)) < week))
  // ponytail: deterministic IDs keep the weekly selection identical in both clients; grow this into topic balancing if needed.
  const pool = practiced.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const offset = pool.length ? Math.floor(Date.parse(`${week}T00:00:00Z`) / 604800000) % pool.length : 0
  const challenge = [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, 5)
  return { xp, level: Math.floor(xp / 100) + 1, todayXP: current ? dailyXP(current) : 0, todayCount: current?.cards.size ?? 0,
    quests, week, challenge, weeklyCount: weekly?.cards.size ?? 0, weeklyTarget: weekly?.target ?? challenge.length,
    weeklyComplete: !!weekly && weekly.cards.size >= weekly.target,
    calibration: predictions ? Math.round(calibrated / predictions * 100) : null, predictions,
    established: active.filter((mistake) => recallStrength(mistake) === 3 && !isRematch(mistake)).length }
}

export function nextPracticeWindow(preferences?: MistakeReviewPreferences, now = new Date()): Date | null {
  const settings = normalizeMistakeReviewPreferences(preferences)
  const [hours, minutes] = settings.practiceTime!.split(":").map(Number)
  for (let offset = 0; offset <= 7; offset++) {
    const slot = new Date(now)
    slot.setDate(slot.getDate() + offset)
    slot.setHours(hours, minutes, 0, 0)
    if (settings.practiceDays!.includes(slot.getDay() || 7) && slot.getTime() + 3600000 > now.getTime() && slot.getTime() >= Date.parse(settings.practiceSnoozedUntil ?? "1970-01-01")) return slot
  }
  return null
}

export function playPracticeSound() {
  try {
    const audio = new AudioContext()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.connect(gain).connect(audio.destination)
    oscillator.frequency.setValueAtTime(660, audio.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(880, audio.currentTime + .09)
    gain.gain.setValueAtTime(.025, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .16)
    oscillator.start()
    oscillator.stop(audio.currentTime + .17)
    oscillator.onended = () => { void audio.close() }
  } catch { /* Sound is optional; a blocked audio context must never block a review. */ }
}
