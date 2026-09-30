import { extractFollowUpPrompts } from "../src/components/assistant/AIAssistantPanel"
import {
  buildAssistantOverview,
  buildStudyOverviewToolResult,
  executeReadOnlyFocalToolCall,
  formatEventLine,
  formatProjectLine,
  parseLooseEventCreateRequest,
  prepareStudySessionUpdate,
  toolDoneText,
  toolDisplayName,
  toolFailureText,
} from "../src/features/assistant/agent"
import { normalizeStudySession } from "../src/lib/studySessions"

const draft = parseLooseEventCreateRequest("math methods sac 8 august 1:45pm", "2026-06-19", [
  { id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#2563EB" },
])

const overview = buildAssistantOverview(
  [{
    id: "methods-sac",
    name: "Methods SAC",
    deadline: "2026-06-22",
    created_at: "2026-06-01",
    folder_path: "methods-sac",
  }],
  [normalizeStudySession({
    id: "session-1",
    subjectIds: ["mm"],
    title: "Methods revision",
    startTime: "2026-06-20T10:00:00",
    endTime: "2026-06-20T10:45:00",
    status: "planned",
    created_at: "2026-06-01",
  })],
  "2026-06-20",
)
if (overview.title !== "Methods SAC is due in 2 days") throw new Error(`Unexpected overview title: ${overview.title}`)
if (!overview.detail.includes("45 min")) throw new Error(`Unexpected overview detail: ${overview.detail}`)

const studyEvidence = buildStudyOverviewToolResult(
  [
    {
      id: "methods-sac",
      name: "Methods SAC",
      deadline: "2026-06-22",
      subjectId: "mm",
      created_at: "2026-06-01",
      folder_path: "methods-sac",
    },
    {
      id: "physics-sac",
      name: "Physics SAC",
      deadline: "2026-06-24",
      subjectId: "phy",
      created_at: "2026-06-01",
      folder_path: "physics-sac",
    },
  ],
  [normalizeStudySession({
    id: "session-1",
    subjectIds: ["mm"],
    projectId: "methods-sac",
    title: "Methods revision",
    startTime: "2026-06-20T10:00:00",
    endTime: "2026-06-20T10:45:00",
    status: "planned",
    created_at: "2026-06-01",
  })],
  [
    { id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#2563EB" },
    { id: "phy", name: "Physics", shortCode: "PHY", color: "#7C3AED" },
  ],
  "2026-06-20",
)
const gapSection = studyEvidence.split("Coverage gaps")[1] ?? ""
if (!studyEvidence.includes("Planned study in the next 7 days")) throw new Error("study overview omitted planned sessions")
if (!gapSection.includes("Physics SAC")) throw new Error(`uncovered deadline missing: ${studyEvidence}`)
if (gapSection.includes("Methods SAC")) throw new Error(`covered deadline was reported as a gap: ${studyEvidence}`)

const reply = extractFollowUpPrompts("Start with Methods.\n\n[[follow-up: Plan that session for me]]\n[[follow-up: Show my other deadlines]]")
if (reply.content !== "Start with Methods.") throw new Error(`Unexpected cleaned reply: ${reply.content}`)
if (reply.followUps.length !== 2 || reply.followUps[0] !== "Plan that session for me") {
  throw new Error(`Unexpected follow-ups: ${reply.followUps.join(", ")}`)
}
if (toolDisplayName("get_study_sessions") !== "get study sessions") throw new Error("tool label lost word spacing")
if (toolDoneText("delete_event") !== "Deleted event") throw new Error("delete tool completion label is unclear")
if (toolFailureText("list_deadlines", new Error("provider unavailable")) !== "list deadlines failed: provider unavailable.") throw new Error("tool failure text is not recoverable")

if (!draft) throw new Error("expected loose event draft")
if (draft.title !== "Math Methods SAC") throw new Error(`bad title: ${draft.title}`)
if (draft.eventType !== "sac") throw new Error(`bad event type: ${draft.eventType}`)
if (draft.subjectId !== "mm") throw new Error(`bad subject: ${draft.subjectId}`)
if (!draft.startTime) throw new Error("missing start time")
if (!draft.startTime.startsWith("2026-08-08T")) throw new Error(`bad date: ${draft.startTime}`)

const eventLine = formatEventLine({
  id: "practice-1",
  title: "Practice assessment",
  startTime: "2026-08-08T13:45:00",
  eventType: "practice-sac",
  created_at: "2026-06-01",
}, [])
if (!eventLine.includes("Practice SAC") || eventLine.includes("practice-sac")) {
  throw new Error(`event line exposed a raw event type: ${eventLine}`)
}

const projectLine = formatProjectLine({
  id: "assignment-1",
  name: "English task",
  folder_path: "English task",
  deadline: "2026-08-08",
  deadlineType: "assignment",
  created_at: "2026-06-01",
}, [], "2026-08-01")
if (!projectLine.includes("Assignment") || projectLine.includes("(assignment,")) {
  throw new Error(`project line exposed a raw deadline type: ${projectLine}`)
}

const deadlineReply = executeReadOnlyFocalToolCall(
  { name: "list_deadlines", arguments: { query: "math methods sac", startDate: "2026-08-06", endDate: "2026-08-06" } },
  {
    projects: [
      {
        id: "p1",
        name: "Methods SAC",
        deadline: "2026-08-06",
        deadlineType: "sac",
        subjectId: "mm",
        created_at: "2026-06-01",
        folder_path: "Methods SAC",
      },
    ],
    subjects: [{ id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#2563EB" }],
    today: "2026-06-19",
  },
)

if (!deadlineReply) throw new Error("expected deadline reply")
if (deadlineReply.includes("do not have information")) throw new Error(`bad deadline reply: ${deadlineReply}`)
if (!deadlineReply.includes("Methods SAC")) throw new Error(`missing deadline: ${deadlineReply}`)
if (!deadlineReply.includes("2026-08-06")) throw new Error(`missing deadline date: ${deadlineReply}`)

const nextSacsReply = executeReadOnlyFocalToolCall(
  { name: "list_deadlines", arguments: { query: "sac", range: "all_upcoming" } },
  {
    projects: [
      {
        id: "p1",
        name: "Methods SAC",
        deadline: "2026-08-06",
        deadlineType: "sac",
        subjectId: "mm",
        created_at: "2026-06-01",
        folder_path: "Methods SAC",
      },
    ],
    subjects: [{ id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#2563EB" }],
    today: "2026-06-19",
  },
)

if (!nextSacsReply?.includes("Methods SAC")) throw new Error(`next SAC lookup failed: ${nextSacsReply}`)

const overFilteredReply = executeReadOnlyFocalToolCall(
  { name: "list_deadlines", arguments: { query: "math methods sac", range: "next_14_days" } },
  {
    projects: [
      {
        id: "p1",
        name: "Methods SAC",
        deadline: "2026-08-06",
        deadlineType: "sac",
        subjectId: "mm",
        created_at: "2026-06-01",
        folder_path: "Methods SAC",
      },
    ],
    subjects: [{ id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#2563EB" }],
    today: "2026-06-19",
  },
)

if (!overFilteredReply?.includes("outside that range")) throw new Error(`missing outside-range hint: ${overFilteredReply}`)
if (!overFilteredReply.includes("2026-08-06")) throw new Error(`outside-range SAC date missing: ${overFilteredReply}`)

const subjectReply = executeReadOnlyFocalToolCall(
  { name: "list_subjects", arguments: { query: "math methods" } },
  {
    subjects: [{ id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#2563EB" }],
    today: "2026-06-19",
  },
)

if (!subjectReply?.includes("call list_deadlines next")) throw new Error(`missing subject follow-up hint: ${subjectReply}`)

const preparedSession = prepareStudySessionUpdate(
  {
    name: "update_study_session",
    arguments: {
      query: "methods revision",
      startTime: "2026-06-21T14:00:00+10:00",
      endTime: "2026-06-21T14:45:00+10:00",
      status: "completed",
    },
  },
  {
    sessions: [normalizeStudySession({
      id: "session-1",
      subjectIds: ["mm"],
      title: "Methods revision",
      startTime: "2026-06-20T10:00:00+10:00",
      endTime: "2026-06-20T10:45:00+10:00",
      status: "planned",
      created_at: "2026-06-01",
    })],
    subjects: [{ id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#2563EB" }],
    now: "2026-06-21T14:46:00+10:00",
  },
)
if ("error" in preparedSession) throw new Error(`session update failed: ${preparedSession.error}`)
if (preparedSession.session.id !== "session-1") throw new Error("session update matched the wrong session")
if (preparedSession.updates.execution?.state !== "completed") throw new Error("session completion was not prepared")
if ((preparedSession.updates.execution?.state === "completed" ? preparedSession.updates.execution.completedAt : undefined) !== "2026-06-21T14:46:00+10:00") throw new Error("session completion time was not set")

const invalidSessionTime = prepareStudySessionUpdate(
  {
    name: "update_study_session",
    arguments: { sessionId: "session-1", endTime: "2026-06-20T09:00:00+10:00" },
  },
  { sessions: [preparedSession.session] },
)
if (!("error" in invalidSessionTime) || !invalidSessionTime.error.includes("end after")) throw new Error("invalid session time was accepted")
