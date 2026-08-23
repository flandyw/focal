// Ponytail: one self-check per untested pure-logic helper. No fixtures, no framework.

import {
  bustSubjectCache,
  combineDateAndTime,
  formatTime12,
  getSessionEffectiveMinutes,
  parseNotionSource,
  sortProjectsByDeadline,
} from "../src/lib/utils.ts"
import { normalizeRename } from "../src/lib/autoRename.ts"
import {
  getCalendarSessionIndicators,
  groupSessionsBySubject,
} from "../src/lib/groupSessions.ts"
import { findSubjectIdFromValues } from "../src/lib/notion/subjectMatch.ts"
import { calendarEventFingerprint } from "../src/lib/calendarEvents.ts"
import { normaliseQuickLinkUrl, parseQuickLinks } from "../src/lib/quickLinks.ts"
import {
  createEventNotification,
  createProjectNotification,
  getLeadWindow,
  getNotificationOccurrenceKey,
} from "../src/hooks/useDeadlineNotifications.ts"
import {
  createStudySession,
  updateStudySession,
} from "../src/lib/studySessions.ts"
import type { CalendarEvent, Project, StudySession, Subject } from "../src/lib/types.ts"
import { VCE_SUBJECTS } from "../src/lib/types.ts"

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// `getSubjectById` caches across calls for the lifetime of the process — make
// sure custom-subject leakage from any earlier request can't bleed into ours.
bustSubjectCache()

// ── autoRename.normalizeRename ───────────────────────────────────────────────────

// Source only strips path separators + collapses whitespace + preserves case;
// it does NOT do Title Case. The expected literal must reflect that.
check(
  normalizeRename("draft.pdf", " -final name -") === "-final name -.pdf",
  "rename must replace path separators, collapse whitespace, and preserve the proposed case while keeping the original extension",
)
check(
  normalizeRename("draft.pdf", "Renamed.docx") === "Renamed.pdf",
  "rename must revert any attempt to change the file extension",
)
check(
  normalizeRename("notes.txt", "folder/class notes.txt") === "folder class notes.txt",
  "rename should replace path separators with spaces",
)
check(
  normalizeRename("notes.txt", "   /  ") === "notes.txt",
  "rename must fall back to the original when nothing is left after sanitising",
)

// ── notion/subjectMatch.findSubjectIdFromValues ──────────────────────────────────

const subjects: Subject[] = VCE_SUBJECTS
check(
  findSubjectIdFromValues(["Mathematical Methods"], subjects) === "mm",
  "alias lookup should resolve canonical VCE subjects",
)
check(
  findSubjectIdFromValues(["methods"], subjects) === "mm",
  "alias lookup should resolve the short alias",
)
check(
  findSubjectIdFromValues(["english language"], subjects) === "eng-lang",
  "alias lookup should resolve eng-lang from its canonical phrase",
)
check(
  findSubjectIdFromValues(["NotARealSubject"], subjects) === undefined,
  "unmatched values must return undefined",
)

// ── calendarEvents.calendarEventFingerprint ──────────────────────────────────────

const baseEvent = {
  title: "Methods SAC",
  startTime: "2026-08-08T13:45:00.000Z",
  endTime: "2026-08-08T15:00:00.000Z",
  eventType: "sac" as const,
  subjectId: "mm",
  location: "Room 12",
}
check(
  calendarEventFingerprint({ ...baseEvent, title: " Methods SAC  " }) === calendarEventFingerprint(baseEvent),
  "title whitespace must not change the fingerprint",
)
check(
  calendarEventFingerprint({ ...baseEvent, title: "Chemistry SAC" }) !== calendarEventFingerprint(baseEvent),
  "different title must produce a different fingerprint",
)
check(
  calendarEventFingerprint({ ...baseEvent, subjectId: undefined }) !== calendarEventFingerprint(baseEvent),
  "clearing subjectId must produce a different fingerprint",
)

// ── utils.sortProjectsByDeadline ─────────────────────────────────────────────────

const farFuture = new Date(Date.now() + 30 * 86_400_000).toISOString()
const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
const yesterday = new Date(Date.now() - 86_400_000).toISOString()
const overdue: Project = {
  id: "p-overdue",
  name: "Overdue SAC",
  folder_path: "Overdue SAC",
  deadline: yesterday,
  deadlineType: "sac",
  created_at: "2026-01-01T00:00:00Z",
}
const soonExam: Project = {
  id: "p-soon-exam",
  name: "Tomorrow exam",
  folder_path: "Tomorrow exam",
  deadline: tomorrow,
  deadlineType: "exam",
  created_at: "2026-01-01T00:00:00Z",
}
const laterAssignment: Project = {
  id: "p-later",
  name: "Later assignment",
  folder_path: "Later assignment",
  deadline: farFuture,
  deadlineType: "assignment",
  created_at: "2026-01-01T00:00:00Z",
}
const noDeadline: Project = {
  id: "p-none",
  name: "No deadline",
  folder_path: "No deadline",
  created_at: "2026-01-01T00:00:00Z",
}
const sortedIds = sortProjectsByDeadline([laterAssignment, noDeadline, soonExam, overdue]).map((p) => p.id)
check(
  sortedIds.join(",") === "p-overdue,p-soon-exam,p-later,p-none",
  `deadline priority order is wrong: ${sortedIds.join(",")}`,
)
check(
  sortProjectsByDeadline([{ ...soonExam, deadlineType: undefined }, soonExam]).map((p) => p.id)[0] === "p-soon-exam",
  "deadlines with explicit type must sort before typed-by-default ones at the same date",
)

