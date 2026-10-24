import { z } from "zod"
import { ATAR_AGGREGATE_REFERENCES } from "../../src/lib/atar-data.js"
import { estimateAtar, type AtarStudyResult } from "../../src/lib/atar.js"
import { buildDayPlan } from "../../src/lib/day-plan.js"
import {
  buildAttemptBenchmarks, buildCoverage, buildSubjectBenchmarks, computeDistributionStats, normaliseComparisonName, type AppData, type AssessmentReference, type SavedAtarEstimate,
} from "../../src/lib/exam-data.js"
import { getAttemptMathsPaper } from "../../src/lib/mistake-filters.js"
import { buildExamSuggestions } from "../../src/lib/exam-suggestions.js"
import { getGoalProgress, localDate } from "../../src/lib/learning-workspace.js"
import { getMistakeProgress, getMistakeQueueCounts, buildRevisionPriorities } from "../../src/lib/mistake-review.js"
import { buildFocusPriorities, buildLostMarksAttribution, buildPaperDataQuality, buildPaperWeaknessMatrix, buildReviewForecast, buildSubjectOutlooks, type MatrixGrouping } from "../../src/lib/performance-insights.js"
import { getAnalyticsData } from "../../src/lib/progress-analytics.js"
import { analyticsSessions } from "../../src/lib/progress-utils.js"
import { getUpcomingSacs } from "../../src/lib/sac.js"
import { interpolateScaledScore, normaliseScalingStudyName, predictScaledStudyScore } from "../../src/lib/scaling.js"
import { buildStudyScoreTrend, predictStudyScore } from "../../src/lib/study-score.js"
import { daysUntil, formatExamLabel, formatExamTime, isUpcoming } from "../../src/lib/timetable.js"
import { isPaused, isRunning } from "../../src/lib/sync/sessionContract.js"
import { getCachedVcaaExams, getVcaaExamCompanions, isVcaaExamLogged } from "../../src/lib/vcaa-resources.js"
import { examResources, gradeReferences, readAll, scalingReferences, updateApp, vceTimetable } from "./store.js"
import type { Define } from "./tools"
import { day, limit, nowIso, round } from "./util.js"

const same = (a: string, b: string) => normaliseComparisonName(a) === normaliseComparisonName(b)
const contains = (haystack: string, needle: string) => normaliseComparisonName(haystack).includes(normaliseComparisonName(needle))


export function buildExamAnalytics(data: AppData, references: AssessmentReference[], { subject, groupBy = "topic", paper }: { subject?: string; groupBy?: MatrixGrouping; paper?: "Exam 1" | "Exam 2" }) {
  const attempts = data.attempts.filter((a) => (!subject || same(a.subject, subject)) && (!paper || getAttemptMathsPaper(a) === (paper === "Exam 1" ? 1 : 2)))
  const attemptIds = new Set(attempts.map((a) => a.id))
  const mistakes = subject || paper ? data.mistakes.filter((m) => attemptIds.has(m.attemptId)) : data.mistakes
  return {
    outlooks: buildSubjectOutlooks(attempts, data.examDifficulty),
    benchmarks: buildSubjectBenchmarks(attempts, references),
    papers: buildAttemptBenchmarks(attempts, references).map((b) => ({
      id: b.attempt.id, title: b.attempt.title, completedAt: b.attempt.completedAt, percentage: round(b.percentage), grade: b.grade,
      percentile: b.percentile === null ? null : round(b.percentile), vcaaMeanPercentage: round(b.vcaaMeanPercentage), gapToAPlus: b.gapToAPlus === null ? null : round(b.gapToAPlus),
    })),
    coverage: buildCoverage(attempts), focusPriorities: buildFocusPriorities(attempts, mistakes).slice(0, 10),
    reviewForecast: buildReviewForecast(mistakes), mistakeCategories: buildRevisionPriorities(mistakes),
    // The matrix filters on the exact stored name, so use the account's spelling rather than whatever case the caller typed.
    ...(subject && (() => {
      const name = attempts[0]?.subject ?? subject
      return {
        paperWeakness: buildPaperWeaknessMatrix(attempts, mistakes, name, data.learning.curriculumAreas.filter((item) => !item.archivedAt), groupBy),
        lostMarks: buildLostMarksAttribution(attempts, mistakes, name), dataQuality: buildPaperDataQuality(attempts, mistakes, name),
      }
    })()),
  }
}

