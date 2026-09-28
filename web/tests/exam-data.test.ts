import { describe, expect, test } from "bun:test"
import { analyseAttempt, analyseScore, buildAttemptBenchmarks, buildCoverage, buildSubjectBenchmarks, buildVcaaYearInsights, computeDistributionStats, EMPTY_APP_DATA, findAttemptReferenceForYear, formatExamTitle, formatOrdinal, getAttemptPoints, getDueMistakes, getMistakeSchedule, isAppData, matchesAttemptReference, migrateAppData, previewMistakeReview, recordMistakeReview, removeAttempt, validateAttempt, validateMistakeMarks, type AssessmentReference, type ExamAttempt, type Mistake } from "../src/lib/exam-data"
import { parseAppDataFile } from "../src/lib/storage"
import { buildTimetableCalendar, suggestTimetableForAttempt, type Timetable, type TimetableEntry } from "../src/lib/timetable"

const reference: AssessmentReference = {
  id: "METHODS:2025:GA-2",
  studyCode: "METHODS",
  studyName: "Mathematical Methods",
  displayName: "Mathematical Methods",
  year: 2025,
  gaCode: "GA 2",
  name: "WRITTEN EXAMINATION 1",
  maxScore: 80,
  sourceUrl: "https://example.test",
  gradeBands: [
    { grade: "C", minScore: 0, maxScore: 39, count: 40, percentage: 40, sortOrder: 0 },
    { grade: "B", minScore: 40, maxScore: 59, count: 30, percentage: 30, sortOrder: 1 },
    { grade: "A", minScore: 60, maxScore: 80, count: 30, percentage: 30, sortOrder: 2 },
  ],
}

const attempt: ExamAttempt = {
  id: "attempt-1",
  subject: "Mathematical Methods",
  provider: "VCAA",
  title: "VCAA 2025 Mathematical Methods",
  examYear: 2025,
  paper: "Exam 1",
  completedAt: "2026-07-11",
  rawScore: 32,
  rawMax: 40,
  referenceId: reference.id,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
}