// ── utils.getSessionEffectiveMinutes ─────────────────────────────────────────────

const planned = createStudySession("plan-1", {
  subjectIds: ["mm"],
  title: "Plan",
  schedule: {
    blocks: [
      { start: "2026-06-01T09:00:00Z", end: "2026-06-01T09:30:00Z" },
      { start: "2026-06-01T09:45:00Z", end: "2026-06-01T10:15:00Z" },
    ],
  },
  createdVia: "manual",
})
check(getSessionEffectiveMinutes(planned) === 60, "planned session should sum all schedule blocks")

const completed = updateStudySession(planned, {
  status: "completed",
  activeDurations: [
    { start: "2026-06-01T09:00:00Z", end: "2026-06-01T09:20:00Z" },
    { start: "2026-06-01T09:50:00Z", end: "2026-06-01T10:00:00Z" },
  ],
})
check(getSessionEffectiveMinutes(completed) === 30, "completed session should sum only intervals with an end time")

const overlappingBlocks = createStudySession("overlap-1", {
  subjectIds: ["mm"],
  title: "Overlapping blocks",
  schedule: {
    blocks: [
      { start: "2026-06-01T09:00:00Z", end: "2026-06-01T10:00:00Z" },
      { start: "2026-06-01T09:30:00Z", end: "2026-06-01T10:30:00Z" },
    ],
  },
  createdVia: "manual",
})
check(getSessionEffectiveMinutes(overlappingBlocks) === 90, "overlapping study blocks should not double-count time")

// ── utils.combineDateAndTime ─────────────────────────────────────────────────────

const combined = combineDateAndTime("2026-08-08", "13:45")
check(
  combined?.getFullYear() === 2026 && combined?.getMonth() === 7 && combined?.getDate() === 8
    && combined?.getHours() === 13 && combined?.getMinutes() === 45,
  "combined date+time should produce a local Date at the requested field values",
)
check(combineDateAndTime("bad", "13:45") === null, "a non-integer date part must return null")
check(combineDateAndTime("2026-08-08", "x:y") === null, "a non-integer time part must return null")
check(combineDateAndTime("2026-08-08", "9") === null, "a single-part time must return null")
check(combineDateAndTime("2026-02-30", "13:45") === null, "a rolled calendar date must return null")
check(combineDateAndTime("2026-08-08", "24:00") === null, "a rolled clock time must return null")

// ── utils.formatTime12 ───────────────────────────────────────────────────────────

check(formatTime12("00:15") === "12:15 AM", "midnight must format as 12:15 AM")
check(formatTime12("12:00") === "12:00 PM", "noon must format as 12:00 PM")
check(formatTime12("13:45") === "1:45 PM", "afternoon must format with PM suffix")
check(formatTime12("09:05") === "9:05 AM", "morning must format with AM suffix and no leading zero on hour")
check(formatTime12("bad") === "bad", "invalid input must round-trip")

// ── quickLinks.parseQuickLinks ───────────────────────────────────────────────────

check(
  parseQuickLinks([
    { id: "ok", label: "Link", url: "https://example.com", icon: "book", color: "#fff" },
    { id: "bad", label: "Missing url", url: 42, icon: "book", color: "#fff" },
    { id: "bad", label: "NotAnObject" },
    "string-entry",
    null,
  ]).length === 1,
  "parseQuickLinks must keep only valid records with all required string fields",
)
check(parseQuickLinks({ not: "an array" }).length === 0, "non-array input must yield an empty list")
check(normaliseQuickLinkUrl("example.com/path") === "https://example.com/path", "scheme-less quick links should default to HTTPS")
check(normaliseQuickLinkUrl("javascript:alert(1)") === null, "quick links must reject unsupported protocols")
check(parseQuickLinks(null).length === 0, "null input must yield an empty list")
check(
  parseQuickLinks([{ id: "bad", label: "Script", url: "javascript:alert(1)", icon: "book", color: "#fff" }]).length === 0,
  "unsafe URL schemes must not pass persisted quick-link validation",
)