export function insightTools(define: Define) {
  define("get_overview", "Start here. A snapshot of the whole account: queue and counts, today's plan, running timer, upcoming SACs, events and tracked VCE exams, goal progress and predicted study scores.", {}, "read", async () => {
    const [{ data, sessions }, references, timetable] = await Promise.all([readAll(), gradeReferences(), vceTimetable()])
    const now = new Date()
    const today = localDate(now)
    const plan = buildDayPlan(today, { ...data, sessions }, timetable)
    const running = sessions.find((s) => isRunning(s) || isPaused(s))
    const tracked = new Set(data.trackedExamIds)
    return {
      today, counts: { exams: data.attempts.length, mistakes: data.mistakes.length, sacs: data.sacRecords.length, subjects: data.subjects },
      mistakeQueue: getMistakeQueueCounts(data.mistakes), mistakeProgress: getMistakeProgress(data.mistakes),
      timer: running && { id: running.id, title: running.title, state: isRunning(running) ? "running" : "paused" },
      todayPlan: { plannedMinutes: plan.plannedMinutes, completedMinutes: plan.completedMinutes, dueMistakes: plan.dueMistakes, items: plan.items.map((i) => ({ kind: i.kind, title: i.title, minutes: i.minutes })) },
      upcomingSacs: getUpcomingSacs(data.sacRecords).slice(0, 5).map((r) => ({ id: r.id, title: r.title, subject: r.subject, scheduledAt: r.scheduledAt })),
      upcomingEvents: data.events.filter((e) => !e.isFinished && e.startTime >= now.toISOString()).toSorted((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 5)
        .map((e) => ({ id: e.id, title: e.title, type: e.eventType, startTime: e.startTime })),
      trackedVceExams: (timetable?.exams ?? []).filter((e) => tracked.has(e.id) && isUpcoming(e, now)).slice(0, 10).map((e) => ({ id: e.id, exam: formatExamLabel(e), date: e.date, daysUntil: daysUntil(e, now) })),
      goals: data.learning.goals.filter((g) => !g.archivedAt).map((goal) => ({ id: goal.id, kind: goal.kind, subject: goal.subject, deadline: goal.deadline, ...getGoalProgress(goal, data, references) })),
      studyScores: [...new Set(data.attempts.map((a) => a.subject))].flatMap((subject) => {
        const p = predictStudyScore({ subject, attempts: data.attempts, references })
        return p ? [{ subject, studyScore: p.studyScore, low: p.low, high: p.high, confidence: p.confidence }] : []
      }),
    }
  })

  define("get_progress", "Study-time analytics from your study sessions: time trends, subject breakdown, consistency/streaks, time of day, subject completion and efficiency. range is days back (7, 30, 90, 365) or 0 for all time.",
    { range: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.literal(0)]).default(30) }, "read", async ({ range }) => {
      const { sessions } = await readAll()
      return getAnalyticsData(analyticsSessions(sessions), [], range)
    })

  define("get_exam_analytics", "Exam and mistake analytics: per-subject outlook (projected next mark), benchmarks against VCAA distributions, area-of-study coverage, focus priorities, the 14-day review forecast and mistake categories. With `subject` it adds `paperWeakness` (the Exam 1 vs Exam 2 matrix, one row per canonical topic, each cell with mistakeCount, repeatMistakes, marksLost, dominantCategory and lostByCategory; built from marked questions when there are any, else from logged mistakes), `lostMarks` (last 10 papers, by category) and `dataQuality` (what is missing: papers with no question results, rawMax that does not fit the paper type, cards with no topic, unattributedMarks per paper). Read `dataQuality.warnings` before trusting a diagnosis. Diagnoses: tech-free/tech-active fragile, general weakness, secure, stable (marked questions); exam-1-only gap, exam-2-only gap, shared weakness, mistake-only evidence (too little to call), no evidence (mistake cards). `groupBy` topic (default) groups matrix rows by canonical topic, areaOfStudy by the free-text label (the old behaviour; one row per label). `paper` limits everything to Exam 1 or Exam 2 papers of Methods/Specialist.",
    { subject: z.string().optional(), groupBy: z.enum(["topic", "areaOfStudy"]).default("topic"), paper: z.enum(["Exam 1", "Exam 2"]).optional() }, "read", async (args) => {
      const [{ data }, references] = await Promise.all([readAll(), gradeReferences()])
      return buildExamAnalytics(data, references, args)
    })

  define("suggest_exams", "Suggest which official/company practice papers to do next, based on what is logged and your subjects.",
    { limit: z.number().int().min(1).max(20).default(4) }, "read", async ({ limit }) => {
      const [{ data }, references, studies] = await Promise.all([readAll(), gradeReferences(), examResources()])
      return buildExamSuggestions(data.attempts, references, data.subjects, limit, studies)
    })

  /* ----------------------------------------------------------- predictions */

  define("predict_study_score", "Predict a subject's raw study score (with a low-high range and confidence) from your logged exams weighted against VCAA distributions, plus its scaled score and how the prediction moved after each exam.", {
    subject: z.string().min(1), sacPercentile: z.number().min(0.1).max(99.9).optional().describe("Your SAC result as a percentile, if known"),
    examWeightPercent: z.number().min(0).max(100).optional().describe("Exam share of the study score; defaults per subject"),
  }, "read", async ({ subject, sacPercentile, examWeightPercent }) => {
    const [{ data }, references, scaling] = await Promise.all([readAll(), gradeReferences(), scalingReferences()])
    const options = { subject, attempts: data.attempts, references, sacPercentile, examWeightPercent }
    const prediction = predictStudyScore(options)
    if (!prediction) return { prediction: null, reason: "No logged exam for this subject matches a VCAA grade distribution yet." }
    return {
      studyScore: prediction.studyScore, low: prediction.low, high: prediction.high, confidence: prediction.confidence,
      examWeightPercent: prediction.examWeightPercent, components: prediction.components, excludedAttempts: prediction.excludedAttemptCount,
      scaled: predictScaledStudyScore(prediction.studyScore, subject, scaling),
      evidence: prediction.evidence.map((e) => ({ exam: e.attempt.title, completedAt: e.attempt.completedAt, percentile: round(e.percentile), weight: round(e.weight, 2) })),
      trend: buildStudyScoreTrend(options).map((p) => ({ date: p.attempt.completedAt, studyScore: p.studyScore, low: p.low, high: p.high })),
    }
  })

  define("scale_study_score", "Convert a raw study score (20-50) to a scaled score using VTAC scaling reports, averaged across report years unless you pick one.",
    { subject: z.string().min(1), rawScore: z.number().min(20).max(50), year: z.number().int().optional() }, "read", async ({ subject, rawScore, year }) => {
      return predictScaledStudyScore(rawScore, subject, await scalingReferences(), year) ?? { scaled: null, reason: "No VTAC scaling data for that subject, score or year." }
    })

  define("estimate_atar", "Estimate an ATAR from at least four Unit 3/4 studies including an English-group study. Give each study's raw score, or omit it to use the Focal prediction. Set save to keep the estimate in the account.", {
    year: z.number().int().optional().describe("VTAC report year; defaults to the latest"),
    studies: z.array(z.object({ study: z.string().min(1).describe("Study name or VTAC study code"), rawScore: z.number().min(0).max(50).optional() })).min(4).max(12),
    save: z.boolean().default(false),
  }, "write", async ({ year, studies, save }) => {
    const [{ data }, references, scaling] = await Promise.all([readAll(), gradeReferences(), scalingReferences()])
    const years = ATAR_AGGREGATE_REFERENCES.map((r) => r.year).filter((y) => scaling.some((s) => s.year === y)).toSorted((a, b) => b - a)
    const reportYear = year ?? years[0]
    const rows = studies.map((entry, index) => {
      const reference = scaling.find((s) => s.year === reportYear && (s.code === entry.study || normaliseScalingStudyName(s.studyName) === normaliseScalingStudyName(entry.study)))
      if (!reference) throw new Error(`No ${reportYear} VTAC scaling data for "${entry.study}". Use the exact study name or code.`)
      const predicted = entry.rawScore === undefined ? predictStudyScore({ subject: reference.studyName, attempts: data.attempts, references })?.studyScore : undefined
      const rawScore = entry.rawScore ?? predicted
      if (rawScore === undefined) throw new Error(`Give a rawScore for "${entry.study}"; it has no Focal prediction.`)
      return { reference, rawScore, usePrediction: entry.rawScore === undefined, id: String(index) }
    })
    const results = rows.flatMap((row): AtarStudyResult[] => {
      const scaledScore = interpolateScaledScore(row.rawScore, row.reference.points)
      return scaledScore === null ? [] : [{ id: row.id, code: row.reference.code, studyName: row.reference.studyName, rawScore: row.rawScore, scaledScore }]
    })
    const estimate = estimateAtar(results, reportYear)
    if (!estimate) throw new Error("Could not estimate: need four studies with scores from 20-50 and one English-group study.")
    if (save) {
      const saved: SavedAtarEstimate = {
        id: crypto.randomUUID(), year: reportYear, atarLabel: estimate.atarLabel, aggregate: estimate.aggregate, savedAt: nowIso(),
        rows: rows.map((row) => ({ id: crypto.randomUUID(), code: row.reference.code, raw: String(row.rawScore), usePrediction: row.usePrediction })),
      }
      await updateApp((current) => ({ ...current, atarEstimates: [saved, ...current.atarEstimates], atarEstimatesUpdatedAt: saved.savedAt }))
    }
    const brief = (r: { studyName: string; rawScore: number; scaledScore: number; contribution: number }) => ({ study: r.studyName, rawScore: r.rawScore, scaledScore: round(r.scaledScore), contribution: round(r.contribution) })
    return {
      year: reportYear, atar: estimate.atarLabel, aggregate: estimate.aggregate, primaryFour: estimate.primaryFour.map(brief),
      increments: estimate.increments.map(brief), excluded: estimate.excluded.map((r) => r.studyName), saved: save,
    }
  })

  define("list_atar_estimates", "Saved ATAR estimates, newest first.", {}, "read", async () => {
    const { data } = await readAll()
    return data.atarEstimates.toSorted((a, b) => b.savedAt.localeCompare(a.savedAt))
  })

  define("delete_atar_estimate", "Delete a saved ATAR estimate.", { id: z.string() }, "delete", async ({ id }) => {
    const stamp = nowIso()
    await updateApp((data) => ({ ...data, atarEstimates: data.atarEstimates.filter((e) => e.id !== id), atarEstimatesUpdatedAt: stamp }))
  })

  /* ---------------------------------------------------------- VCAA library */

  define("vcaa_grade_distribution", "Official VCAA grade distributions for a study: mark ranges per grade, share of students, and the mean. Use it to see what a mark means statewide.",
    { study: z.string().min(1), year: z.number().int().optional(), limit: z.number().int().min(1).max(30).default(10) }, "read", async ({ study, year, limit }) => {
      const references = (await gradeReferences()).filter((r) => contains(r.studyName, study) && (year === undefined || r.year === year))
        .toSorted((a, b) => b.year - a.year || a.name.localeCompare(b.name))
      return { total: references.length, distributions: references.slice(0, limit).map((r) => ({ id: r.id, study: r.studyName, year: r.year, assessment: r.name, maxScore: r.maxScore, sourceUrl: r.sourceUrl, stats: computeDistributionStats(r), gradeBands: r.gradeBands })) }
    })

  define("vcaa_exam_resources", "Official VCAA past exams for a study with their reports, and whether each is logged or marked completed in your account.",
    { study: z.string().min(1), year: z.number().int().optional(), limit }, "read", async ({ study, year, limit }) => {
      const [{ data }, studies] = await Promise.all([readAll(), examResources()])
      const matched = studies.filter((s) => contains(s.studyName, study))
      const exams = getCachedVcaaExams(matched).filter((e) => year === undefined || e.year === year).toSorted((a, b) => (b.year ?? 0) - (a.year ?? 0))
      return exams.slice(0, limit).map((exam) => ({
        study: exam.studyName, label: exam.label, year: exam.year, url: exam.url, logged: isVcaaExamLogged(exam, data.attempts), completed: data.completedExamIds.includes(exam.url),
        reports: getVcaaExamCompanions(exam, matched.find((s) => s.studyName === exam.studyName)).reports.map((r) => ({ label: r.label, url: r.url })),
      }))
    })

  define("vce_exam_timetable", "The official VCE exam timetable (dates, times, reading time) with which exams you track. Track one with set_exam_flag.",
    { subject: z.string().optional(), upcomingOnly: z.boolean().default(true), from: day.optional() }, "read", async ({ subject, upcomingOnly, from }) => {
      const [{ data }, timetable] = await Promise.all([readAll(), vceTimetable()])
      if (!timetable) return { year: null, exams: [] }
      const now = new Date()
      return {
        year: timetable.year, source: timetable.sourceUrl,
        exams: timetable.exams.filter((e) => (!subject || contains(e.subject, subject)) && (!upcomingOnly || isUpcoming(e, now)) && (!from || e.date >= from))
          .map((e) => ({ id: e.id, exam: formatExamLabel(e), date: e.date, dateEnd: e.dateEnd, time: formatExamTime(e), readingMinutes: e.readingMinutes, component: e.component, daysUntil: daysUntil(e, now), tracked: data.trackedExamIds.includes(e.id) })),
      }
    })
}
