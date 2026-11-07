import { isPerformanceContext, type PerformanceContext } from "./performance-context.js"
import { localDate } from "./learning-workspace.js"

export const SAC_UNITS = [1, 2, 3, 4] as const

export type SacUnit = (typeof SAC_UNITS)[number]

export function isSacUnit(value: unknown): value is SacUnit {
  return typeof value === "number" && SAC_UNITS.includes(value as SacUnit)
}

type SacTiming = {
  plannedSeconds: number
  actualSeconds: number
  overtimeSeconds: number
  pausedSeconds: number
}

export type SacRecord = {
  id: string
  subject: string
  provider: string
  title: string
  sacNumber?: string
  unit: SacUnit
  areaOfStudy?: string
  scheduledAt: string
  durationMinutes: number
  score?: number
  maxScore?: number
  weighting?: number
  completedAt?: string
  notes?: string
  performanceContext?: PerformanceContext
  timing?: SacTiming
  createdAt: string
  updatedAt: string
}

export type SacTimerState = {
  remainingSeconds: number
  elapsedSeconds: number
  overtimeSeconds: number
  progress: number
  phase: "timing" | "overtime"
}

export type SacStats = {
  total: number
  completed: number
  upcoming: number
  average: number | null
  best: number | null
  totalTimedSeconds: number
  trend: number | null
}

export type SacSubjectStats = {
  subject: string
  completed: number
  upcoming: number
  average: number | null
  best: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

function validNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

export function validateSac(record: Pick<SacRecord, "subject" | "provider" | "title" | "unit" | "scheduledAt" | "durationMinutes" | "score" | "maxScore" | "weighting">): string | null {
  if (!record.subject.trim() || !record.provider.trim() || !record.title.trim()) return "Subject, school/provider, and SAC title are required."
  if (!isSacUnit(record.unit)) return "Unit must be between 1 and 4."
  if (!record.scheduledAt) return "SAC date is required."
  if (!Number.isFinite(record.durationMinutes) || record.durationMinutes <= 0) return "Duration must be greater than zero."
  const hasScore = record.score !== undefined
  const hasMaximum = record.maxScore !== undefined
  if (hasScore !== hasMaximum) return "Enter both the mark and maximum, or leave both blank."
  if (hasScore && hasMaximum) {
    if (!Number.isFinite(record.maxScore) || record.maxScore! <= 0) return "Maximum mark must be greater than zero."
    if (!Number.isFinite(record.score) || record.score! < 0) return "Mark must be zero or greater."
    if (record.score! > record.maxScore!) return "Mark cannot exceed the maximum."
  }
  if (record.weighting !== undefined && (!Number.isFinite(record.weighting) || record.weighting <= 0 || record.weighting > 100)) {
    return "Weighting must be between 0 and 100%."
  }
  return null
}

export function isSacRecord(value: unknown): value is SacRecord {
  if (!isRecord(value)) return false
  const record = value as unknown as SacRecord
  const timingValid = record.timing === undefined || (
    isRecord(record.timing) &&
    validNonNegativeNumber(record.timing.plannedSeconds) &&
    validNonNegativeNumber(record.timing.actualSeconds) &&
    validNonNegativeNumber(record.timing.overtimeSeconds) &&
    validNonNegativeNumber(record.timing.pausedSeconds)
  )
  return typeof record.id === "string" &&
    typeof record.subject === "string" &&
    typeof record.provider === "string" &&
    typeof record.title === "string" &&
    (record.sacNumber === undefined || typeof record.sacNumber === "string") &&
    isSacUnit(record.unit) &&
    (record.areaOfStudy === undefined || typeof record.areaOfStudy === "string") &&
    typeof record.scheduledAt === "string" &&
    typeof record.durationMinutes === "number" &&
    (record.score === undefined || typeof record.score === "number") &&
    (record.maxScore === undefined || typeof record.maxScore === "number") &&
    (record.weighting === undefined || typeof record.weighting === "number") &&
    (record.completedAt === undefined || typeof record.completedAt === "string") &&
    (record.notes === undefined || typeof record.notes === "string") &&
    (record.performanceContext === undefined || isPerformanceContext(record.performanceContext)) &&
    timingValid &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    validateSac(record) === null
}

export function migrateSacRecords(value: unknown): SacRecord[] | null {
  if (!Array.isArray(value)) return null
  const migrated = value.map((item) => {
    if (!isRecord(item)) return null
    const candidate = {
      ...item,
      provider: typeof item.provider === "string" ? item.provider : "School",
    }
    return isSacRecord(candidate) ? candidate : null
  })
  return migrated.every((item): item is SacRecord => item !== null) ? migrated : null
}

export function isCompletedSac(record: SacRecord): boolean {
  return record.score !== undefined && record.maxScore !== undefined
}

export function sacPercentage(record: SacRecord): number | null {
  return isCompletedSac(record) ? (record.score! / record.maxScore!) * 100 : null
}

export function getSacTimerState(nowMs: number, startedAtMs: number, durationMinutes: number): SacTimerState {
  const plannedSeconds = Math.max(0, durationMinutes * 60)
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000))
  const remainingSeconds = Math.max(0, plannedSeconds - elapsedSeconds)
  const overtimeSeconds = Math.max(0, elapsedSeconds - plannedSeconds)
  return {
    remainingSeconds,
    elapsedSeconds,
    overtimeSeconds,
    progress: plannedSeconds ? Math.min(100, (elapsedSeconds / plannedSeconds) * 100) : 100,
    phase: overtimeSeconds > 0 ? "overtime" : "timing",
  }
}

