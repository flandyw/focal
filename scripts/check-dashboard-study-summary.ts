import { getCompletedStudyMinutesBySubject } from "../src/lib/planning"
import { createStudySession, updateStudySession } from "../src/lib/studySessions"
import { buildTodayOverview } from "../src/features/home/todayOverview"
import { getPriorityItems } from "../src/lib/studyPriority"

const planned = createStudySession("planned", {
  subjectIds: ["eng"],
  title: "Planned",
  schedule: { blocks: [{ start: "2026-07-13T08:00:00Z", end: "2026-07-13T09:00:00Z" }] },
  createdVia: "manual",
})
const completed = updateStudySession(planned, {
  subjectIds: ["eng", "mm"],
  execution: { state: "completed", intervals: [{ start: "2026-07-13T08:00:00Z", end: "2026-07-13T09:00:00Z", source: "manual" }], completedAt: "2026-07-13T09:00:00Z" },
})
const minutes = getCompletedStudyMinutesBySubject([planned, completed], [])

if (minutes.eng !== 30 || minutes.mm !== 30) {
  throw new Error(`Expected 30 minutes per subject, got ${JSON.stringify(minutes)}`)
}

const overview = buildTodayOverview([{
  id: "assessment-1",
  name: "English SAC",
  folder_path: "English SAC",
  subjectId: "eng",
  deadline: "2026-07-14T09:00:00Z",
  deadlineType: "assignment",
  created_at: "2026-07-01T00:00:00Z",
}, {
  id: "archived-assessment",
  name: "Archived SAC",
  folder_path: "Archived SAC",
  deadline: "2026-07-13T09:00:00Z",
  isArchived: true,
  created_at: "2026-07-01T00:00:00Z",
}], [planned, completed], [{
  id: "event-1",
  title: "Term holidays",
  startTime: "2026-07-12T09:00:00Z",
  eventType: "other",
  isFinished: true,
  finishedAt: "2026-07-12T10:00:00Z",
  created_at: "2026-07-01T00:00:00Z",
}, {
  id: "event-2",
  title: "Methods exam",
  startTime: "2026-07-14T09:00:00Z",
  eventType: "exam",
  created_at: "2026-07-01T00:00:00Z",
}], new Date("2026-07-13T00:00:00Z"))

if (overview.completedSessions !== 1 || overview.totalStudyHours !== 1) {
  throw new Error(`Today overview counted study incorrectly: ${JSON.stringify(overview)}`)
}
if (overview.dueThisWeek[0]?.id !== "assessment-1") {
  throw new Error("Today overview lost the next assessment")
}
if (overview.activeProjects.some((project) => project.id === "archived-assessment")) {
  throw new Error("Today overview counted an archived assessment as active")
}
if (overview.recentActivity.find((item) => item.id === "event-1")?.subtitle !== "Other") {
  throw new Error("Today overview exposed a raw event type")
}

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
const priorityItems = getPriorityItems({
  projects: [{
    id: "assessment-2",
    name: "English assignment",
    folder_path: "English assignment",
    deadline: tomorrow,
    deadlineType: "assignment",
    created_at: new Date().toISOString(),
  }],
  sessions: [],
  events: [{
    id: "event-3",
    title: "Methods exam",
    startTime: tomorrow,
    eventType: "exam",
    created_at: new Date().toISOString(),
  }],
})
if (!priorityItems.some((item) => item.id === "event-event-3" && item.reason.startsWith("Exam "))) {
  throw new Error("Study priorities exposed a raw event type")
}
if (!priorityItems.some((item) => item.id === "project-assessment-2" && item.reason.startsWith("Assignment "))) {
  throw new Error("Study priorities exposed a raw deadline type")
}

const rankedItems = getPriorityItems({
  now: new Date("2026-07-13T00:00:00Z").getTime(),
  subjectOrder: ["mm", "eng"],
  pinnedEventIds: ["event-pinned"],
  projects: [{
    id: "english-project",
    name: "English essay",
    folder_path: "English essay",
    subjectId: "eng",
    deadline: "2026-07-17T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
  }, {
    id: "methods-project",
    name: "Methods revision",
    folder_path: "Methods revision",
    subjectId: "mm",
    deadline: "2026-07-17T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
  }],
  sessions: [],
  events: [{
    id: "event-pinned",
    title: "Teacher consultation",
    startTime: "2026-07-20T00:00:00Z",
    eventType: "event",
    subjectId: "eng",
    created_at: "2026-07-01T00:00:00Z",
  }],
})
if (rankedItems[0]?.id !== "event-event-pinned" || !rankedItems[0].reason.includes("pinned event")) {
  throw new Error(`Pinned events should lead equivalent non-critical work: ${JSON.stringify(rankedItems)}`)
}
if (rankedItems.findIndex((item) => item.id === "project-methods-project") > rankedItems.findIndex((item) => item.id === "project-english-project")) {
  throw new Error("Manual subject order was not reflected in the focus queue")
}

console.warn("dashboard study summary check passed")
