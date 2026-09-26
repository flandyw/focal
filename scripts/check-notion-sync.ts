import {
  isAlreadyArchivedNotionError,
  isRetryableNotionError,
  NotionApiError,
  isRetryableNotionReadError,
  notionReadRetryDelay,
} from "../src/lib/notion/api"
import {
  FOCAL_ID_PROPERTY,
  FOCAL_KIND_PROPERTY,
  focalIdentityProperties,
  createPropertyValue,
  createTextProperty,
  createSyncCtx,
  eventSyncSnapshot,
  getEventSubjectId,
  getFocalId,
  getFocalKind,
  getPrimarySessionSubjectId,
  mergeNotionSyncSnapshots,
  notionSnapshotsEqual,
  resolveNotionSyncSnapshot,
  richTextValue,
  sameInstant,
  sessionFingerprint,
  sessionSyncSnapshot,
  toEventFromPage,
  toEventType,
  toNotionType,
} from "../src/lib/notion/schema"
import { findSubjectIdFromValues } from "../src/lib/notion/subjectMatch"
import { buildPageChildrenForSync, notionWriteRetryDelay } from "../src/lib/notion/push"
import { notionIntentDue, retryNotionIntent } from "../src/lib/notion/outbox"
import { planDuplicateNotionPages } from "../src/lib/notion"
import {
  chooseNotionConflictSide,
  pullFromNotion,
  pullFromNotionAfterConflictRecheck,
  rebaseNotionConflictUpdates,
} from "../src/lib/notion/pull"
import { normalizeStudySession, updateStudySession } from "../src/lib/studySessions"
import {
  notionEventIsSettled,
  preserveNewerEventChanges,
  preserveNewerSessionChanges,
} from "../src/hooks/useNotionSync"
import { VCE_SUBJECTS, type CalendarEvent, type EventType } from "../src/lib/types"
import { stableJsonStringify } from "../src/lib/utils"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const archiveIntent = {
  dataSourceId: "database",
  kind: "event" as const,
  localId: "event-1",
  operation: "archive" as const,
  pageId: "page-1",
  createdAt: "2026-07-20T00:00:00.000Z",
  retryCount: 0,
}
const retriedIntent = retryNotionIntent(archiveIntent, "offline", "2026-07-20T00:00:00.000Z")
assert(retriedIntent.retryCount === 1, "failed Notion deletes must remain durable for retry")
assert(!notionIntentDue(retriedIntent, "2026-07-20T00:00:04.000Z"), "Notion retries must respect backoff")
assert(notionIntentDue(retriedIntent, "2026-07-20T00:00:05.000Z"), "Notion retries must become due")

assert(isRetryableNotionReadError("NETWORK_ERROR"), "network read failures should retry")
assert(isRetryableNotionReadError("rate_limited"), "rate-limited reads should retry")
assert(!isRetryableNotionReadError("unauthorized"), "authorization failures must fail immediately")
assert(notionReadRetryDelay(0) === 500, "first Notion read retry should wait 500ms")
assert(notionReadRetryDelay(1) === 1000, "Notion read retry delay should back off")
const rateLimitError = new NotionApiError({ code: "rate_limited", message: "slow down", retry_after_ms: 2_500 })
assert(isRetryableNotionError(rateLimitError), "typed transient Notion write errors should retry")
assert(!isRetryableNotionError(new Error("validation failed")), "untyped validation failures must not retry")
assert(notionWriteRetryDelay(rateLimitError, 0, 0) === 2_500, "Notion writes must honor Retry-After")
assert(
  isAlreadyArchivedNotionError({ code: "validation_error", message: "Can't edit block that is archived." }),
  "archiving an already archived Notion page must be idempotent",
)
assert(
  isAlreadyArchivedNotionError({ code: "object_not_found", message: "missing" }),
  "archiving a Notion page that is already gone must be idempotent",
)
assert(richTextValue("x".repeat(2_001)).length === 2, "long Notion text must be split at the API boundary")
assert(
  !isAlreadyArchivedNotionError({ code: "validation_error", message: "Property is invalid" }),
  "unrelated Notion validation errors must still fail",
)
assert(
  buildPageChildrenForSync(undefined, undefined) === undefined,
  "items without a synced body must preserve Notion-only page content",
)
assert(
  JSON.stringify(buildPageChildrenForSync(undefined, "old-hash")) === "[]",
  "removing a previously synced description must clear the Notion page body",
)