export function getUpcomingSacs(records: SacRecord[], today = localDate(new Date())): SacRecord[] {
  return records
    .filter((record) => !isCompletedSac(record) && record.scheduledAt >= today)
    .sort((first, second) => first.scheduledAt.localeCompare(second.scheduledAt))
}

export function computeSacStats(records: SacRecord[], today = localDate(new Date())): SacStats {
  let completed = 0, upcoming = 0, totalWeight = 0, weightedScore = 0, totalTimedSeconds = 0
  let best: number | null = null
  let earliest: SacRecord | undefined, latest: SacRecord | undefined
  for (const record of records) {
    if (!isCompletedSac(record)) {
      if (record.scheduledAt >= today) upcoming++
      continue
    }
    completed++
    const percentage = sacPercentage(record)!
    const weight = record.weighting ?? 1
    totalWeight += weight
    weightedScore += percentage * weight
    totalTimedSeconds += record.timing?.actualSeconds ?? 0
    best = Math.max(best ?? -Infinity, percentage)
    const date = record.completedAt ?? record.scheduledAt
    if (!earliest || date.localeCompare(earliest.completedAt ?? earliest.scheduledAt) < 0) earliest = record
    if (!latest || date.localeCompare(latest.completedAt ?? latest.scheduledAt) >= 0) latest = record
  }
  return {
    total: records.length,
    completed,
    upcoming,
    average: totalWeight ? weightedScore / totalWeight : null,
    best,
    totalTimedSeconds,
    trend: completed >= 2 ? sacPercentage(latest!)! - sacPercentage(earliest!)! : null,
  }
}

export function buildSacSubjectStats(records: SacRecord[], today = localDate(new Date())): SacSubjectStats[] {
  const subjects = new Map<string, SacRecord[]>()
  for (const record of records) {
    const bucket = subjects.get(record.subject) ?? []
    bucket.push(record)
    subjects.set(record.subject, bucket)
  }
  return [...subjects.entries()].map(([subject, subjectRecords]) => {
    const { completed, upcoming, average, best } = computeSacStats(subjectRecords, today)
    return { subject, completed, upcoming, average, best }
  }).sort((first, second) => second.completed - first.completed || first.subject.localeCompare(second.subject))
}
