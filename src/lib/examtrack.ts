import type { SupabaseClient } from "@supabase/supabase-js"
import type { StudySession, Subject } from "@/lib/types"
import { isRecord } from "@/lib/utils"

export interface ExamTrackAttemptSummary {
  id: string
  subject: string
  title: string
  provider: string
  completedAt: string
  percentage: number
}

export interface ExamTrackSubjectSummary {
  subject: string
  attempts: number
  averagePercentage: number
}

export interface ExamTrackSnapshot {
  attempts: ExamTrackAttemptSummary[]
  subjects: ExamTrackSubjectSummary[]
  averagePercentage: number | null
  dueMistakes: number
  totalMistakes: number
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function asValidDate(value: unknown): string | null {
  const candidate = asNonEmptyString(value)
  return candidate && Number.isFinite(new Date(candidate).getTime()) ? candidate : null
}

function parseAttempt(value: unknown): ExamTrackAttemptSummary | null {
  if (!isRecord(value)) return null
  const id = asNonEmptyString(value.id)
  const subject = asNonEmptyString(value.subject)
  const completedAt = asValidDate(value.completedAt)
  const rawScore = value.rawScore
  const rawMax = value.rawMax
  if (
    !id || !subject || !completedAt ||
    typeof rawScore !== "number" || !Number.isFinite(rawScore) || rawScore < 0 ||
    typeof rawMax !== "number" || !Number.isFinite(rawMax) || rawMax <= 0 ||
    rawScore > rawMax
  ) return null

  return {
    id,
    subject,
    title: asNonEmptyString(value.title) ?? `${subject} practice exam`,
    provider: asNonEmptyString(value.provider) ?? "Other",
    completedAt,
    percentage: (rawScore / rawMax) * 100,
  }
}

function mistakeIsDue(value: unknown, now: Date): boolean | null {
  if (!isRecord(value)) return null
  if (value.suspended === true) return false
  const explicitDueAt = asValidDate(value.dueAt)
  if (explicitDueAt) return new Date(explicitDueAt).getTime() <= now.getTime()

  const history = Array.isArray(value.reviewHistory) ? value.reviewHistory.filter(isRecord) : []
  const latest = history[history.length - 1]
  const base = asValidDate(value.lastReviewedAt) ?? asValidDate(latest?.completedAt) ?? asValidDate(value.updatedAt) ?? asValidDate(value.createdAt)
  if (!base) return false
  const explicitInterval = value.intervalDays
  const intervalDays = typeof explicitInterval === "number" && Number.isFinite(explicitInterval) && explicitInterval >= 0
    ? explicitInterval
    : value.resolved === true
      ? 30
      : latest?.result === "hard"
        ? 1
        : latest?.result === "easy"
          ? 7
          : latest?.result === "good" || latest?.result === "correct"
            ? 3
            : 0
  return new Date(base).getTime() + intervalDays * 86_400_000 <= now.getTime()
}

export function summariseExamTrackData(
  attemptPayloads: unknown[],
  mistakePayloads: unknown[],
  now = new Date(),
): ExamTrackSnapshot {
  const attempts = attemptPayloads
    .map(parseAttempt)
    .filter((attempt): attempt is ExamTrackAttemptSummary => Boolean(attempt))
    .sort((first, second) => second.completedAt.localeCompare(first.completedAt))
  const mistakes = mistakePayloads
    .map((mistake) => mistakeIsDue(mistake, now))
    .filter((due): due is boolean => due !== null)
  const subjects = new Map<string, { attempts: number; total: number }>()
  for (const attempt of attempts) {
    const current = subjects.get(attempt.subject) ?? { attempts: 0, total: 0 }
    current.attempts += 1
    current.total += attempt.percentage
    subjects.set(attempt.subject, current)
  }

  return {
    attempts,
    subjects: [...subjects.entries()]
      .map(([subject, result]) => ({
        subject,
        attempts: result.attempts,
        averagePercentage: result.total / result.attempts,
      }))
      .sort((first, second) => first.averagePercentage - second.averagePercentage || first.subject.localeCompare(second.subject)),
    averagePercentage: attempts.length
      ? attempts.reduce((total, attempt) => total + attempt.percentage, 0) / attempts.length
      : null,
    dueMistakes: mistakes.filter(Boolean).length,
    totalMistakes: mistakes.length,
  }
}

export async function fetchExamTrackSnapshot(
  client: SupabaseClient,
  userId: string,
): Promise<ExamTrackSnapshot> {
  const [attemptResult, mistakeResult] = await Promise.all([
    client.from("attempts").select("payload").eq("user_id", userId).is("deleted_at", null),
    client.from("mistakes").select("payload").eq("user_id", userId).is("deleted_at", null),
  ])
  if (attemptResult.error) throw attemptResult.error
  if (mistakeResult.error) throw mistakeResult.error

  const payloads = (rows: unknown): unknown[] => Array.isArray(rows)
    ? rows.flatMap((row) => isRecord(row) && "payload" in row ? [row.payload] : [])
    : []

  return summariseExamTrackData(
    payloads(attemptResult.data),
    payloads(mistakeResult.data),
  )
}

function normaliseSubject(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export function matchFocalSubjectId(name: string, subjects: Subject[]): string | undefined {
  const target = normaliseSubject(name)
  return subjects.find((subject) =>
    normaliseSubject(subject.name) === target || normaliseSubject(subject.shortCode) === target
  )?.id
}

export function getExamTrackUrl(
  hash = "",
  configured = import.meta.env.VITE_EXAMTRACK_URL,
): string | null {
  if (!configured) return null
  try {
    const url = new URL(configured)
    if (url.protocol !== "https:") return null
    url.hash = hash
    return url.toString()
  } catch {
    return null
  }
}

export function getExamTrackTimerUrl(
  kind: "exam" | "sac" | "focus",
  configured = import.meta.env.VITE_EXAMTRACK_URL,
): string | null {
  const base = getExamTrackUrl("", configured)
  if (!base) return null
  const url = new URL(base)
  url.searchParams.set("timer", kind)
  return url.toString()
}

export function getActiveExamTrackTimer(sessions: StudySession[]): StudySession | undefined {
  return sessions
    .filter((session) => session.execution.state === "in-progress" && session.integrations?.examtrack)
    .sort((first, second) => (second.updated_at ?? second.created_at).localeCompare(first.updated_at ?? first.created_at))[0]
}

export function getExamTrackElapsedSeconds(session: StudySession, now = new Date()): number {
  if (session.execution.state === "planned") return 0
  return Math.floor(session.execution.intervals.reduce((total, interval) => {
    const start = new Date(interval.start).getTime()
    const end = interval.end ? new Date(interval.end).getTime() : now.getTime()
    return total + (Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0)
  }, 0) / 1000)
}
