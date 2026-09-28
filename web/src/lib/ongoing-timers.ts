import { isFocalTimerLink, pauseFocalTimer, resumeFocalTimer, type FocalTimerLink } from "@/lib/focal-timer"
import { isSacUnit, type SacUnit } from "@/lib/sac"

export type ExamTimerSession = {
  subject: string
  provider: string
  title: string
  examYear: number
  paper: string
  readingMinutes: number
  writingMinutes: number
  marks: number
  startedAt: number
  pausedAt?: number
  pausedSeconds: number
  focal?: FocalTimerLink
  workspaceItems?: ExamWorkspaceItem[]
}

export type ExamWorkspaceStatus = "not-started" | "in-progress" | "flagged" | "done"

export type ExamSessionConditions = Pick<ExamTimerSession, "readingMinutes" | "writingMinutes" | "marks">

export function updateExamSessionConditions(session: ExamTimerSession, conditions: ExamSessionConditions, now = Date.now()): ExamTimerSession {
  const { readingMinutes, writingMinutes, marks } = conditions
  if (!Number.isFinite(readingMinutes) || readingMinutes < 0 || readingMinutes > 180) throw new Error("Reading time must be between 0 and 180 minutes.")
  if (!Number.isFinite(writingMinutes) || writingMinutes < 1 || writingMinutes > 360) throw new Error("Writing time must be between 1 and 360 minutes.")
  if (!Number.isFinite(marks) || marks < 0.5 || marks > 500) throw new Error("Total marks must be between 0.5 and 500.")
  if (![readingMinutes, writingMinutes, marks].every((value) => Number.isInteger(value * 2))) throw new Error("Use whole or half minutes and marks.")
  const mappedMarks = (session.workspaceItems ?? []).reduce((total, item) => total + item.marks, 0)
  if (marks < mappedMarks) throw new Error(`Your questions use ${mappedMarks} marks. Adjust the question map before reducing the total below ${mappedMarks}.`)
  const elapsed = Math.max(0, (session.pausedAt ?? now) - session.startedAt)
  // Once writing has started, changing reading allocation must not reset it
  // or reinterpret writing time as reading time.
  const writingStarted = elapsed >= session.readingMinutes * 60_000
  return {
    ...session,
    readingMinutes,
    writingMinutes,
    marks,
    startedAt: writingStarted ? session.startedAt + (session.readingMinutes - readingMinutes) * 60_000 : session.startedAt,
    focal: session.focal ? { ...session.focal, plannedSeconds: Math.round((readingMinutes + writingMinutes) * 60) } : undefined,
  }
}

export function pauseExamSession(session: ExamTimerSession, now = Date.now()): ExamTimerSession {
  if (session.pausedAt !== undefined) return session
  return { ...session, pausedAt: now, focal: session.focal ? pauseFocalTimer(session.focal, new Date(now)) : undefined }
}

export function resumeExamSession(session: ExamTimerSession, now = Date.now()): ExamTimerSession {
  if (session.pausedAt === undefined) return session
  const pauseDuration = Math.max(0, now - session.pausedAt)
  return {
    ...session,
    startedAt: session.startedAt + pauseDuration,
    pausedAt: undefined,
    pausedSeconds: session.pausedSeconds + pauseDuration / 1000,
    focal: session.focal ? resumeFocalTimer(session.focal, new Date(now)) : undefined,
  }
}

export type ExamWorkspaceItem = {
  id: string
  label: string
  marks: number
  status: ExamWorkspaceStatus
  confidence: "low" | "medium" | "high"
  note?: string
}

export type SacTimerSession = {
  recordId?: string
  subject: string
  provider: string
  title: string
  sacNumber?: string
  unit: SacUnit
  areaOfStudy?: string
  scheduledAt: string
  durationMinutes: number
  maxScore: number
  weighting?: number
  notes?: string
  createdAt?: string
  startedAt: number
  pausedAt?: number
  pausedSeconds: number
  focal?: FocalTimerLink
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string"
}

function isOptionalNumber(value: unknown) {
  return value === undefined || typeof value === "number" && Number.isFinite(value)
}

function hasValidSharedTimerState(value: Record<string, unknown>) {
  return typeof value.subject === "string" &&
    typeof value.provider === "string" &&
    typeof value.title === "string" &&
    typeof value.startedAt === "number" && Number.isFinite(value.startedAt) &&
    typeof value.pausedSeconds === "number" && Number.isFinite(value.pausedSeconds) && value.pausedSeconds >= 0 &&
    isOptionalNumber(value.pausedAt) &&
    (value.focal === undefined || isFocalTimerLink(value.focal))
}

export function isExamTimerSession(value: unknown): value is ExamTimerSession {
  if (!isRecord(value) || !hasValidSharedTimerState(value)) return false
  return typeof value.examYear === "number" && Number.isFinite(value.examYear) &&
    typeof value.paper === "string" &&
    typeof value.readingMinutes === "number" && Number.isFinite(value.readingMinutes) && value.readingMinutes >= 0 &&
    typeof value.writingMinutes === "number" && Number.isFinite(value.writingMinutes) && value.writingMinutes > 0 &&
    typeof value.marks === "number" && Number.isFinite(value.marks) && value.marks > 0 &&
    (value.workspaceItems === undefined || Array.isArray(value.workspaceItems) && value.workspaceItems.every((item) =>
      isRecord(item) && typeof item.id === "string" && typeof item.label === "string" &&
      typeof item.marks === "number" && Number.isFinite(item.marks) && item.marks > 0 &&
      ["not-started", "in-progress", "flagged", "done"].includes(String(item.status)) &&
      ["low", "medium", "high"].includes(String(item.confidence)) && isOptionalString(item.note)))
}

export function isSacTimerSession(value: unknown): value is SacTimerSession {
  if (!isRecord(value) || !hasValidSharedTimerState(value)) return false
  return isOptionalString(value.recordId) &&
    isOptionalString(value.sacNumber) &&
    isSacUnit(value.unit) &&
    isOptionalString(value.areaOfStudy) &&
    typeof value.scheduledAt === "string" &&
    typeof value.durationMinutes === "number" && Number.isFinite(value.durationMinutes) && value.durationMinutes > 0 &&
    typeof value.maxScore === "number" && Number.isFinite(value.maxScore) && value.maxScore > 0 &&
    isOptionalNumber(value.weighting) &&
    isOptionalString(value.notes) &&
    isOptionalString(value.createdAt)
}

export function mergeTimerSession<T>(
  local: T | undefined,
  localUpdatedAt: string,
  remote: T | undefined,
  remoteUpdatedAt: string,
) {
  return remoteUpdatedAt > localUpdatedAt
    ? { session: remote, updatedAt: remoteUpdatedAt }
    : { session: local, updatedAt: localUpdatedAt }
}
