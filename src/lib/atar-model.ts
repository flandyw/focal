// One derived ATAR model for the ATAR page, desktop widgets, goals and MCP tools.
import type { AppData, AssessmentReference, AtarEstimatorRow, SavedAtarEstimate } from "./exam-data.js"
import { ATAR_AGGREGATE_REFERENCES } from "./atar-data.js"
import { atarRawScore, estimateAtar, type AtarEstimate, type AtarStudyResult } from "./atar.js"
import { atarScalingReference, interpolateScaledScore, type ScalingReference } from "./scaling.js"
import { predictStudyScore, type StudyScorePrediction } from "./study-score.js"
import { subjectCompletionYear } from "./subject-completion.js"

export type AtarRowIssue = "no-study" | "no-scaling" | "no-estimate" | "blank" | "invalid-manual"
export type AtarRole = "English" | "Primary" | "Increment" | "Not counted"

export type AtarModelRow = {
  row: AtarEstimatorRow
  /** The study as published for the conversion year (or its latest year). */
  study?: ScalingReference
  /** The scaling actually applied: completion year, then conversion year, then latest. */
  scaling?: ScalingReference
  completedYear?: number
  prediction: StudyScorePrediction | null
  source: "focal" | "manual"
  rawScore: number | null
  scaledScore: number | null
  issue: AtarRowIssue | null
  role: AtarRole | null
  /** Points added to the aggregate: scaled score in the primary four, 10% as an increment, else 0. */
  contribution: number
  /** Change if this study's raw score rises by one (null at 50 or without a score). */
  sensitivity: { aggregate: number; atar: number | null } | null
}

export type AtarModel = {
  year: number
  rows: AtarModelRow[]
  results: AtarStudyResult[]
  estimate: AtarEstimate | null
  target: number | null
  /** Lowest aggregate that reaches the target ATAR in this year's conversion. */
  targetAggregate: number | null
  /** Target minus estimated ATAR; negative once above target. */
  gap: number | null
  aggregateGap: number | null
  /** ATAR with every Focal estimate at the low/high end of its likely range; null without a Focal range. */
  range: { low: string; high: string; lowAtar: number | null; highAtar: number | null } | null
}

export type AtarHistoryPoint = { timestamp: number; atar: number | null; aggregate: number; kind: "saved" | "practice"; label: string }

export function atarYears(scaling: ScalingReference[]) {
  return ATAR_AGGREGATE_REFERENCES.map((item) => item.year).filter((year) => scaling.some((reference) => reference.year === year)).toSorted((a, b) => b - a)
}

export function activeAtarTarget(data: Pick<AppData, "learning">) {
  return data.learning.goals.find((goal) => goal.kind === "atar" && !goal.archivedAt)?.target ?? null
}

export function latestSavedEstimate(data: Pick<AppData, "atarEstimates">): SavedAtarEstimate | undefined {
  return data.atarEstimates.toSorted((first, second) => second.savedAt.localeCompare(first.savedAt))[0]
}

function targetAggregate(target: number | null, year: number) {
  const reference = ATAR_AGGREGATE_REFERENCES.find((item) => item.year === year)
  if (target === null || !reference) return null
  return reference.points.toSorted((a, b) => a.atar - b.atar).find((point) => point.atar >= target - 1e-9)?.aggregate ?? null
}

const round = (value: number) => Math.round(value * 100) / 100

