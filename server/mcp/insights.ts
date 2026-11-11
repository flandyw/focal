import { sameStudySubject } from "../../src/lib/studySubjects.js"
import { currentSubjectWork, isCurrentSubject } from "../../src/lib/subject-completion.js"
import { z } from "zod"
import { atarYears, buildAtarModel, type AtarModel } from "../../src/lib/atar-model.js"
import { buildDayPlan } from "../../src/lib/day-plan.js"
import {
  buildAttemptBenchmarks, buildCoverage, buildSubjectBenchmarks, computeDistributionStats, normaliseComparisonName, type AppData, type AssessmentReference, type SavedAtarEstimate, type AtarEstimatorRow,
} from "../../src/lib/exam-data.js"
import { getAttemptMathsPaper } from "../../src/lib/mistake-filters.js"
import { buildExamSuggestions } from "../../src/lib/exam-suggestions.js"
import { getGoalProgress, localDate } from "../../src/lib/learning-workspace.js"
import { getMistakeProgress, getMistakeQueueCounts, buildRevisionPriorities } from "../../src/lib/mistake-review.js"
import { buildFocusPriorities, buildLostMarksAttribution, buildPaperDataQuality, buildPaperWeaknessMatrix, buildReviewForecast, buildSubjectOutlooks, type MatrixGrouping } from "../../src/lib/performance-insights.js"
import { getAnalyticsData } from "../../src/lib/progress-analytics.js"
import { analyticsSessions } from "../../src/lib/progress-utils.js"
import { getUpcomingSacs } from "../../src/lib/sac.js"
import { normaliseScalingStudyName, predictScaledStudyScore } from "../../src/lib/scaling.js"
import { buildStudyScoreTrend, predictStudyScore } from "../../src/lib/study-score.js"
import { daysUntil, formatExamLabel, formatExamTime, isUpcoming } from "../../src/lib/timetable.js"
import { isPaused, isRunning, isPlanned } from "../../src/lib/sync/sessionContract.js"
import { getCachedVcaaExams, isExamDone, getVcaaExamCompanions, isVcaaExamLogged } from "../../src/lib/vcaa-resources.js"
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

/** The shared ATAR model in the shape MCP clients get. */
function atarModelSummary(model: AtarModel) {
  const estimate = model.estimate!
  const counted = (role: string) => model.rows.filter((r) => role === "Increment" ? r.role === role : r.role === "English" || r.role === "Primary")
    .map((r) => ({ study: r.study!.studyName, rawScore: r.rawScore!, scaledScore: round(r.scaledScore!), contribution: round(r.contribution) }))
  return {
    year: model.year, atar: estimate.atarLabel, aggregate: estimate.aggregate,
    sources: model.rows.map((r) => ({ study: r.study?.studyName ?? r.row.code, source: r.source === "focal" ? "Focal estimate" : "Manual", ...(r.source === "focal" && r.prediction ? { low: r.prediction.low, high: r.prediction.high, confidence: r.prediction.confidence } : {}) })),
    primaryFour: counted("Primary"), increments: counted("Increment"), excluded: estimate.excluded.map((r) => r.studyName),
    sensitivity: model.rows.flatMap((r) => r.sensitivity ? [{ study: r.study!.studyName, aggregatePerRawMark: r.sensitivity.aggregate, atarPerRawMark: r.sensitivity.atar }] : []).toSorted((a, b) => b.aggregatePerRawMark - a.aggregatePerRawMark),
    range: model.range && { low: model.range.low, high: model.range.high },
    target: model.target, gap: model.gap, targetAggregate: model.targetAggregate, aggregateGap: model.aggregateGap,
  }
}