describe("exam analysis", () => {
  test("formats percentile ordinals correctly", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 71].map(formatOrdinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "71st"])
  })

  test("derives exam titles from provider, year, and subject", () => {
    expect(formatExamTitle("VCAA", 2025, "Mathematical Methods")).toBe("VCAA 2025 Mathematical Methods")
  })

  test("uses the selected VCAA comparison year instead of the attempt year", () => {
    const reference2024 = { ...reference, id: "METHODS:2024:GA-2", year: 2024 }
    expect(findAttemptReferenceForYear(attempt, [reference, reference2024], 2024)).toBe(reference2024)
    expect(findAttemptReferenceForYear(attempt, [reference], 2024)).toBeUndefined()
  })

  test("automatically matches every single-paper subject and keeps multi-paper matches exact", () => {
    const english = { ...reference, id: "ENGLISH:2025:GA-3", studyName: "English", name: "WRITTEN EXAMINATION" }
    expect(findAttemptReferenceForYear({ ...attempt, subject: "English", paper: "Practice paper" }, [english], 2025)).toBe(english)
    expect(findAttemptReferenceForYear({ ...attempt, paper: "Exam 2" }, [reference, { ...reference, id: "METHODS:2025:GA-3", name: "WRITTEN EXAMINATION 2" }], 2025)?.name).toBe("WRITTEN EXAMINATION 2")
  })

  test("scales raw marks and estimates a percentile inside the official band", () => {
    const result = analyseAttempt(attempt, reference)
    expect(result.scaledScore).toBe(64)
    expect(result.percentage).toBe(80)
    expect(result.grade).toBe("A")
    expect(result.percentile).toBeCloseTo(76, 0)
    expect(analyseScore(39.6, reference)).toEqual({ grade: "B", percentile: 40 })
  })

  test("validates score boundaries", () => {
    expect(validateAttempt({ rawScore: 41, rawMax: 40 })).toBe("Mark cannot exceed the maximum.")
    expect(validateAttempt({ rawScore: 40, rawMax: 40 })).toBeNull()
  })

  test("validates mistake marks", () => {
    expect(validateMistakeMarks(4, 1)).toBeNull()
    expect(validateMistakeMarks(0, 0)).toBe("Total marks must be greater than zero.")
    expect(validateMistakeMarks(4, 5)).toBe("Marks lost cannot exceed total marks.")
  })

  test("builds chart points and cascades attempt deletion", () => {
    const second = { ...attempt, id: "attempt-2", rawScore: 20 }
    expect(getAttemptPoints([attempt, second], reference)).toHaveLength(2)
    expect(getAttemptPoints([attempt], { ...reference, id: "METHODS:2024:GA-2", year: 2024 })).toHaveLength(1)
    expect(getAttemptPoints([{ ...attempt, paper: "Exam 2" }], reference)).toHaveLength(0)
    expect(getAttemptPoints([{ ...attempt, subject: "Specialist Mathematics" }], reference)).toHaveLength(0)
    expect(matchesAttemptReference({ ...attempt, referenceId: null }, reference)).toBe(true)
    const data = {
      schemaVersion: 1 as const,
      attempts: [attempt, second],
      mistakes: [{
        id: "mistake-1",
        attemptId: attempt.id,
        question: "1a",
        category: "Concept" as const,
        explanation: "Error",
        correction: "Fix",
        resolved: false,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      }],
    }
    expect(removeAttempt(data, attempt.id)).toEqual({ schemaVersion: 1, attempts: [second], mistakes: [] })
  })

  test("estimates the median from cumulative grade-band percentages", () => {
    expect(computeDistributionStats(reference).median).toBeCloseTo(46.33, 2)
  })

  test("builds year insights with official cohort and A+ cutoff data", () => {
    const insights = buildVcaaYearInsights([
      reference,
      { ...reference, id: "METHODS:2024:GA-2", year: 2024 },
    ], 80)
    expect(insights.map((item) => item.year)).toEqual([2024, 2025])
    expect(insights[1]).toMatchObject({ cohortSize: 100, grade: "A", percentile: 76 })
    expect(insights[1].aPlusCutoffPercentage).toBeNull()
  })

  test("builds shared VCAA attempt and subject benchmarks", () => {
    const withAPlus = {
      ...reference,
      gradeBands: [
        ...reference.gradeBands,
        { grade: "A+", minScore: 72, maxScore: 80, count: 10, percentage: 10, sortOrder: 3 },
      ],
    }
    const second = { ...attempt, id: "attempt-2", rawScore: 30, completedAt: "2026-07-12" }
    const attemptBenchmarks = buildAttemptBenchmarks([attempt, second], [withAPlus])
    expect(attemptBenchmarks).toHaveLength(2)
    expect(attemptBenchmarks[0]).toMatchObject({ percentage: 80, aPlusCutoffPercentage: 90, gapToAPlus: -10 })

    expect(buildSubjectBenchmarks([attempt, second], [withAPlus])).toEqual([
      expect.objectContaining({
        subject: "Mathematical Methods",
        attemptCount: 2,
        linkedCount: 2,
        averageMark: 77.5,
        bestMark: 80,
        latestMark: 75,
        aPlusCutoffPercentage: 90,
      }),
    ])
  })

  test("rejects malformed imports", () => {
    expect(() => parseAppDataFile('{"schemaVersion":2}')).toThrow("valid ExamTrack")
    const data = {
      ...EMPTY_APP_DATA,
      attempts: [attempt],
    }
    expect(isAppData(data)).toBe(true)
    expect(isAppData({ ...data, attempts: [{ ...attempt, performanceContext: { sleepHours: 7.5, focus: 4, stress: 2 } }] })).toBe(true)
    expect(isAppData({ ...data, attempts: [{ ...attempt, performanceContext: { preparedness: 8 } }] })).toBe(false)
    expect(parseAppDataFile(JSON.stringify(data))).toEqual(data)
  })

  test("migrates v1 AppData to v5 with empty tracking and learning collections", () => {
    const v1 = {
      schemaVersion: 1 as const,
      attempts: [attempt],
      mistakes: [],
    }
    const migrated = migrateAppData(v1)
    expect(migrated?.schemaVersion).toBe(5)
    expect(migrated?.trackedExamIds).toEqual([])
    expect(migrated?.sacRecords).toEqual([])
    expect(migrated?.attempts).toHaveLength(1)
    expect(migrated?.learning.tasks).toEqual([])
  })

  test("migrates v3 exports to v5 without losing exam data", () => {
    const migrated = migrateAppData({
      schemaVersion: 3,
      attempts: [attempt],
      mistakes: [],
      subjects: [],
      subjectsUpdatedAt: "1970-01-01T00:00:00.000Z",
      trackedExamIds: [],
      trackedExamIdsUpdatedAt: "1970-01-01T00:00:00.000Z",
      completedExamIds: [],
      completedExamIdsUpdatedAt: "1970-01-01T00:00:00.000Z",
    })
    expect(migrated).toMatchObject({ schemaVersion: 5, sacRecords: [], attempts: [attempt], learning: { tasks: [], goals: [] } })
  })

  test("backfills the provider on early v4 SAC records", () => {
    const migrated = migrateAppData({
      schemaVersion: 4,
      attempts: [attempt],
      mistakes: [],
      sacRecords: [{
        id: "sac-legacy",
        subject: "Mathematical Methods",
        title: "Functions SAC",
        unit: 3,
        scheduledAt: "2026-08-01",
        durationMinutes: 50,
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z",
      }],
      sacRecordsUpdatedAt: "2026-07-28T00:00:00.000Z",
      subjects: [],
      subjectsUpdatedAt: "1970-01-01T00:00:00.000Z",
      trackedExamIds: [],
      trackedExamIdsUpdatedAt: "1970-01-01T00:00:00.000Z",
      completedExamIds: [],
      completedExamIdsUpdatedAt: "1970-01-01T00:00:00.000Z",
    })
    expect(migrated?.sacRecords[0]).toMatchObject({ provider: "School", title: "Functions SAC" })
  })

  test("rejects v2 AppData missing trackedExamIds and back-fills via migration", () => {
    const v2Incomplete = {
      schemaVersion: 2,
      attempts: [attempt],
      mistakes: [],
    }
    expect(isAppData(v2Incomplete)).toBe(false)
    const migrated = migrateAppData(v2Incomplete)
    expect(migrated?.trackedExamIds).toEqual([])
  })

  test("migrates v2 AppData with a non-empty trackedExamIds array", () => {
    const v2 = {
      schemaVersion: 2 as const,
      attempts: [attempt],
      mistakes: [],
      trackedExamIds: ["2026-11-05-mathematical-methods-exam-1"],
    }
    expect(migrateAppData(v2)?.trackedExamIds).toEqual(["2026-11-05-mathematical-methods-exam-1"])
  })

  test("accepts old mistakes without question text and validates new question text", () => {
    const mistake = {
      id: "mistake-1",
      attemptId: attempt.id,
      question: "Question 4b",
      category: "Concept" as const,
      explanation: "Missed the chain rule",
      correction: "Apply the chain rule",
      resolved: false,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    }
    const data = { ...EMPTY_APP_DATA, attempts: [attempt], mistakes: [mistake] }

    expect(isAppData(data)).toBe(true)
    expect(isAppData({ ...data, mistakes: [{ ...mistake, questionText: "Differentiate $e^{2x}$." }] })).toBe(true)
    expect(isAppData({ ...data, mistakes: [{ ...mistake, attachments: [{ id: "image-1", name: "graph.png", type: "image/png", size: 2048, storagePath: "user-1/mistake-1/image-1.png" }] }] })).toBe(true)
    expect(isAppData({ ...data, mistakes: [{ ...mistake, attachments: [{ id: "image-1", name: "graph.png", type: "image/png", size: "large", storagePath: "user-1/mistake-1/image-1.png" }] }] })).toBe(false)
    expect(isAppData({ ...data, mistakes: [{ ...mistake, reviewState: "review", intervalDays: 8, easeFactor: 2.5, repetitions: 2, lapses: 1, lastReviewedAt: attempt.updatedAt, suspended: false }] })).toBe(true)
    expect(isAppData({ ...data, mistakes: [{ ...mistake, questionText: 42 }] })).toBe(false)
    expect(isAppData({ ...data, mistakes: [{ ...mistake, reviewState: "forgotten" }] })).toBe(false)
    const alternativeMistakeDeck = {
      cards: [{ sourceMistakeId: mistake.id, skill: "Chain rule", question: "Differentiate $e^{3x}$.", answer: "$3e^{3x}$", marks: 2, generatedAt: attempt.updatedAt }],
      updatedAt: attempt.updatedAt,
    }
    expect(isAppData({ ...data, alternativeMistakeDeck })).toBe(true)
    expect(isAppData({ ...data, alternativeMistakeDeck: { ...alternativeMistakeDeck, cards: [{ ...alternativeMistakeDeck.cards[0], marks: 0 }] } })).toBe(false)
  })

  test("builds outcome coverage and schedules Anki-style mistake reviews", () => {
    expect(buildCoverage([{ ...attempt, questionResults: [
      { id: "q1", label: "1a", marksAwarded: 2, maxMarks: 4, confidence: "low", areaOfStudy: "Calculus" },
      { id: "q2", label: "1b", marksAwarded: 3, maxMarks: 3, confidence: "high", areaOfStudy: "Calculus" },
    ] }])).toEqual([expect.objectContaining({ areaOfStudy: "Calculus", earned: 5, available: 7, questions: 2 })])

    const mistake: Mistake = {
      id: "m1", attemptId: attempt.id, question: "1a", category: "Concept", explanation: "Missed rule", correction: "Apply rule",
      resolved: false, createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z",
    }
    const reviewedAt = "2026-07-15T00:00:00.000Z"
    expect(previewMistakeReview(mistake, "again", reviewedAt)).toMatchObject({ state: "learning", dueAt: "2026-07-15T00:10:00.000Z", intervalDays: 0 })
    expect(previewMistakeReview(mistake, "hard", reviewedAt)).toMatchObject({ state: "learning", dueAt: "2026-07-16T00:00:00.000Z", intervalDays: 1 })
    expect(previewMistakeReview(mistake, "good", reviewedAt)).toMatchObject({ state: "review", dueAt: "2026-07-18T00:00:00.000Z", intervalDays: 3 })
    expect(previewMistakeReview(mistake, "easy", reviewedAt)).toMatchObject({ state: "review", dueAt: "2026-07-22T00:00:00.000Z", intervalDays: 7 })

    const first = recordMistakeReview(mistake, "good", reviewedAt)
    const second = recordMistakeReview(first, "good", "2026-07-18T00:00:00.000Z")
    const third = recordMistakeReview(second, "good", "2026-07-26T00:00:00.000Z")
    const mature = recordMistakeReview(third, "good", "2026-08-15T00:00:00.000Z")
    expect(first).toMatchObject({ resolved: false, reviewState: "review", intervalDays: 3, dueAt: "2026-07-18T00:00:00.000Z" })
    expect(mature).toMatchObject({ resolved: true, reviewState: "review", intervalDays: 50, dueAt: "2026-10-04T00:00:00.000Z" })
    expect(mature.reviewHistory?.at(-1)).toMatchObject({ result: "good", intervalDays: 50, easeFactor: 2.5 })
    expect(getDueMistakes([first], new Date("2026-07-18T00:00:00.000Z"))).toHaveLength(1)

    const lapsed = recordMistakeReview(mature, "again", "2026-10-04T00:00:00.000Z")
    expect(lapsed).toMatchObject({ resolved: false, reviewState: "relearning", intervalDays: 25, dueAt: "2026-10-04T00:10:00.000Z", lapses: 1 })
    expect(previewMistakeReview(lapsed, "hard", "2026-10-04T00:10:00.000Z")).toMatchObject({ resolved: false, state: "relearning", intervalDays: 1, dueAt: "2026-10-05T00:10:00.000Z" })
  })

  test("keeps legacy mastered cards in the long-term review schedule", () => {
    const legacy: Mistake = {
      id: "legacy", attemptId: attempt.id, question: "2", category: "Concept", explanation: "Missed rule", correction: "Apply rule",
      resolved: true, dueAt: null, reviewHistory: [
        { id: "r1", completedAt: "2026-06-01T00:00:00.000Z", result: "correct" },
        { id: "r2", completedAt: "2026-06-08T00:00:00.000Z", result: "correct" },
      ],
      createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-08T00:00:00.000Z",
    }
    expect(getMistakeSchedule(legacy)).toMatchObject({ state: "review", intervalDays: 30, dueAt: "2026-07-08T00:00:00.000Z", resolved: true })
    expect(getDueMistakes([legacy], new Date("2026-07-08T00:00:00.000Z"))).toEqual([legacy])
  })
})