export function buildAtarModel({ data, references, scaling, rows, year, target = activeAtarTarget(data) }: {
  data: Pick<AppData, "attempts" | "completedSubjects" | "subjectCompletionYears" | "learning">
  references: AssessmentReference[]
  scaling: ScalingReference[]
  rows: AtarEstimatorRow[]
  year: number
  target?: number | null
}): AtarModel {
  const predictions = new Map<string, StudyScorePrediction | null>()
  const predict = (subject: string) => {
    if (!predictions.has(subject)) predictions.set(subject, predictStudyScore({ subject, attempts: data.attempts, references }))
    return predictions.get(subject) ?? null
  }

  const modelRows = rows.map((row): AtarModelRow => {
    const source = row.usePrediction ? "focal" as const : "manual" as const
    const base = { row, source, prediction: null, rawScore: null, scaledScore: null, role: null, contribution: 0, sensitivity: null }
    const study = atarScalingReference(scaling, row.code, year)
    if (!study) return { ...base, issue: "no-study" }
    const prediction = predict(study.studyName)
    const completedYear = subjectCompletionYear(data, study.studyName)
    const applied = atarScalingReference(scaling, row.code, year, completedYear)
    const raw = atarRawScore(row, prediction?.studyScore)
    const withStudy = { ...base, study, scaling: applied, completedYear, prediction }
    if (!applied) return { ...withStudy, issue: "no-scaling" }
    if (!Number.isFinite(raw)) return { ...withStudy, issue: row.usePrediction ? "no-estimate" : row.raw.trim() === "" ? "blank" : "invalid-manual" }
    const scaled = interpolateScaledScore(raw, applied.points)
    if (scaled === null) return { ...withStudy, issue: "no-estimate" }
    return { ...withStudy, rawScore: raw, scaledScore: scaled, issue: null }
  })

  const resultFor = (item: AtarModelRow, rawScore = item.rawScore): AtarStudyResult[] => {
    if (!item.study || !item.scaling || rawScore === null) return []
    const scaledScore = interpolateScaledScore(rawScore, item.scaling.points)
    return scaledScore === null ? [] : [{ id: item.row.id, code: item.study.code, studyName: item.study.studyName, rawScore, scaledScore }]
  }
  const results = modelRows.flatMap((item) => resultFor(item))
  const estimate = estimateAtar(results, year)

  const counted = new Map((estimate ? [...estimate.primaryFour, ...estimate.increments] : []).map((item) => [item.id, item]))
  for (const item of modelRows) {
    const hit = counted.get(item.row.id)
    item.role = hit ? hit.role : item.scaledScore !== null && estimate ? "Not counted" : null
    item.contribution = hit?.contribution ?? 0
    if (estimate && item.rawScore !== null && item.rawScore < 50) {
      // +1 raw re-runs the full VTAC selection, so a study can enter or leave the counted six.
      const bumped = estimateAtar(modelRows.flatMap((other) => other === item ? resultFor(other, item.rawScore! + 1) : resultFor(other)), year)
      if (bumped) item.sensitivity = { aggregate: round(bumped.aggregate - estimate.aggregate), atar: bumped.atar !== null && estimate.atar !== null ? round(bumped.atar - estimate.atar) : null }
    }
  }

  let range: AtarModel["range"] = null
  const focal = modelRows.filter((item) => item.source === "focal" && item.prediction && item.rawScore !== null)
  if (estimate && focal.some((item) => item.prediction!.low !== item.prediction!.high)) {
    // shortcut: scaling has no points below 20, so a likely low under 20 is clamped to 20.
    const at = (end: "low" | "high") => estimateAtar(modelRows.flatMap((item) => focal.includes(item) ? resultFor(item, Math.min(50, Math.max(20, item.prediction![end]))) : resultFor(item)), year)
    const low = at("low"), high = at("high")
    range = { low: low?.atarLabel ?? "—", high: high?.atarLabel ?? "—", lowAtar: low?.atar ?? null, highAtar: high?.atar ?? null }
  }

  const aggregateTarget = targetAggregate(target, year)
  return {
    year,
    rows: modelRows,
    results,
    estimate,
    target,
    targetAggregate: aggregateTarget,
    gap: target !== null && estimate?.atar != null ? round(target - estimate.atar) : null,
    aggregateGap: aggregateTarget !== null && estimate ? round(aggregateTarget - estimate.aggregate) : null,
    range,
  }
}

/** Saved scenarios as recorded, plus the current rows re-estimated after each practice result date. */
export function buildAtarHistory(input: Omit<Parameters<typeof buildAtarModel>[0], "data"> & { data: Parameters<typeof buildAtarModel>[0]["data"] & Pick<AppData, "atarEstimates"> }): AtarHistoryPoint[] {
  const saved = input.data.atarEstimates.flatMap((item): AtarHistoryPoint[] => {
    const timestamp = Date.parse(item.savedAt)
    const atar = item.atarLabel.trim() ? Number(item.atarLabel) : NaN
    return Number.isFinite(timestamp) && item.aggregate !== null ? [{ timestamp, atar: Number.isFinite(atar) ? atar : null, aggregate: item.aggregate, kind: "saved", label: item.atarLabel }] : []
  })
  const current = buildAtarModel(input)
  const subjects = new Set(current.rows.flatMap((item) => item.source === "focal" && item.prediction ? item.prediction.evidence.map((evidence) => evidence.attempt.subject) : []))
  const dates = [...new Set(input.data.attempts.filter((attempt) => subjects.has(attempt.subject)).map((attempt) => attempt.completedAt))].toSorted()
  // shortcut: one full model per practice date (O(dates × rows)); fine for a student's paper count.
  const practice = dates.flatMap((date): AtarHistoryPoint[] => {
    const estimate = buildAtarModel({ ...input, data: { ...input.data, attempts: input.data.attempts.filter((attempt) => attempt.completedAt <= date) } }).estimate
    const timestamp = Date.parse(`${date}T00:00:00`)
    return estimate && Number.isFinite(timestamp) ? [{ timestamp, atar: estimate.atar, aggregate: estimate.aggregate, kind: "practice", label: estimate.atarLabel }] : []
  })
  return [...saved, ...practice].toSorted((a, b) => a.timestamp - b.timestamp)
}

/** The newest saved scenario recomputed live; null when its scores no longer form an estimate. */
export function liveSavedAtarModel(data: Parameters<typeof buildAtarHistory>[0]["data"], references: AssessmentReference[], scaling: ScalingReference[]) {
  const saved = latestSavedEstimate(data)
  if (!saved) return null
  const model = buildAtarModel({ data, references, scaling, rows: saved.rows, year: saved.year })
  return model.estimate ? { saved, model } : null
}
