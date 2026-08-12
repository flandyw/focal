import {
  createStudySession,
  mergedStudySessionTitle,
  mergeStudySessionTimelines,
  normalizeStudySession,
  startPlannedStudySession,
  updateStudySession,
} from "../src/lib/studySessions.ts"

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const planned = normalizeStudySession({
  id: "legacy-planned",
  subjectIds: ["mm"],
  title: "Legacy planned session",
  startTime: "2026-06-24T08:00:00.000Z",
  endTime: "2026-06-24T10:00:00.000Z",
  activeDurations: [
    { start: "2026-06-24T08:00:00.000Z", end: "2026-06-24T08:45:00.000Z" },
    { start: "2026-06-24T09:00:00.000Z", end: "2026-06-24T10:00:00.000Z" },
  ],
  status: "planned",
  created_at: "2026-06-20T00:00:00.000Z",
})

check(planned.schemaVersion === 2, "legacy session was not migrated to V2")
check(planned.schedule.blocks.length === 2, "legacy planned blocks were not preserved")
check(planned.execution.state === "planned" && planned.execution.intervals.length === 0, "planned session gained execution intervals")
check(planned.startTime === "2026-06-24T08:00:00.000Z", "legacy schedule compatibility view is wrong")

const startedPlanned = startPlannedStudySession(planned, {
  startedAt: "2026-06-24T08:05:00.000Z",
  cycleNumber: 1,
  intent: "Finish calculus review",
})
check(startedPlanned.id === planned.id, "starting planned work created a different session")
check(startedPlanned.execution.state === "in-progress", "planned work did not start")
check(startedPlanned.execution.intervals[0]?.start === "2026-06-24T08:05:00.000Z", "actual start time was not recorded")
check(startedPlanned.schedule.blocks.length === 2, "starting planned work replaced its schedule")
check(startedPlanned.title === "Finish calculus review", "focus intent did not update the planned title")

const stored = JSON.parse(JSON.stringify(planned)) as Record<string, unknown>
check(stored.schemaVersion === 2, "stored session lost its schema version")
check(Boolean(stored.schedule), "stored session lost its schedule")
check(Boolean(stored.execution), "stored session lost its execution")
check(!("startTime" in stored), "legacy startTime leaked into canonical storage")
check(!("status" in stored), "legacy status leaked into canonical storage")

const created = createStudySession("new-session", {
  subjectIds: ["eng"],
  title: "Essay plan",
  schedule: { blocks: [{ start: "2026-06-25T07:00:00.000Z", end: "2026-06-25T08:00:00.000Z" }] },
  reflection: { confidence: 3, blockers: "Introduction" },
}, "2026-06-24T00:00:00.000Z")

check(created.confidence === 3, "create dropped confidence")
check(created.blockers === "Introduction", "create dropped blockers")

const completed = updateStudySession(created, {
  status: "completed",
  activeDurations: [{ start: "2026-06-25T07:05:00.000Z", end: "2026-06-25T07:50:00.000Z" }],
  completedAt: "2026-06-25T07:50:00.000Z",
  notes: "Drafted the outline",
}, "2026-06-25T07:50:00.000Z")

check(completed.execution.state === "completed", "completion transition did not update state")
check(completed.execution.intervals.length === 1, "completion transition lost actual intervals")
check(completed.completedAt === "2026-06-25T07:50:00.000Z", "completion timestamp was not preserved")
check(completed.reflection?.notes === "Drafted the outline", "completion transition lost reflection")

const cleared = updateStudySession(completed, { notes: undefined, confidence: undefined })
check(cleared.reflection?.notes === undefined, "explicitly cleared notes were restored")
check(cleared.reflection?.confidence === undefined, "explicitly cleared confidence was restored")

const repaired = normalizeStudySession({
  id: "corrupt-time",
  subjectIds: [],
  title: "Corrupt import",
  startTime: "not-a-date",
  status: "planned",
})
check(Number.isFinite(new Date(repaired.startTime).getTime()), "invalid imported schedule was not repaired")

const firstMergeSession = normalizeStudySession({
  id: "merge-first",
  subjectIds: ["mm"],
  title: "Methods focus",
  schedule: { blocks: [{ start: "2026-07-26T08:00:00.000Z", end: "2026-07-26T09:00:00.000Z" }] },
  execution: {
    state: "completed",
    intervals: [
      { start: "2026-07-26T08:00:00.000Z", end: "2026-07-26T08:20:00.000Z", source: "pomodoro", cycleNumber: 1 },
      { start: "2026-07-26T08:30:00.000Z", end: "2026-07-26T08:50:00.000Z", source: "pomodoro", cycleNumber: 2 },
    ],
    completedAt: "2026-07-26T08:50:00.000Z",
  },
})
const secondMergeSession = normalizeStudySession({
  id: "merge-second",
  subjectIds: ["mm"],
  title: "Methods questions",
  schedule: { blocks: [{ start: "2026-07-26T08:45:00.000Z", end: "2026-07-26T09:30:00.000Z" }] },
  execution: {
    state: "completed",
    intervals: [
      { start: "2026-07-26T08:45:00.000Z", end: "2026-07-26T09:15:00.000Z", source: "manual" },
    ],
    completedAt: "2026-07-26T09:20:00.000Z",
  },
})
const mergedTimeline = mergeStudySessionTimelines([firstMergeSession, secondMergeSession])
check(mergedTimeline.schedule.blocks.length === 2, "merged sessions were not preserved as separate study blocks")
check(mergedTimeline.schedule.blocks[1].end === "2026-07-26T09:30:00.000Z", "merged schedule lost its latest block")
check(mergedTimeline.execution.state === "completed", "completed sessions did not stay completed")
check(mergedTimeline.execution.intervals.length === 3, "merged sessions lost an actual study block")
check(mergedTimeline.execution.intervals[0].end === "2026-07-26T08:20:00.000Z", "a real pause was removed")
check(mergedTimeline.execution.intervals[1].start === "2026-07-26T08:30:00.000Z", "merged actual time starts too late")
check(mergedTimeline.execution.intervals[2].end === "2026-07-26T09:15:00.000Z", "merged actual time ends too early")
check(
  mergedTimeline.execution.state === "completed"
    && mergedTimeline.execution.completedAt === "2026-07-26T09:20:00.000Z",
  "merged completion used an earlier timestamp",
)
check(
  mergedStudySessionTitle([firstMergeSession, { ...secondMergeSession, title: "Methods focus" }]) === "Methods focus",
  "merging same-name sessions duplicated the title",
)

const partialTimeline = mergeStudySessionTimelines([
  secondMergeSession,
  normalizeStudySession({
    id: "merge-planned",
    subjectIds: ["mm"],
    title: "Methods review",
    startTime: "2026-07-26T10:00:00.000Z",
    endTime: "2026-07-26T10:30:00.000Z",
    status: "planned",
  }),
])
check(partialTimeline.execution.state === "in-progress", "partially completed work was marked planned or completed")
check(partialTimeline.execution.intervals.length === 1, "partially completed merge lost its actual interval")
check(partialTimeline.schedule.blocks.length === 2, "a real gap between merged sessions was removed")

const adjacentTimeline = mergeStudySessionTimelines([
  firstMergeSession,
  normalizeStudySession({
    id: "merge-adjacent",
    subjectIds: ["mm"],
    title: "Methods recap",
    startTime: "2026-07-26T09:00:00.000Z",
    endTime: "2026-07-26T09:30:00.000Z",
    status: "planned",
  }),
])
check(adjacentTimeline.schedule.blocks.length === 2, "back-to-back merged sessions were collapsed into one block")