export function insightTools(define: Define) {
  define("get_overview", "Start here. A snapshot of the whole account: queue and counts, today's plan, running timer, upcoming SACs, events and tracked VCE exams, goal progress and predicted study scores.", {}, "read", async () => {
    const [{ data, sessions }, references, timetable, scaling] = await Promise.all([readAll(), gradeReferences(), vceTimetable(), scalingReferences()])
    const now = new Date()
    const today = localDate(now)
    const plan = buildDayPlan(today, { ...currentSubjectWork(data), sessions: sessions.filter((session) => !isPlanned(session) || !data.completedSubjects.some((subject) => sameStudySubject(session.subject_id, subject))) }, timetable && { ...timetable, exams: timetable.exams.filter((exam) => !data.completedSubjects.some((subject) => sameStudySubject(exam.subject, subject))) })
    const current = currentSubjectWork(data)
    const running = sessions.find((s) => isRunning(s) || isPaused(s))
    const tracked = new Set(data.trackedExamIds)
    return {
      today, counts: { exams: data.attempts.length, mistakes: data.mistakes.length, sacs: data.sacRecords.length, subjects: current.subjects },
      mistakeQueue: getMistakeQueueCounts(current.mistakes), mistakeProgress: getMistakeProgress(data.mistakes),
      timer: running && { id: running.id, title: running.title, state: isRunning(running) ? "running" : "paused" },
      todayPlan: { plannedMinutes: plan.plannedMinutes, completedMinutes: plan.completedMinutes, dueMistakes: plan.dueMistakes, items: plan.items.map((i) => ({ kind: i.kind, title: i.title, minutes: i.minutes })) },
      upcomingSacs: getUpcomingSacs(current.sacRecords).slice(0, 5).map((r) => ({ id: r.id, title: r.title, subject: r.subject, scheduledAt: r.scheduledAt })),
      upcomingEvents: current.events.filter((e) => !e.isFinished && Date.parse(e.startTime) >= now.getTime()).toSorted((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)).slice(0, 5)
        .map((e) => ({ id: e.id, title: e.title, type: e.eventType, startTime: e.startTime })),
      trackedVceExams: (timetable?.exams ?? []).filter((e) => isCurrentSubject(data, e.subject) && tracked.has(e.id) && isUpcoming(e, now)).slice(0, 10).map((e) => ({ id: e.id, exam: formatExamLabel(e), date: e.date, daysUntil: daysUntil(e, now) })),
      goals: current.learning.goals.filter((g) => !g.archivedAt).map((goal) => ({ id: goal.id, kind: goal.kind, subject: goal.subject, deadline: goal.deadline, ...getGoalProgress(goal, data, references, scaling) })),
      studyScores: [...new Set(data.attempts.filter((a) => isCurrentSubject(data, a.subject)).map((a) => a.subject))].flatMap((subject) => {
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
      return buildExamSuggestions(data.attempts.filter((attempt) => isCurrentSubject(data, attempt.subject)), references.filter((reference) => isCurrentSubject(data, reference.studyName)), currentSubjectWork(data).subjects, limit, studies.filter((study) => isCurrentSubject(data, study.studyName)))
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

  define("estimate_atar", "Estimate an ATAR from at least four Unit 3/4 studies including an English-group study, using the same model as the app's ATAR page. Give each study's raw score, or omit it to use the Focal prediction. Returns each study's raw → scaled → contribution and role, the ATAR change from +1 raw per study (sensitivity), the likely range from Focal estimate ranges, and the gap to the ATAR goal. Set save to keep the estimate in the account.", {
    year: z.number().int().optional().describe("VTAC report year; defaults to the latest"),
    studies: z.array(z.object({ study: z.string().min(1).describe("Study name or VTAC study code"), rawScore: z.number().int().min(20).max(50).optional() })).min(4).max(12),
    save: z.boolean().default(false),
  }, "write", async ({ year, studies, save }) => {
    const [{ data }, references, scaling] = await Promise.all([readAll(), gradeReferences(), scalingReferences()])
    const reportYear = year ?? atarYears(scaling)[0]
    const rows: AtarEstimatorRow[] = studies.map((entry) => {
      const reference = scaling.find((s) => s.code === entry.study || normaliseScalingStudyName(s.studyName) === normaliseScalingStudyName(entry.study))
      if (!reference) throw new Error(`No VTAC scaling data in any year for "${entry.study}". Use the exact study name or code.`)
      return { id: crypto.randomUUID(), code: reference.code, raw: entry.rawScore === undefined ? "" : String(entry.rawScore), usePrediction: entry.rawScore === undefined }
    })
    const model = buildAtarModel({ data, references, scaling, rows, year: reportYear })
    for (const [index, item] of model.rows.entries()) {
      if (item.issue === "no-estimate") throw new Error(`Give a rawScore for "${studies[index].study}"; log a practice paper with valid marks and a matching grade distribution (one usable result is enough), or supply a whole manual score from 20 to 50.`)
      if (item.issue) throw new Error(`No published scaling for ${item.study?.studyName ?? studies[index].study}`)
    }
    const estimate = model.estimate
    if (!estimate) throw new Error("Could not estimate: need four studies with scores from 20-50 and one English-group study.")
    if (save) {
      const saved: SavedAtarEstimate = { id: crypto.randomUUID(), year: reportYear, atarLabel: estimate.atarLabel, aggregate: estimate.aggregate, savedAt: nowIso(), rows }
      await updateApp((current) => ({ ...current, atarEstimates: [saved, ...current.atarEstimates], atarEstimatesUpdatedAt: saved.savedAt }))
    }
    return { ...atarModelSummary(model), saved: save }
  })

  define("list_atar_estimates", "Saved ATAR estimates, newest first, each with `live`: the scenario recalculated with current scores (null when it no longer forms an estimate), as the app's ATAR page, goals and widgets show it.", {}, "read", async () => {
    const [{ data }, references, scaling] = await Promise.all([readAll(), gradeReferences(), scalingReferences()])
    return data.atarEstimates.toSorted((a, b) => b.savedAt.localeCompare(a.savedAt)).map((saved) => {
      const live = buildAtarModel({ data, references, scaling, rows: saved.rows, year: saved.year })
      return { ...saved, live: live.estimate ? { atar: live.estimate.atarLabel, aggregate: live.estimate.aggregate, gap: live.gap } : null }
    })
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
        study: exam.studyName, label: exam.label, year: exam.year, url: exam.url, logged: isVcaaExamLogged(exam, data.attempts), completed: isExamDone(exam.url, { ...data, exam }),
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
        exams: timetable.exams.filter((e) => (isCurrentSubject(data, e.subject) || !upcomingOnly) && (!subject || contains(e.subject, subject)) && (!upcomingOnly || isUpcoming(e, now)) && (!from || e.date >= from))
          .map((e) => ({ id: e.id, exam: formatExamLabel(e), date: e.date, dateEnd: e.dateEnd, time: formatExamTime(e), readingMinutes: e.readingMinutes, component: e.component, daysUntil: daysUntil(e, now), tracked: data.trackedExamIds.includes(e.id) })),
      }
    })
}