check(
  parseNotionSource({ type: "notion", id: "page", syncSnapshot: ["not-a-record"] })?.syncSnapshot === undefined,
  "array-shaped Notion sync snapshots must be rejected",
)

// ── groupSessions.getCalendarSessionIndicators ───────────────────────────────────

// One 90-min session split across mm + eng → 45 minutes each.
const sharedSession = createStudySession("s-shared", {
  subjectIds: ["mm", "eng"],
  title: "Cross-discipline revision",
  schedule: { blocks: [{ start: "2026-06-01T09:00:00Z", end: "2026-06-01T10:30:00Z" }] },
  createdVia: "manual",
})
const splitIndicators = getCalendarSessionIndicators([sharedSession], [] as Project[])
const sharedMm = splitIndicators.find((i) => i.subjectId === "mm")
const sharedEng = splitIndicators.find((i) => i.subjectId === "eng")
check(
  sharedMm?.totalMinutes === 45 && sharedEng?.totalMinutes === 45,
  "indicators must split session minutes evenly across the session's subjectIds",
)

// Status hierarchy lives on its own fixture so mixed inputs don't muddy the rollup.
const completedOnly = updateStudySession(
  createStudySession("s-completed-only", {
    subjectIds: ["mm"],
    title: "Just mm",
    schedule: { blocks: [{ start: "2026-06-01T11:00:00Z", end: "2026-06-01T12:00:00Z" }] },
    createdVia: "manual",
  }),
  {
    status: "completed",
    activeDurations: [{ start: "2026-06-01T11:00:00Z", end: "2026-06-01T12:00:00Z" }],
  },
)
check(
  getCalendarSessionIndicators([completedOnly], [] as Project[]).find((i) => i.subjectId === "mm")?.status === "completed",
  "an indicator composed only of completed sessions must roll up to 'completed'",
)

const taggedByProject: StudySession = createStudySession("s-by-project", {
  subjectIds: [],
  title: "From project",
  projectId: "p-mm",
  schedule: { blocks: [{ start: "2026-06-01T13:00:00Z", end: "2026-06-01T14:00:00Z" }] },
  createdVia: "manual",
})
const orphan = createStudySession("s-untagged", {
  subjectIds: [],
  title: "Orphan subject",
  schedule: { blocks: [{ start: "2026-06-01T09:00:00Z", end: "2026-06-01T10:00:00Z" }] },
  createdVia: "manual",
})
const groups = groupSessionsBySubject([orphan, taggedByProject], [
  {
    id: "p-mm",
    name: "Methods SAC",
    folder_path: "Methods SAC",
    subjectId: "mm",
    created_at: "2026-01-01T00:00:00Z",
  } satisfies Project,
])
const mmGroup = groups.find((g) => g.subjectId === "mm")
check(
  groups.length === 1 && !!mmGroup,
  "groupSessionsBySubject must adopt an empty-subjectIds session via its linked project (the orphan fixture must be skipped)",
)
check(
  mmGroup?.totalMinutes === 60,
  "groupSessionsBySubject must sum minutes for sessions adopted from a project",
)

// ── deadline notifications ───────────────────────────────────────────────────────

const notificationNow = new Date("2026-08-23T10:00:00.000Z")
check(getLeadWindow(-0.5) === "due-now", "a recently missed alert must be caught after wake")
check(getLeadWindow(-1.01) === null, "catch-up alerts must expire after one hour")
check(getLeadWindow(3) === "due-now" && getLeadWindow(3.01) === "today", "the three-hour boundary must be stable")

const recentlyStartedEvent = createEventNotification({
  id: "event-started",
  title: "Methods revision",
  startTime: "2026-08-23T09:30:00.000Z",
  eventType: "event",
  created_at: "2026-08-01T00:00:00.000Z",
} satisfies CalendarEvent, notificationNow)
check(
  recentlyStartedEvent?.title === "Methods revision has started",
  "a catch-up event alert must not claim the event is still upcoming",
)

const projectNotification = createProjectNotification({
  id: "project-rescheduled",
  name: "Chemistry SAC",
  folder_path: "Chemistry SAC",
  deadline: "2026-08-23T12:00:00.000Z",
  created_at: "2026-08-01T00:00:00.000Z",
}, notificationNow)
const rescheduledNotification = createProjectNotification({
  id: "project-rescheduled",
  name: "Chemistry SAC",
  folder_path: "Chemistry SAC",
  deadline: "2026-08-23T14:00:00.000Z",
  created_at: "2026-08-01T00:00:00.000Z",
}, notificationNow)
check(
  projectNotification !== null
    && rescheduledNotification !== null
    && getNotificationOccurrenceKey(projectNotification) !== getNotificationOccurrenceKey(rescheduledNotification),
  "rescheduling an item must create a fresh notification occurrence",
)

console.warn("lib helpers check passed")