const identity = focalIdentityProperties("session-1", "session")
assert(FOCAL_ID_PROPERTY in identity && FOCAL_KIND_PROPERTY in identity, "Notion writes must include stable Focal identity properties")
const identityPage = {
  id: "page-1",
  properties: {
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: "session-1" }] },
    [FOCAL_KIND_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: "session" }] },
  },
}
assert(getFocalId(identityPage) === "session-1", "Notion Focal IDs must round-trip")
assert(getFocalKind(identityPage) === "session", "Notion Focal kinds must round-trip")
const notionSettings = {
  token: "test",
  dataSourceId: "database",
  titleProperty: "Name",
  dateProperty: "Deadline",
  typeProperty: "Type",
  completedProperty: "Complete",
  subjectProperty: "Subject",
}
const eventTypes: EventType[] = ["sac", "exam", "assignment", "event", "homework", "other", "practice-sac"]
for (const eventType of eventTypes) {
  assert(toEventType(toNotionType(eventType)) === eventType, `${eventType} must round-trip through Notion type labels`)
}
assert(
  findSubjectIdFromValues(["English Language essay"], VCE_SUBJECTS) === "eng-lang",
  "subject inference must prefer the longest matching phrase",
)
assert(
  findSubjectIdFromValues(["Geography homework"], VCE_SUBJECTS) === "geo",
  "subject inference must not match short aliases inside words",
)
assert(
  findSubjectIdFromValues(["Engineering project"], VCE_SUBJECTS) === undefined,
  "subject inference must respect word boundaries",
)
assert(
  JSON.stringify(createTextProperty("select", undefined)) === JSON.stringify({ select: null }),
  "clearing a Focal subject must explicitly clear a Notion select",
)
assert(
  createPropertyValue("formula", true) === undefined,
  "read-only completion properties must not be represented as writable checkboxes",
)
assert(
  getEventSubjectId(
    { Subject: { type: "select", select: null } },
    "Mathematical Methods homework",
    notionSettings,
    VCE_SUBJECTS,
    findSubjectIdFromValues,
  ) === undefined,
  "an explicitly empty mapped subject must not be inferred again from the title",
)
const commonProperties = {
  Name: { type: "title", title: [{ plain_text: "Focus" }] },
  Deadline: { type: "date", date: { start: "2026-07-20T01:00:00.000Z", end: "2026-07-20T01:30:00.000Z" } },
  Type: { type: "select", select: { name: "Study Session" } },
  Complete: { type: "checkbox", checkbox: true },
  Subject: { type: "select", select: { name: "Mathematical Methods" } },
}
const untaggedTwin = { id: "legacy-page", properties: commonProperties }
const taggedTwin = { ...identityPage, properties: { ...commonProperties, ...identityPage.properties } }
const duplicatePlan = planDuplicateNotionPages(
  [taggedTwin, untaggedTwin],
  new Set([taggedTwin.id]),
  new Set(),
  notionSettings,
)
assert(duplicatePlan.archiveIds.has("legacy-page"), "a tagged canonical page must replace its untagged legacy twin")
const secondTaggedPage = {
  id: "page-2",
  properties: {
    ...commonProperties,
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: "session-2" }] },
    [FOCAL_KIND_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: "session" }] },
  },
}
const distinctPlan = planDuplicateNotionPages(
  [taggedTwin, secondTaggedPage],
  new Set(),
  new Set(),
  notionSettings,
)
assert(distinctPlan.archiveIds.size === 0, "distinct tagged Focal items must not be collapsed by matching content")
const repairedCheckpointPlan = planDuplicateNotionPages(
  [taggedTwin, secondTaggedPage], new Set([taggedTwin.id]), new Set([secondTaggedPage.id]), notionSettings,
)
assert(repairedCheckpointPlan.archiveIds.has(secondTaggedPage.id), "proven duplicate checkpoints must be archived even with different Focal ids")
assert(repairedCheckpointPlan.hiddenIds.has(secondTaggedPage.id), "deleted checkpoint pages must not be reimported")
const taggedExam = {
  id: "tagged-exam",
  properties: {
    ...commonProperties,
    Type: { type: "select", select: { name: "Exam" } },
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: "exam-1" }] },
    [FOCAL_KIND_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: "event" }] },
  },
}
const untaggedHomework = {
  id: "untagged-homework",
  properties: {
    ...commonProperties,
    Type: { type: "select", select: { name: "Homework" } },
  },
}
assert(
  planDuplicateNotionPages([taggedExam, untaggedHomework], new Set(), new Set(), notionSettings).archiveIds.size === 0,
  "different event types must not be collapsed as duplicate Notion pages",
)
let missingEventDateRejected = false
try {
  toEventFromPage({ id: "missing-date", properties: {} }, notionSettings, [], findSubjectIdFromValues)
} catch {
  missingEventDateRejected = true
}
assert(missingEventDateRejected, "Notion events with cleared dates must be rejected")

const localEvent: CalendarEvent = {
  id: "event-1",
  title: "Local title",
  startTime: "2026-07-20T01:00:00.000Z",
  endTime: "2026-07-20T01:30:00.000Z",
  eventType: "event",
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-20T00:30:00.000Z",
  source: {
    type: "notion",
    id: "event-page",
    kind: "event",
    lastEditedTime: "2026-07-20T00:00:00.000Z",
  },
}
if (localEvent.source?.type === "notion") {
  localEvent.source.syncSnapshot = eventSyncSnapshot({ ...localEvent, title: "Original title" }, notionSettings)
}
const remoteEventPage = {
  id: "event-page",
  last_edited_time: "2026-07-20T00:45:00.000Z",
  properties: {
    Name: { type: "title", title: [{ plain_text: "Notion title" }] },
    Deadline: { type: "date", date: { start: localEvent.startTime, end: localEvent.endTime } },
    Type: { type: "select", select: { name: "Event" } },
    Complete: { type: "checkbox", checkbox: false },
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: localEvent.id }] },
    [FOCAL_KIND_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: "event" }] },
  },
}
assert(
  chooseNotionConflictSide("2026-07-20T00:30:00.000Z", "2026-07-20T00:30:04.000Z") === "local",
  "a Notion echo shortly after a local edit must prefer Focal",
)
assert(
  chooseNotionConflictSide("2026-07-20T00:30:00.000Z", "2026-07-20T00:30:06.000Z") === "notion",
  "a clearly later Notion edit must win automatically",
)
assert(chooseNotionConflictSide(undefined, remoteEventPage.last_edited_time) === null, "missing timestamps must remain manual")

