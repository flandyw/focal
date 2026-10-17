import { z } from "zod"
import { defaultClassTimetable, classPeriodsOn, getDayLabelForDate, parseTimetableImport, subjectIdFor } from "../../src/lib/class-timetable"
import {
  analyseAttempt, findAttemptReference, formatExamTitle, getMistakeSchedule, MISTAKE_CATEGORIES, normalizeMistakeReviewPreferences,
  recordMistakeReview, reduceMistakeReviews, removeAttempt, validateAttempt, validateMistakeMarks, validateQuestionResults,
  type ExamAttempt, type Mistake, type QuestionResult,
} from "../../src/lib/exam-data"
import { isExamDifficultySettings, resolveDifficultySettings } from "../../src/lib/exam-difficulty"
import { parseExamProgression, previewProgressionImport, progressionBySubject } from "../../src/lib/exam-progression"
import { demoteGreens } from "../../src/lib/stoplight"
import { computeSacStats, isCompletedSac, sacPercentage, validateSac } from "../../src/lib/sac"
import type { CalendarEvent } from "../../src/lib/types"
import { gradeReferences, readAll, updateApp } from "./store"
import type { Define } from "./tools"
import { day, instant, limit, nowIso, required, round } from "./util"

const confidence = z.enum(["low", "medium", "high"])
const category = z.enum(MISTAKE_CATEGORIES)
const rating = z.enum(["again", "hard", "good", "easy"])
const text = (value: string | undefined) => value?.trim() || undefined