const methods1: TimetableEntry = {
  id: "2026-11-05-mathematical-methods-exam-1",
  date: "2026-11-05",
  dateEnd: null,
  startTime: "09:00",
  endTime: "10:15",
  readingMinutes: 15,
  subject: "Mathematical Methods",
  paper: "Examination 1",
  component: "written",
}
const methods2: TimetableEntry = {
  id: "2026-11-06-mathematical-methods-exam-2",
  date: "2026-11-06",
  dateEnd: null,
  startTime: "11:45",
  endTime: "14:00",
  readingMinutes: 15,
  subject: "Mathematical Methods",
  paper: "Examination 2",
  component: "written",
}
const english: TimetableEntry = {
  id: "2026-10-27-english",
  date: "2026-10-27",
  dateEnd: null,
  startTime: "09:00",
  endTime: "12:15",
  readingMinutes: 15,
  subject: "English",
  paper: null,
  component: "written",
}
const musicPerformanceRange: TimetableEntry = {
  id: "2026-10-05-music-repertoire-performance",
  date: "2026-10-05",
  dateEnd: "2026-11-01",
  startTime: null,
  endTime: null,
  readingMinutes: null,
  subject: "Music",
  paper: "Repertoire Performance examination",
  component: "performance",
  scheduledNote: "By advice slip from Monday 27 July",
}
const musicWritten: TimetableEntry = {
  id: "2026-11-17-music-repertoire-performance-written",
  date: "2026-11-17",
  dateEnd: null,
  startTime: "09:00",
  endTime: "10:15",
  readingMinutes: 15,
  subject: "Music",
  paper: "Repertoire Performance written examination",
  component: "written",
}