const manualLocalEvent = { ...localEvent, updated_at: undefined }
const conflictCtx = createSyncCtx(new Set([localEvent.id]), new Set())
pullFromNotion([remoteEventPage], [manualLocalEvent], [], notionSettings, [], conflictCtx)
assert(conflictCtx.conflicts === 1, "simultaneous local and Notion edits must produce a conflict")
assert(conflictCtx.updatedEvents.size === 0, "a conflict must not overwrite the local event before resolution")
assert(
  conflictCtx.conflictItems[0]?.remoteUpdates.title === "Notion title",
  "the conflict must retain a separate remote snapshot",
)
assert(
  JSON.stringify(conflictCtx.conflictItems[0]?.conflictingFields) === JSON.stringify(["title"]),
  "manual conflicts must identify only the overlapping field",
)

const echoPage = { ...remoteEventPage, last_edited_time: "2026-07-20T00:30:04.000Z" }
const echoCtx = createSyncCtx(new Set([localEvent.id]), new Set())
pullFromNotion([echoPage], [localEvent], [], notionSettings, [], echoCtx)
assert(echoCtx.conflicts === 0, "a likely delayed Focal write must resolve without prompting")
assert(echoCtx.updatedEvents.get(localEvent.id)?.title === "Local title", "the local value must win during the echo window")
assert(!echoCtx.acknowledgedEventIds.has(localEvent.id), "a local winner must remain queued until it is pushed")

const laterNotionCtx = createSyncCtx(new Set([localEvent.id]), new Set())
pullFromNotion([remoteEventPage], [localEvent], [], notionSettings, [], laterNotionCtx)
assert(laterNotionCtx.conflicts === 0, "a clearly later Notion edit must resolve without prompting")
assert(laterNotionCtx.updatedEvents.get(localEvent.id)?.title === "Notion title", "the clearly later Notion value must win")
assert(laterNotionCtx.acknowledgedEventIds.has(localEvent.id), "a remote winner must acknowledge the superseded local intent")

const legacyLocalEvent: CalendarEvent = {
  ...localEvent,
  source: localEvent.source?.type === "notion"
    ? { ...localEvent.source, syncSnapshot: undefined }
    : localEvent.source,
}
const legacyEchoCtx = createSyncCtx(new Set([legacyLocalEvent.id]), new Set())
pullFromNotion([echoPage], [legacyLocalEvent], [], notionSettings, [], legacyEchoCtx)
assert(legacyEchoCtx.conflicts === 0, "legacy records without a baseline must use timestamp evidence when available")
assert(legacyEchoCtx.updatedEvents.get(legacyLocalEvent.id)?.title === "Local title", "a recent legacy local edit must win safely")

const newerRemoteEventPage = {
  ...remoteEventPage,
  last_edited_time: "2026-07-20T00:47:00.000Z",
  properties: {
    ...remoteEventPage.properties,
    Name: { type: "title", title: [{ plain_text: "Newest Notion title" }] },
    Deadline: {
      type: "date",
      date: { start: "2026-07-20T02:00:00.000Z", end: "2026-07-20T02:30:00.000Z" },
    },
  },
}
const rebasedLocalUpdates = rebaseNotionConflictUpdates(
  "event",
  ["title"],
  newerRemoteEventPage,
  localEvent,
  notionSettings,
  [],
  "local",
)
const rebasedNotionUpdates = rebaseNotionConflictUpdates(
  "event",
  ["title"],
  newerRemoteEventPage,
  localEvent,
  notionSettings,
  [],
  "notion",
)
assert(rebasedLocalUpdates.title === "Local title", "Keep Focal must use the latest local value")
assert(rebasedNotionUpdates.title === "Newest Notion title", "Keep Notion must use the latest remote value")
assert(rebasedLocalUpdates.startTime === "2026-07-20T02:00:00.000Z", "Keep Focal must retain newer non-conflicting Notion fields")

const transientConflictCtx = createSyncCtx(new Set([localEvent.id]), new Set())
let transientRefreshes = 0
await pullFromNotionAfterConflictRecheck(
  [remoteEventPage],
  [manualLocalEvent],
  [],
  notionSettings,
  [],
  transientConflictCtx,
  () => {
    transientRefreshes += 1
    return Promise.resolve({
      ...remoteEventPage,
      last_edited_time: "2026-07-20T00:46:00.000Z",
      properties: {
        ...remoteEventPage.properties,
        Name: { type: "title", title: [{ plain_text: localEvent.title }] },
      },
    })
  },
  undefined,
  () => Promise.resolve(),
)
assert(transientRefreshes === 1, "a possible conflict must be confirmed with a targeted page reread")
assert(transientConflictCtx.conflicts === 0, "a self-write that settles in Notion must not prompt as a conflict")
assert(transientConflictCtx.acknowledgedEventIds.has(localEvent.id), "a settled self-write must acknowledge its local intent")