export function recordTools(define: Define) {
  /* ---------------------------------------------------------------- exams */

  define("list_exams", "List logged practice exam attempts, newest first, with percentage and the VCAA grade/percentile when a matching official distribution exists.",
    { subject: z.string().optional(), limit }, "read", async ({ subject, limit }) => {
      const [{ data }, references] = await Promise.all([readAll(), gradeReferences()])
      return data.attempts.filter((a) => !subject || a.subject.toLowerCase() === subject.toLowerCase())
        .toSorted((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, limit).map((attempt) => {
          const analysis = analyseAttempt(attempt, findAttemptReference(attempt, references))
          return {
            id: attempt.id, title: attempt.title, subject: attempt.subject, provider: attempt.provider, examYear: attempt.examYear,
            paper: attempt.paper, completedAt: attempt.completedAt, rawScore: attempt.rawScore, rawMax: attempt.rawMax,
            percentage: round(analysis.percentage), grade: analysis.grade, percentile: analysis.percentile === null ? null : round(analysis.percentile),
            questions: attempt.questionResults?.length ?? 0, comment: attempt.comment,
          }
        })
    })

  define("get_exam", "One exam attempt in full: question-by-question marks, timing, performance context, and the mistakes logged against it.",
    { id: z.string() }, "read", async ({ id }) => {
      const { data } = await readAll()
      const attempt = required(data.attempts.find((a) => a.id === id), "exam")
      return { attempt, mistakes: data.mistakes.filter((m) => m.attemptId === id).map((m) => ({ id: m.id, question: m.question, category: m.category, resolved: m.resolved })) }
    })

  define("save_exam", "Log a new practice exam, or update one when `id` is given (fields you omit are kept). Question results are optional but power the area-of-study analytics.", {
    id: z.string().optional(),
    subject: z.string().min(1), provider: z.string().min(1).describe("e.g. VCAA, Neap, Insight, or a school"),
    examYear: z.number().int().min(1990).max(2100), paper: z.string().min(1).describe("e.g. Exam 1"),
    completedAt: day, rawScore: z.number().min(0), rawMax: z.number().positive(), comment: z.string().optional(),
    questionResults: z.array(z.object({
      label: z.string().min(1), marksAwarded: z.number().min(0), maxMarks: z.number().positive(),
      areaOfStudy: z.string().optional(), confidence: confidence.optional(), examinerNote: z.string().optional(),
    })).max(200).optional(),
  }, "write", async (a) => {
    const id = a.id ?? crypto.randomUUID()
    const fresh = (a.questionResults ?? []).map(() => crypto.randomUUID())
    const timestamp = nowIso()
    const error = validateAttempt(a) ?? validateQuestionResults((a.questionResults ?? []).map((r, i) => ({ ...r, id: fresh[i], confidence: r.confidence ?? "medium" })))
    if (error) throw new Error(error)
    await updateApp((data) => {
      const old = data.attempts.find((item) => item.id === id)
      if (a.id && !old) throw new Error("No exam with that id.")
      const results: QuestionResult[] | undefined = a.questionResults?.map((r, i) => {
        const match = old?.questionResults?.find((q) => q.label === r.label)
        return { ...match, id: match?.id ?? fresh[i], label: r.label.trim(), marksAwarded: r.marksAwarded, maxMarks: r.maxMarks,
          areaOfStudy: text(r.areaOfStudy), confidence: r.confidence ?? match?.confidence ?? "medium", examinerNote: text(r.examinerNote) }
      })
      const next: ExamAttempt = {
        ...old, id, subject: a.subject.trim(), provider: a.provider.trim(), title: formatExamTitle(a.provider, a.examYear, a.subject),
        examYear: a.examYear, paper: a.paper.trim(), completedAt: a.completedAt, rawScore: a.rawScore, rawMax: a.rawMax,
        comment: a.comment === undefined ? old?.comment : text(a.comment), questionResults: results ?? old?.questionResults,
        referenceId: old?.referenceId ?? null, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp,
      }
      return { ...data, attempts: old ? data.attempts.map((item) => item.id === id ? next : item) : [...data.attempts, next] }
    })
    return { id }
  })

  define("delete_exam", "Delete an exam attempt AND every mistake logged against it.", { id: z.string() }, "delete", async ({ id }) => {
    await updateApp((data) => { required(data.attempts.find((a) => a.id === id), "exam"); return removeAttempt(data, id) })
  })

  define("set_exam_flag", "Tick or untick an exam in the VCAA library. `tracked`: id is a VCE exam-timetable entry id (see vce_exam_timetable) and adds it to the calendar/day plan. `completed`: id is a VCAA resource URL (see vcaa_exam_resources) marked done without logging a mark.",
    { list: z.enum(["tracked", "completed"]), id: z.string().min(1), on: z.boolean() }, "write", async ({ list, id, on }) => {
      const stamp = nowIso()
      const toggle = (ids: string[]) => on ? [...new Set([...ids, id])] : ids.filter((value) => value !== id)
      await updateApp((data) => list === "tracked"
        ? { ...data, trackedExamIds: toggle(data.trackedExamIds), trackedExamIdsUpdatedAt: stamp }
        : { ...data, completedExamIds: toggle(data.completedExamIds), completedExamIdsUpdatedAt: stamp })
    })

  /* ------------------------------------------------------------- mistakes */

  const mistakeView = (mistake: Mistake, attempts: ExamAttempt[]) => {
    const schedule = getMistakeSchedule(mistake)
    const attempt = attempts.find((a) => a.id === mistake.attemptId)
    return {
      id: mistake.id, attemptId: mistake.attemptId || null, subject: attempt?.subject, paper: attempt?.paper, question: mistake.question,
      questionText: mistake.questionText, category: mistake.category, explanation: mistake.explanation, correction: mistake.correction,
      totalMarks: mistake.totalMarks, marksLost: mistake.marksLost, areaOfStudy: mistake.areaOfStudy, itemIds: mistake.itemIds,
      state: schedule.state, dueAt: schedule.dueAt, intervalDays: schedule.intervalDays, lapses: schedule.lapses,
      reviews: mistake.reviewHistory?.length ?? 0, resolved: schedule.resolved, suspended: mistake.suspended ?? false, attachments: mistake.attachments?.length ?? 0,
    }
  }

  define("list_mistakes", "List mistake cards (the spaced-repetition revision queue). status: due = due for review now, open = not yet mastered, resolved, suspended, all.", {
    status: z.enum(["due", "open", "resolved", "suspended", "all"]).default("all"), subject: z.string().optional(), category: category.optional(),
    attemptId: z.string().optional(), search: z.string().optional(), limit,
  }, "read", async ({ status, subject, category, attemptId, search, limit }) => {
    const { data } = await readAll()
    const now = Date.now()
    const needle = search?.toLowerCase()
    const rows = data.mistakes.filter((mistake) => {
      const schedule = getMistakeSchedule(mistake)
      if (status === "suspended" ? !mistake.suspended : status !== "all" && mistake.suspended) return false
      if (status === "due" && Date.parse(schedule.dueAt) > now) return false
      if (status === "open" && schedule.resolved) return false
      if (status === "resolved" && !schedule.resolved) return false
      if (category && mistake.category !== category) return false
      if (attemptId !== undefined && mistake.attemptId !== attemptId) return false
      if (subject && data.attempts.find((a) => a.id === mistake.attemptId)?.subject.toLowerCase() !== subject.toLowerCase()) return false
      return !needle || [mistake.question, mistake.questionText, mistake.explanation, mistake.correction, mistake.areaOfStudy].some((field) => field?.toLowerCase().includes(needle))
    })
    const due = (m: Mistake) => getMistakeSchedule(m).dueAt
    rows.sort(status === "due" || status === "open" ? (a, b) => due(a).localeCompare(due(b)) : (a, b) => b.createdAt.localeCompare(a.createdAt))
    return { total: rows.length, mistakes: rows.slice(0, limit).map((m) => mistakeView(m, data.attempts)) }
  })

  const newMistake = z.object({
    attemptId: z.string().default("").describe("The exam attempt id, or empty for an uncategorised mistake"),
    question: z.string().min(1).describe("Short label, e.g. 'Q4b'"), questionText: z.string().min(1).describe("The question itself"),
    category, explanation: z.string().min(1).describe("What went wrong"), correction: z.string().min(1).describe("The improved response"),
    totalMarks: z.number().positive().optional(), marksLost: z.number().min(0).optional(),
    areaOfStudy: z.string().optional(), itemIds: z.array(z.string()).max(3).optional().describe("Stoplight item ids this mistake tests"),
  })

  define("add_mistakes", "Add one or more mistake cards. Each becomes due for review immediately. Marks must be given together or not at all. Linking a green stoplight item drops it to amber.",
    { mistakes: z.array(newMistake).min(1).max(50) }, "write", async ({ mistakes }) => {
      const ids = mistakes.map(() => crypto.randomUUID())
      const timestamp = nowIso()
      for (const m of mistakes) {
        if ((m.totalMarks === undefined) !== (m.marksLost === undefined)) throw new Error("Give both totalMarks and marksLost, or neither.")
        const error = m.totalMarks === undefined ? null : validateMistakeMarks(m.totalMarks, m.marksLost!)
        if (error) throw new Error(error)
      }
      await updateApp((data) => {
        const added: Mistake[] = mistakes.map((m, i) => ({
          id: ids[i], attemptId: m.attemptId, question: m.question.trim(), questionText: m.questionText.trim(), category: m.category,
          explanation: m.explanation.trim(), correction: m.correction.trim(), totalMarks: m.totalMarks, marksLost: m.marksLost,
          areaOfStudy: text(m.areaOfStudy), itemIds: m.itemIds?.length ? m.itemIds : undefined, itemsBy: m.itemIds?.length ? "user" : undefined,
          dueAt: timestamp, resolved: false, createdAt: timestamp, updatedAt: timestamp,
        }))
        return { ...data, mistakes: [...data.mistakes, ...added], learning: demoteGreens(data.learning, added).learning }
      })
      return { ids }
    })

  define("update_mistake", "Edit a mistake card; omitted fields are kept. Use `resolved` to mark it mastered or reopen it.", {
    id: z.string(), attemptId: z.string().optional(), question: z.string().min(1).optional(), questionText: z.string().optional(), category: category.optional(),
    explanation: z.string().min(1).optional(), correction: z.string().min(1).optional(), totalMarks: z.number().positive().optional(),
    marksLost: z.number().min(0).optional(), areaOfStudy: z.string().optional(), itemIds: z.array(z.string()).max(3).optional(), resolved: z.boolean().optional(),
  }, "write", async ({ id, ...patch }) => {
    const timestamp = nowIso()
    await updateApp((data) => {
      const old = required(data.mistakes.find((m) => m.id === id), "mistake")
      const next: Mistake = { ...old, updatedAt: timestamp }
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) (next as Record<string, unknown>)[key] = typeof value === "string" ? value.trim() : value
      if (patch.itemIds) { next.itemIds = patch.itemIds.length ? patch.itemIds : undefined; next.itemsBy = patch.itemIds.length ? "user" : undefined }
      const error = next.totalMarks === undefined && next.marksLost === undefined ? null : validateMistakeMarks(next.totalMarks ?? 0, next.marksLost ?? 0)
      if (error) throw new Error(error)
      const relinked = patch.itemIds && patch.itemIds.join() !== (old.itemIds ?? []).join() ? [next] : []
      return { ...data, mistakes: data.mistakes.map((m) => m.id === id ? next : m), learning: demoteGreens(data.learning, relinked).learning }
    })
  })

  define("delete_mistakes", "Delete mistake cards.", { ids: z.array(z.string()).min(1).max(100) }, "delete", async ({ ids }) => {
    const gone = new Set(ids)
    await updateApp((data) => ({ ...data, mistakes: data.mistakes.filter((m) => !gone.has(m.id)) }))
  })

  define("review_mistake", "Record a spaced-repetition review of a mistake card (again/hard/good/easy) and get its new schedule.",
    { id: z.string(), rating }, "write", async ({ id, rating }) => {
      const completedAt = nowIso()
      let reviewed: Mistake | undefined
      await updateApp((data) => {
        const old = required(data.mistakes.find((m) => m.id === id), "mistake")
        reviewed = recordMistakeReview(old, rating, completedAt, data.mistakeReviewPreferences, data.mistakes)
        return { ...data, mistakes: data.mistakes.map((m) => m.id === id ? reviewed! : m) }
      })
      const schedule = getMistakeSchedule(reviewed!)
      return { state: schedule.state, dueAt: schedule.dueAt, intervalDays: schedule.intervalDays, resolved: schedule.resolved }
    })

  define("set_mistakes_suspended", "Pause cards (take them out of the review queue) or return them to it.",
    { ids: z.array(z.string()).min(1).max(200), suspended: z.boolean() }, "write", async ({ ids, suspended }) => {
      const chosen = new Set(ids)
      const updatedAt = nowIso()
      await updateApp((data) => ({ ...data, mistakes: data.mistakes.map((m) => chosen.has(m.id) ? { ...m, suspended, updatedAt } : m) }))
    })

  define("reduce_review_load", "Postpone reviews due in the next `days` days so no day exceeds `dailyTarget` cards (0 = push them all past the window). Reviews are only ever delayed.",
    { days: z.number().int().min(1).max(90), dailyTarget: z.number().int().min(0).max(100) }, "write", async ({ days, dailyTarget }) => {
      const updatedAt = nowIso()
      let moved = 0
      await updateApp((data) => {
        const changes = reduceMistakeReviews(data.mistakes, days, dailyTarget)
        moved = changes.size
        return { ...data, mistakes: data.mistakes.map((m) => changes.has(m.id) ? { ...m, dueAt: changes.get(m.id), updatedAt } : m) }
      })
      return { postponed: moved }
    })

  /* ----------------------------------------------------------------- SACs */

  define("list_sacs", "List SACs (school assessed coursework) with percentages, plus overall and per-status stats.",
    { subject: z.string().optional(), status: z.enum(["upcoming", "completed", "all"]).default("all") }, "read", async ({ subject, status }) => {
      const { data } = await readAll()
      const records = data.sacRecords.filter((r) => (!subject || r.subject.toLowerCase() === subject.toLowerCase()) &&
        (status === "all" || isCompletedSac(r) === (status === "completed"))).toSorted((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      return { stats: computeSacStats(data.sacRecords), sacs: records.map((r) => ({ ...r, percentage: sacPercentage(r) === null ? null : round(sacPercentage(r)!) })) }
    })

  define("save_sac", "Plan a SAC, log its result, or update one when `id` is given. Give score and maxScore together once it is marked.", {
    id: z.string().optional(), subject: z.string().min(1), provider: z.string().min(1).describe("School or practice provider"), title: z.string().min(1),
    sacNumber: z.string().optional(), unit: z.number().int().min(1).max(4), areaOfStudy: z.string().optional(), scheduledAt: instant,
    durationMinutes: z.number().positive(), score: z.number().min(0).optional(), maxScore: z.number().positive().optional(),
    weighting: z.number().min(0).max(100).optional(), notes: z.string().optional(),
  }, "write", async (a) => {
    const id = a.id ?? crypto.randomUUID()
    const timestamp = nowIso()
    const candidate = { subject: a.subject.trim(), provider: a.provider.trim(), title: a.title.trim(), unit: a.unit as 1 | 2 | 3 | 4,
      scheduledAt: a.scheduledAt, durationMinutes: a.durationMinutes, score: a.score, maxScore: a.maxScore, weighting: a.weighting }
    const error = validateSac(candidate)
    if (error) throw new Error(error)
    await updateApp((data) => {
      const old = data.sacRecords.find((r) => r.id === id)
      if (a.id && !old) throw new Error("No SAC with that id.")
      const record = { ...old, id, ...candidate, sacNumber: text(a.sacNumber), areaOfStudy: text(a.areaOfStudy), notes: text(a.notes),
        completedAt: a.score !== undefined ? old?.completedAt ?? a.scheduledAt : undefined, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp }
      return { ...data, sacRecords: old ? data.sacRecords.map((r) => r.id === id ? record : r) : [...data.sacRecords, record], sacRecordsUpdatedAt: timestamp }
    })
    return { id }
  })

  define("delete_sac", "Delete a SAC.", { id: z.string() }, "delete", async ({ id }) => {
    const stamp = nowIso()
    await updateApp((data) => { required(data.sacRecords.find((r) => r.id === id), "SAC"); return { ...data, sacRecords: data.sacRecords.filter((r) => r.id !== id), sacRecordsUpdatedAt: stamp } })
  })

  /* --------------------------------------------------------------- events */

  define("list_events", "List calendar events (SACs, exams, assignments, homework, other) in a date range.",
    { from: day.optional(), to: day.optional(), limit }, "read", async ({ from, to, limit }) => {
      const { data } = await readAll()
      return data.events.filter((e) => (!from || e.startTime.slice(0, 10) >= from) && (!to || e.startTime.slice(0, 10) <= to))
        .toSorted((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, limit)
    })

  define("save_event", "Create a calendar event, or update one when `id` is given.", {
    id: z.string().optional(), title: z.string().min(1), startTime: instant, endTime: instant.optional(),
    eventType: z.enum(["event", "sac", "practice-sac", "exam", "assignment", "homework", "other"]).default("event"),
    subject: z.string().optional(), description: z.string().optional(), location: z.string().optional(), isFinished: z.boolean().optional(),
  }, "write", async (a) => {
    const id = a.id ?? crypto.randomUUID()
    const timestamp = nowIso()
    if (a.endTime && Date.parse(a.endTime) <= Date.parse(a.startTime)) throw new Error("The end must be after the start.")
    await updateApp((data) => {
      const old = data.events.find((e) => e.id === id)
      if (a.id && !old) throw new Error("No event with that id.")
      const finished = a.isFinished ?? old?.isFinished ?? false
      const event: CalendarEvent = {
        ...old, id, title: a.title.trim(), startTime: a.startTime, endTime: a.endTime ?? old?.endTime, eventType: a.eventType,
        description: a.description === undefined ? old?.description : text(a.description), location: a.location === undefined ? old?.location : text(a.location),
        subjectId: a.subject === undefined ? old?.subjectId : a.subject.trim() ? subjectIdFor(a.subject) : undefined,
        isFinished: finished, finishedAt: finished ? old?.finishedAt ?? timestamp : undefined, created_at: old?.created_at ?? timestamp, updated_at: timestamp,
      }
      return { ...data, events: old ? data.events.map((e) => e.id === id ? event : e) : [...data.events, event] }
    })
    return { id }
  })

  define("delete_event", "Delete a calendar event.", { id: z.string() }, "delete", async ({ id }) => {
    await updateApp((data) => { required(data.events.find((e) => e.id === id), "event"); return { ...data, events: data.events.filter((e) => e.id !== id) } })
  })

  /* ------------------------------------------------------------ timetable */

  define("get_class_timetable", "The school class timetable (day cycle, holidays, periods) and what is on for a date.",
    { date: day.optional().describe("Defaults to today") }, "read", async ({ date }) => {
      const { data } = await readAll()
      const config = data.classTimetable
      if (!config) return { configured: false }
      const on = date ?? new Date().toLocaleDateString("en-CA")
      const [y, m, d] = on.split("-").map(Number)
      return { configured: true, config, date: on, dayLabel: getDayLabelForDate(new Date(y, m - 1, d), config.day1Starts, config.holidays, config.cycleLength, config.weekendTimetables), periods: classPeriodsOn(on, config) }
    })

  define("import_class_timetable", "Replace the class timetable from JSON in Focal's timetable import format (read the focal://formats/timetable resource for the exact format). Invalid input is rejected with the reason.",
    { json: z.string().min(2).describe("The timetable JSON, as a string") }, "write", async ({ json }) => {
      await updateApp((data) => ({ ...data, classTimetable: parseTimetableImport(json, "timetable.json", data.classTimetable ?? defaultClassTimetable()) }))
    })

  /* ------------------------------------------------------------- settings */

  define("get_settings", "Account settings: subjects, study preferences, review pacing, exam-difficulty weighting, and the exam progression plan with the next paper per subject.", {}, "read", async () => {
    const { data } = await readAll()
    return {
      subjects: data.subjects, studyPreferences: data.learning.preferences,
      reviewPreferences: normalizeMistakeReviewPreferences(data.mistakeReviewPreferences), examDifficulty: resolveDifficultySettings(data.examDifficulty),
      examProgression: data.examProgression && { name: data.examProgression.name, papers: data.examProgression.exams.length, bySubject: progressionBySubject(data.examProgression, data.attempts) },
      classTimetableConfigured: Boolean(data.classTimetable),
    }
  })

  define("update_settings", "Change settings; only the groups you pass are changed. Dates are weekdays 0 (Sun) to 6 (Sat). `lighterUntil` paces reviews at `lighterDailyTarget` a day until that time (null clears it).", {
    subjects: z.array(z.string().min(1)).max(40).optional().describe("Your subjects, in priority order"),
    studyPreferences: z.object({ dailyMinutes: z.number().int().min(5).max(1440), studyDays: z.array(z.number().int().min(0).max(6)).max(7) }).partial().optional(),
    reviewPreferences: z.object({
      spacingMultiplier: z.number().min(0.5).max(3), retryHours: z.number().min(1 / 6).max(168), maximumIntervalDays: z.number().int().min(7).max(365),
      lighterUntil: instant.nullable(), lighterDailyTarget: z.number().int().min(0).max(100),
    }).partial().optional(),
    examDifficulty: z.object({ enabled: z.boolean(), providerOrder: z.array(z.string()), strength: z.enum(["light", "balanced", "strong"]) }).partial().optional(),
  }, "write", async ({ subjects, studyPreferences, reviewPreferences, examDifficulty }) => {
    const stamp = nowIso()
    await updateApp((data) => {
      let next = data
      if (subjects) next = { ...next, subjects: [...new Set(subjects.map((s) => s.trim()))], subjectsUpdatedAt: stamp }
      if (studyPreferences) {
        const preferences = { ...next.learning.preferences, ...studyPreferences, studyDays: [...new Set(studyPreferences.studyDays ?? next.learning.preferences.studyDays)] }
        next = { ...next, learning: { ...next.learning, preferences, preferencesUpdatedAt: stamp, updatedAt: stamp } }
      }
      if (reviewPreferences) {
        const { lighterUntil, ...rest } = reviewPreferences
        next = { ...next, mistakeReviewPreferences: normalizeMistakeReviewPreferences({ ...normalizeMistakeReviewPreferences(next.mistakeReviewPreferences), ...rest,
          ...(lighterUntil === undefined ? {} : { lighterUntil: lighterUntil ?? undefined }), updatedAt: stamp }) }
      }
      if (examDifficulty) {
        const settings = { ...resolveDifficultySettings(next.examDifficulty), ...examDifficulty, updatedAt: stamp }
        if (!isExamDifficultySettings(settings)) throw new Error("Invalid exam difficulty settings.")
        next = { ...next, examDifficulty: settings }
      }
      return next
    })
  })

  define("import_exam_progression", "Set the practice-exam progression plan (the order each subject's papers should be done in) from JSON; read focal://formats/progression for the format. mode append adds new papers, replace-subjects replaces the plan for the subjects included.",
    { json: z.string().min(2), mode: z.enum(["append", "replace-subjects"]).default("append") }, "write", async ({ json, mode }) => {
      const stamp = nowIso()
      let summary = {}
      await updateApp((data) => {
        const incoming = parseExamProgression(json)
        const result = previewProgressionImport(data.examProgression ?? { name: incoming.name, exams: [] }, incoming, mode)
        summary = { added: result.added, removed: result.removed, skipped: result.skipped, subjects: result.subjects }
        return { ...data, examProgression: { version: 1, name: result.name, exams: result.exams, updatedAt: stamp } }
      })
      return summary
    })
}