const fixtureTimetable: Timetable = {
  year: 2026,
  sourceUrl: "https://example.test/timetable",
  compiledFromOfficialPublication: "Test fixture",
  exams: [methods1, methods2, english, musicPerformanceRange, musicWritten],
}

describe("suggestTimetableForAttempt", () => {
  test("suggests every official paper for a practiced subject", () => {
    const suggestions = suggestTimetableForAttempt(
      { subject: "Mathematical Methods", paper: "Exam 1" },
      fixtureTimetable,
      [],
    )
    expect(suggestions.map((entry) => entry.id)).toEqual([methods1.id, methods2.id])
  })

  test("does not confuse a practice paper label with the official exam being tracked", () => {
    const suggestions = suggestTimetableForAttempt(
      { subject: "Mathematical Methods", paper: "Exam 2" },
      fixtureTimetable,
      [],
    )
    expect(suggestions.map((entry) => entry.id)).toEqual([methods1.id, methods2.id])
  })

  test("includes a single-paper subject like English", () => {
    const suggestions = suggestTimetableForAttempt(
      { subject: "English", paper: "" },
      fixtureTimetable,
      [],
    )
    expect(suggestions.map((entry) => entry.id)).toEqual([english.id])
  })

  test("suggests every paper for the subject when the attempt has no paper", () => {
    const suggestions = suggestTimetableForAttempt(
      { subject: "Music", paper: "" },
      fixtureTimetable,
      [],
    )
    expect(suggestions.map((entry) => entry.id).sort()).toEqual(
      [musicPerformanceRange.id, musicWritten.id].sort(),
    )
  })

  test("excludes entries the student is already tracking", () => {
    const suggestions = suggestTimetableForAttempt(
      { subject: "Mathematical Methods", paper: "Exam 1" },
      fixtureTimetable,
      [methods2.id],
    )
    expect(suggestions.map((entry) => entry.id)).toEqual([methods1.id])
  })

  test("returns nothing when the subject isn't on the timetable", () => {
    const suggestions = suggestTimetableForAttempt(
      { subject: "School Internal", paper: "Trial" },
      fixtureTimetable,
      [],
    )
    expect(suggestions).toEqual([])
  })

  test("returns suggestions sorted by date then start time", () => {
    const outOfOrder: Timetable = {
      ...fixtureTimetable,
      exams: [methods2, methods1, musicWritten, musicPerformanceRange, english],
    }
    const suggestions = suggestTimetableForAttempt(
      { subject: "Mathematical Methods", paper: "" },
      outOfOrder,
      [],
    )
    expect(suggestions.map((entry) => entry.id)).toEqual([methods1.id, methods2.id])
  })
})

test("exports tracked VCE exams as timed and all-day calendar events", () => {
  const calendar = buildTimetableCalendar(
    [methods1, musicPerformanceRange],
    fixtureTimetable.sourceUrl,
    new Date("2026-07-12T00:00:00.000Z"),
  )
  expect(calendar).toContain("DTSTART;TZID=Australia/Melbourne:20261105T090000")
  expect(calendar).toContain("DTEND;TZID=Australia/Melbourne:20261105T101500")
  expect(calendar).toContain("DTSTART;VALUE=DATE:20261005")
  expect(calendar).toContain("DTEND;VALUE=DATE:20261102")
  expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(2)
})