const persistentConflictCtx = createSyncCtx(new Set([localEvent.id]), new Set())
let persistentRefreshes = 0
await pullFromNotionAfterConflictRecheck(
  [remoteEventPage],
  [manualLocalEvent],
  [],
  notionSettings,
  [],
  persistentConflictCtx,
  () => {
    persistentRefreshes += 1
    return Promise.resolve(remoteEventPage)
  },
  undefined,
  () => Promise.resolve(),
)
assert(persistentRefreshes === 2, "a persistent conflict must use the bounded confirmation window")
assert(persistentConflictCtx.conflicts === 1, "a genuine overlapping Notion edit must still require a choice")

const mixedLocalEvent: CalendarEvent = {
  ...localEvent,
  updated_at: undefined,
  subjectId: "mm",
  source: {
    type: "notion",
    id: "event-page",
    kind: "event",
    lastEditedTime: "2026-07-20T00:00:00.000Z",
    syncSnapshot: eventSyncSnapshot({ ...localEvent, title: "Original title", subjectId: undefined }, notionSettings),
  },
}
const mixedRemotePage = {
  ...remoteEventPage,
  properties: {
    ...remoteEventPage.properties,
    Deadline: {
      type: "date",
      date: { start: "2026-07-20T02:00:00.000Z", end: "2026-07-20T02:30:00.000Z" },
    },
  },
}
const mixedConflictCtx = createSyncCtx(new Set([mixedLocalEvent.id]), new Set())
pullFromNotion([mixedRemotePage], [mixedLocalEvent], [], notionSettings, VCE_SUBJECTS, mixedConflictCtx)
const mixedConflict = mixedConflictCtx.conflictItems[0]
const mixedRemoteUpdates = mixedConflict?.remoteUpdates as Record<string, unknown> | undefined
assert(mixedConflict?.localUpdates.title === "Local title", "keeping Focal must retain the selected conflicting title")
assert(mixedConflict?.localUpdates.startTime === "2026-07-20T02:00:00.000Z", "keeping Focal must retain a disjoint Notion time edit")
assert(mixedRemoteUpdates?.subjectId === "mm", "keeping Notion must retain a disjoint local subject edit")

const convergedEvent = { ...localEvent, title: "Notion title" }
const convergedCtx = createSyncCtx(new Set([convergedEvent.id]), new Set())
pullFromNotion([remoteEventPage], [convergedEvent], [], notionSettings, [], convergedCtx)
assert(convergedCtx.conflicts === 0, "matching local and Notion edits must converge automatically")
assert(convergedCtx.acknowledgedEventIds.has(convergedEvent.id), "converged edits must acknowledge the local intent")

const bodyEditedEvent = { ...convergedEvent, description: "New local notes" }
const bodyEditedCtx = createSyncCtx(new Set([bodyEditedEvent.id]), new Set())
pullFromNotion([remoteEventPage], [bodyEditedEvent], [], notionSettings, [], bodyEditedCtx)
assert(bodyEditedCtx.conflicts === 0, "a local body edit must not create an unresolvable property conflict")
assert(!bodyEditedCtx.acknowledgedEventIds.has(bodyEditedEvent.id), "a local body edit must remain queued for push")

const disjointRemotePage = {
  ...remoteEventPage,
  properties: {
    ...remoteEventPage.properties,
    Name: { type: "title", title: [{ plain_text: "Original title" }] },
    Deadline: {
      type: "date",
      date: { start: "2026-07-20T02:00:00.000Z", end: "2026-07-20T02:30:00.000Z" },
    },
  },
}
const disjointCtx = createSyncCtx(new Set([localEvent.id]), new Set())
pullFromNotion([disjointRemotePage], [localEvent], [], notionSettings, [], disjointCtx)
assert(disjointCtx.conflicts === 0, "non-overlapping local and Notion edits must merge automatically")
assert(disjointCtx.updatedEvents.get(localEvent.id)?.title === "Local title", "the merged event must keep the local title edit")
assert(
  disjointCtx.updatedEvents.get(localEvent.id)?.startTime === "2026-07-20T02:00:00.000Z",
  "the merged event must keep the Notion time edit",
)
assert(!disjointCtx.acknowledgedEventIds.has(localEvent.id), "an auto-merge must remain queued until its merged value is pushed")

const sessionId = "session-routing"
const sessionPageId = "session-page"
const baselineSession = normalizeStudySession({
  schemaVersion: 2,
  id: sessionId,
  subjectIds: [],
  title: "Original session",
  schedule: {
    blocks: [{ start: "2026-07-20T01:00:00.000Z", end: "2026-07-20T02:00:00.000Z" }],
  },
  execution: { state: "planned", intervals: [] },
  createdVia: "manual",
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-20T00:00:00.000Z",
})
const activeSecondPrecisionSession = normalizeStudySession({
  ...baselineSession,
  id: "active-second-precision-session",
  title: "PED · Focus",
  subjectIds: ["pe"],
  schedule: {
    blocks: [{ start: "2026-07-20T01:00:00.674Z", end: "2026-07-20T01:25:00.674Z" }],
  },
  execution: {
    state: "in-progress",
    intervals: [{ start: "2026-07-20T01:00:00.674Z", source: "pomodoro" }],
  },
})
const roundedActiveSessionPage = {
  id: "active-second-precision-page",
  last_edited_time: "2026-07-20T01:01:00.000Z",
  properties: {
    Name: { type: "title", title: [{ plain_text: activeSecondPrecisionSession.title }] },
    Deadline: {
      type: "date",
      date: { start: "2026-07-20T01:00:00.000Z", end: "2026-07-20T01:25:00.000Z" },
    },
    Type: { type: "select", select: { name: "Study Session" } },
    Complete: { type: "checkbox", checkbox: false },
    Subject: { type: "select", select: { name: "Physical Education" } },
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: activeSecondPrecisionSession.id }] },
    [FOCAL_KIND_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: "session" }] },
  },
}
const roundedActiveSessionCtx = createSyncCtx(new Set(), new Set([activeSecondPrecisionSession.id]))
pullFromNotion(
  [roundedActiveSessionPage],
  [],
  [activeSecondPrecisionSession],
  notionSettings,
  VCE_SUBJECTS,
  roundedActiveSessionCtx,
)
assert(sameInstant(activeSecondPrecisionSession.startTime, "2026-07-20T01:00:00.000Z"), "Notion minute rounding must preserve equivalent timer instants")
assert(roundedActiveSessionCtx.conflicts === 0, "an active timer must not conflict with Notion's minute-rounded dates")
assert(
  !("startTime" in (roundedActiveSessionCtx.updatedSessions.get(activeSecondPrecisionSession.id) ?? {})),
  "acknowledging a minute-rounded Notion page must preserve the timer's exact local interval",
)
assert(
  sessionSyncSnapshot(activeSecondPrecisionSession, notionSettings, VCE_SUBJECTS).startTime === "2026-07-20T01:00:00.000Z",
  "Notion sync snapshots must use Notion's minute precision",
)
const localSession = normalizeStudySession({
  schemaVersion: 2,
  id: sessionId,
  subjectIds: [],
  title: "Local session title",
  schedule: baselineSession.schedule,
  execution: baselineSession.execution,
  createdVia: "manual",
  integrations: {
    notion: {
      type: "notion",
      id: sessionPageId,
      kind: "session",
      lastEditedTime: "2026-07-20T00:00:00.000Z",
      syncSnapshot: sessionSyncSnapshot(baselineSession, notionSettings, []),
    },
  },
  created_at: baselineSession.created_at,
  updated_at: "2026-07-20T00:30:00.000Z",
})
const disjointSessionPage = {
  id: sessionPageId,
  last_edited_time: "2026-07-20T00:45:00.000Z",
  properties: {
    Name: { type: "title", title: [{ plain_text: "Original session" }] },
    Deadline: {
      type: "date",
      date: { start: "2026-07-20T03:00:00.000Z", end: "2026-07-20T04:00:00.000Z" },
    },
    // The stable Focal Kind must win over a stale or user-edited display type.
    Type: { type: "select", select: { name: "Event" } },
    Complete: { type: "checkbox", checkbox: false },
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: sessionId }] },
    [FOCAL_KIND_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: "session" }] },
  },
}
const disjointSessionCtx = createSyncCtx(new Set(), new Set([sessionId]))
pullFromNotion([disjointSessionPage], [], [localSession], notionSettings, [], disjointSessionCtx)
const mergedSessionUpdates = disjointSessionCtx.updatedSessions.get(sessionId)
assert(disjointSessionCtx.conflicts === 0, "non-overlapping study-session edits must merge automatically")
assert(disjointSessionCtx.updatedEvents.size === 0, "Focal Kind must route a tagged session away from event handling")
assert(Boolean(mergedSessionUpdates), "a tagged session must be routed to study-session updates")
assert(mergedSessionUpdates?.title === "Local session title", "the merged session must keep the local title edit")
assert(
  mergedSessionUpdates?.startTime === "2026-07-20T03:00:00.000Z",
  "the merged session must keep the Notion time edit",
)
assert(!disjointSessionCtx.acknowledgedSessionIds.has(sessionId), "a merged session must remain queued until pushed")

const conflictingSessionPage = {
  ...disjointSessionPage,
  last_edited_time: "2026-07-20T00:30:04.000Z",
  properties: {
    ...disjointSessionPage.properties,
    Name: { type: "title", title: [{ plain_text: "Notion session title" }] },
    Deadline: {
      type: "date",
      date: { start: baselineSession.startTime, end: baselineSession.endTime },
    },
  },
}
const sessionEchoCtx = createSyncCtx(new Set(), new Set([sessionId]))
pullFromNotion([conflictingSessionPage], [], [localSession], notionSettings, [], sessionEchoCtx)
assert(sessionEchoCtx.conflicts === 0, "a likely delayed Focal session write must resolve without prompting")
assert(sessionEchoCtx.updatedSessions.get(sessionId)?.title === "Local session title", "the local session must win during the echo window")

const multiSubjectSession = normalizeStudySession({
  ...baselineSession,
  id: "multi-subject-session",
  subjectIds: ["mm", "sm"],
  integrations: {
    notion: {
      type: "notion",
      id: "multi-subject-page",
      kind: "session",
      lastEditedTime: "2026-07-20T00:00:00.000Z",
      syncSnapshot: sessionSyncSnapshot({ ...baselineSession, subjectIds: ["mm", "sm"] }, notionSettings, VCE_SUBJECTS),
    },
  },
})
const changedPrimarySubjectPage = {
  ...disjointSessionPage,
  id: "multi-subject-page",
  properties: {
    ...disjointSessionPage.properties,
    Name: { type: "title", title: [{ plain_text: multiSubjectSession.title }] },
    Subject: { type: "select", select: { name: "Chemistry" } },
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: multiSubjectSession.id }] },
  },
}
const multiSubjectCtx = createSyncCtx(new Set(), new Set([multiSubjectSession.id]))
pullFromNotion([changedPrimarySubjectPage], [], [multiSubjectSession], notionSettings, VCE_SUBJECTS, multiSubjectCtx)
assert(
  JSON.stringify(multiSubjectCtx.updatedSessions.get(multiSubjectSession.id)?.subjectIds) === JSON.stringify(["chem", "sm"]),
  "changing the Notion subject must preserve secondary Focal subjects",
)

const subjectConflictSession = {
  ...normalizeStudySession({
  ...baselineSession,
  id: "subject-conflict-session",
  subjectIds: ["gm", "chem"],
  integrations: {
    notion: {
      type: "notion",
      id: "subject-conflict-page",
      kind: "session",
      lastEditedTime: "2026-07-20T00:00:00.000Z",
      syncSnapshot: sessionSyncSnapshot({ ...baselineSession, subjectIds: ["mm", "sm"] }, notionSettings, VCE_SUBJECTS),
    },
  },
  }),
  updated_at: undefined,
}
const subjectConflictPage = {
  ...changedPrimarySubjectPage,
  id: "subject-conflict-page",
  properties: {
    ...changedPrimarySubjectPage.properties,
    Name: { type: "title", title: [{ plain_text: subjectConflictSession.title }] },
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: subjectConflictSession.id }] },
  },
}
const subjectConflictCtx = createSyncCtx(new Set(), new Set([subjectConflictSession.id]))
pullFromNotion([subjectConflictPage], [], [subjectConflictSession], notionSettings, VCE_SUBJECTS, subjectConflictCtx)
const subjectConflict = subjectConflictCtx.conflictItems[0]
assert(subjectConflictCtx.conflicts === 1, "different local and Notion primary-subject edits must remain manual")
assert(
  JSON.stringify(subjectConflict?.localSubjectIds) === JSON.stringify(["gm", "chem"]),
  "manual session conflicts must capture the full local subject list for staleness checks",
)

const completedSession = normalizeStudySession({
  ...baselineSession,
  id: "completed-session",
  execution: {
    state: "completed",
    intervals: [{ start: baselineSession.startTime, end: baselineSession.endTime, source: "manual" }],
    completedAt: baselineSession.endTime,
  },
  integrations: {
    notion: {
      type: "notion",
      id: "completed-page",
      kind: "session",
      lastEditedTime: "2026-07-20T00:00:00.000Z",
    },
  },
})
if (completedSession.source?.type === "notion") {
  completedSession.source.syncSnapshot = sessionSyncSnapshot(completedSession, notionSettings, VCE_SUBJECTS)
}
const reopenedPage = {
  ...disjointSessionPage,
  id: "completed-page",
  properties: {
    ...disjointSessionPage.properties,
    Name: { type: "title", title: [{ plain_text: completedSession.title }] },
    Deadline: { type: "date", date: { start: completedSession.startTime, end: completedSession.endTime } },
    Complete: { type: "checkbox", checkbox: false },
    Subject: { type: "select", select: null },
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [{ plain_text: completedSession.id }] },
  },
}
const reopenCtx = createSyncCtx()
pullFromNotion([reopenedPage], [], [completedSession], notionSettings, VCE_SUBJECTS, reopenCtx)
const reopenedSession = updateStudySession(completedSession, reopenCtx.updatedSessions.get(completedSession.id) ?? {})
assert(reopenedSession.status === "in-progress", "unchecking Complete must reopen a recorded session without resetting it")
assert(reopenedSession.execution.intervals.length === 1, "reopening from Notion must preserve recorded study intervals")

const newerEvent = { ...localEvent, title: "Newest local title" }
const guardedEventUpdates = preserveNewerEventChanges(
  localEvent,
  newerEvent,
  {
    title: "Stale sync title",
    startTime: "2026-07-20T05:00:00.000Z",
    source: {
      type: "notion",
      id: "event-page",
      kind: "event",
      bodyHash: undefined,
      syncSnapshot: eventSyncSnapshot({ ...localEvent, title: "Stale sync title", startTime: "2026-07-20T05:00:00.000Z" }, notionSettings),
    },
  },
  notionSettings,
)
assert(guardedEventUpdates.title === undefined, "a completed sync must not overwrite a newer local event title")
assert(guardedEventUpdates.startTime === "2026-07-20T05:00:00.000Z", "an unrelated sync field should still apply")
const settledEvent = {
  ...newerEvent,
  startTime: guardedEventUpdates.startTime!,
  source: {
    ...guardedEventUpdates.source!,
    syncSnapshot: eventSyncSnapshot({ ...newerEvent, startTime: guardedEventUpdates.startTime! }, notionSettings),
  },
}
assert(notionEventIsSettled(settledEvent, notionSettings), "only a record matching its acknowledged snapshot is settled")

const newerSession = normalizeStudySession({ ...localSession, title: "Newest local session" })
const guardedSessionUpdates = preserveNewerSessionChanges(
  localSession,
  newerSession,
  { title: "Stale session title", endTime: "2026-07-20T06:00:00.000Z" },
  notionSettings,
  [],
)
assert(guardedSessionUpdates.title === undefined, "a completed sync must not overwrite a newer local session title")
assert(guardedSessionUpdates.endTime === "2026-07-20T06:00:00.000Z", "an unrelated session sync field should still apply")

const sessionWithConcurrentSecondary = normalizeStudySession({
  ...multiSubjectSession,
  subjectIds: ["mm", "sm", "gm"],
})
const guardedSubjectUpdates = preserveNewerSessionChanges(
  multiSubjectSession,
  sessionWithConcurrentSecondary,
  { subjectIds: ["chem", "sm"] },
  notionSettings,
  VCE_SUBJECTS,
)
assert(
  JSON.stringify(guardedSubjectUpdates.subjectIds) === JSON.stringify(["chem", "sm", "gm"]),
  "a Notion primary-subject merge must preserve a concurrently added secondary subject",
)
assert(
  getPrimarySessionSubjectId(
    { subjectIds: ["sm", "mm"] },
    VCE_SUBJECTS,
  ) === "sm",
  "the Notion primary subject must follow the session subject order",
)

const secondarySubjectOnlyPage = {
  ...changedPrimarySubjectPage,
  id: "secondary-subject-only-page",
  properties: {
    ...changedPrimarySubjectPage.properties,
    Name: { type: "title", title: [{ plain_text: multiSubjectSession.title }] },
    Subject: { type: "select", select: { name: "Specialist Mathematics" } },
    [FOCAL_ID_PROPERTY]: { type: "rich_text", rich_text: [] },
  },
}
const secondarySubjectMatchCtx = createSyncCtx()
pullFromNotion(
  [secondarySubjectOnlyPage],
  [],
  [{ ...multiSubjectSession, source: undefined }],
  notionSettings,
  VCE_SUBJECTS,
  secondarySubjectMatchCtx,
)
assert(
  !secondarySubjectMatchCtx.matchedSessionIds.has(multiSubjectSession.id),
  "a Notion page matching only a secondary subject must not be linked as the session baseline",
)

const clearedRemotePage = {
  ...remoteEventPage,
  properties: {
    ...remoteEventPage.properties,
    Name: { type: "title", title: [{ plain_text: localEvent.title }] },
    Deadline: { type: "date", date: { start: localEvent.startTime, end: null } },
    Subject: { type: "select", select: null },
  },
}
const eventWithOptionals = { ...localEvent, endTime: "2026-07-20T01:30:00.000Z", subjectId: "mm" }
const clearCtx = createSyncCtx()
pullFromNotion([clearedRemotePage], [eventWithOptionals], [], notionSettings, [], clearCtx)
const clearedUpdates = clearCtx.updatedEvents.get(localEvent.id)
if (!clearedUpdates) throw new Error("Notion clears must create a local update")
assert("endTime" in clearedUpdates && clearedUpdates.endTime === undefined, "Notion must be able to clear an event end time")
assert("subjectId" in clearedUpdates && clearedUpdates.subjectId === undefined, "Notion must be able to clear an event subject")

const baselineSnapshot = { title: "Original", startTime: "2026-07-20T01:00:00.000Z" }
const disjointMerge = mergeNotionSyncSnapshots(
  baselineSnapshot,
  { ...baselineSnapshot, title: "Local" },
  { ...baselineSnapshot, startTime: "2026-07-20T02:00:00.000Z" },
)
assert(disjointMerge.conflictingFields.length === 0, "the snapshot merge must accept disjoint changes")
assert(disjointMerge.merged.title === "Local" && disjointMerge.merged.startTime === "2026-07-20T02:00:00.000Z", "the snapshot merge must combine both sides")
const divergentMerge = mergeNotionSyncSnapshots(
  baselineSnapshot,
  { ...baselineSnapshot, title: "Local" },
  { ...baselineSnapshot, title: "Notion" },
)
assert(JSON.stringify(divergentMerge.conflictingFields) === JSON.stringify(["title"]), "only divergent edits to the same field should need a manual choice")
assert(
  resolveNotionSyncSnapshot({ startTime: "remote-time" }, { title: "local-title" }, ["title"]).startTime === "remote-time",
  "manual choices must retain already merged non-conflicting fields",
)
assert(notionSnapshotsEqual(baselineSnapshot, { ...baselineSnapshot }), "snapshot equality must be independent of object identity")
assert(
  stableJsonStringify({ b: 2, a: 1 }) === stableJsonStringify({ a: 1, b: 2 }),
  "record compare-and-swap guards must ignore object key order",
)

const subjectIds = ["b", "a"]
sessionFingerprint({ title: "Session", startTime: "2026-07-20T01:00:00.000Z", endTime: "2026-07-20T02:00:00.000Z", subjectIds, status: "planned" })
assert(JSON.stringify(subjectIds) === JSON.stringify(["b", "a"]), "session fingerprinting must not reorder the stored subject list")
const remoteOnlyCtx = createSyncCtx()
pullFromNotion([remoteEventPage], [localEvent], [], notionSettings, [], remoteOnlyCtx)
assert(remoteOnlyCtx.conflicts === 0, "a Notion-only edit should not create a false conflict")
assert(remoteOnlyCtx.updatedEvents.get(localEvent.id)?.title === "Notion title", "a Notion-only edit should pull normally")
const recoveryCtx = createSyncCtx()
pullFromNotion([remoteEventPage], [], [], notionSettings, [], recoveryCtx)
assert(recoveryCtx.created[0]?.id === localEvent.id, "a tagged Notion page must restore its stable Focal id on a new device")

const rustSource = await fetch(new URL("../src-tauri/src/commands/notion.rs", import.meta.url)).then((response) => response.text())
assert(
  rustSource.indexOf("Append the replacement before retiring") < rustSource.indexOf("Sequential deletes avoid"),
  "Notion body replacement must append the new durable copy before deleting the old one",
)
assert(
  rustSource.includes("Notion repeated a pagination cursor"),
  "Notion pagination must stop if the API repeats a cursor",
)
assert(
  rustSource.includes("retry_after_ms,"),
  "Notion query and child-write errors must preserve Retry-After",
)
const pushSource = await fetch(new URL("../src/lib/notion/push.ts", import.meta.url)).then((response) => response.text())
assert(pushSource.includes("processNotionArchiveIntents"), "Notion deletes must use the durable intent outbox")
assert(!pushSource.includes("taggedNotionOrphanIds"), "Notion pages must never be deleted merely because local data is absent")
assert(
  pushSource.includes("Notion create outcome is uncertain; it will be verified on the next sync"),
  "an unverifiable Notion create must not be retried into a duplicate page",
)
assert(
  pushSource.includes("bodyDiffers ? children : undefined"),
  "property-only pushes must preserve body edits made directly in Notion",
)
assert(
  pushSource.includes("eventWriteMatches(page, event, settings, subjects)")
    && pushSource.includes("sessionWriteMatches(page, session, settings, subjects)"),
  "successful writes must be verified before their outbox intents are acknowledged",
)
const notionHookSource = await fetch(new URL("../src/hooks/useNotionSync.ts", import.meta.url)).then((response) => response.text())
const eventHookSource = await fetch(new URL("../src/hooks/useEvents.ts", import.meta.url)).then((response) => response.text())
assert(
  notionHookSource.includes("id: currentPage.id"),
  "conflict resolution must update the refreshed Notion page rather than create a duplicate",
)
assert(!notionHookSource.includes("id: `conflict-${i}`"), "manual conflict IDs must not depend on result ordering")
assert(
  !notionHookSource.includes("currentPage?.last_edited_time === conflict.notionLastEditedTime"),
  "manual resolution must rebase instead of rejecting a stale Notion snapshot",
)
assert(notionHookSource.includes("fetchNotionPage(settings, conflict.notionPageId)"), "each manual resolution must refresh its own Notion page immediately before writing")
assert(notionHookSource.includes("rebaseNotionConflictUpdates("), "manual resolution must recompute choices from the latest local and Notion versions")
assert(notionHookSource.includes("MAX_CONFLICT_RESOLUTION_ATTEMPTS"), "manual resolution must retry concurrent local saves")
assert(
  notionHookSource.includes("clearTimeout(debounceTimerRef.current)"),
  "a direct sync must absorb a pending debounce instead of scheduling a redundant follow-up pull",
)
assert(
  eventHookSource.includes("Boolean(data.isFinished) || eventHasPassed(data)"),
  "new Notion events must preserve an explicit completed state",
)
const notionOutboxSource = await fetch(new URL("../src/lib/notion/outbox.ts", import.meta.url)).then((response) => response.text())
assert(notionOutboxSource.includes("records.payload ="), "Notion acknowledgements must not clear an intent for a newer saved record")
const conflictDialogSource = await fetch(new URL("../src/components/sync/NotionConflictDialog.tsx", import.meta.url)).then((response) => response.text())
assert(conflictDialogSource.includes("h-[min(90dvh,46rem)]"), "the manual resolver must have a bounded viewport")
assert(conflictDialogSource.includes('className="min-h-0 flex-1"'), "the conflict list must own the scrollable remaining height")
assert(conflictDialogSource.includes("aria-pressed={resolution ==="), "manual resolution choices must expose their selected state")
// The delete-tombstone helpers moved out of the engine when the sync modules were split.
const syncSinksSource = await fetch(new URL("../src/lib/sync/sinks.ts", import.meta.url)).then((response) => response.text())
assert(syncSinksSource.includes("value.integrations.notion"), "serialized study-session deletes must recover their Notion page identity")
const syncEngineSource = await fetch(new URL("../src/lib/sync/engine.ts", import.meta.url)).then((response) => response.text())
assert(syncEngineSource.includes("notionDeletePayload(table, rowId, current)"), "a local delete must carry the Notion page identity with it")

console.warn("Notion sync checks passed")
