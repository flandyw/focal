import { combineDateAndTime, getDeadlineTypeInfo, getEventTypeInfo, getLocalDateValue } from "@/lib/utils"
import { getAssistantPersonalityInstruction } from "@/lib/settings"
import { VCE_SYSTEM_PREAMBLE } from "@/lib/aiAssistant"
import type { ToolCall, ToolDefinition } from "@/lib/providers"
import { studySessionDraftPatch } from "@/lib/studySessions"
import type { CalendarEvent, EventType, Project, StudySession, StudySessionDraft, Subject } from "@/lib/types"

export interface AssistantContextRefs {
  project?: Project | null
  focusModeActive?: boolean
}

export interface DraftStudySession {
 title: string;
 subjectIds: string[];
 projectId?: string;
 startTime: string;
 endTime: string;
 description?: string;
 notes?: string;
}

export interface DraftEvent {
 title: string;
 eventType: EventType;
 startTime: string;
 endTime?: string;
 subjectId?: string;
 description?: string;
 location?: string;
}

export type EventToolAction =
 |"none"
 |"list_events"
 |"get_event"
 |"create_event"
 |"update_event"
 |"delete_event";

export interface EventToolData {
 title?: string;
 eventType?: EventType;
 startTime?: string;
 endTime?: string;
 subjectId?: string;
 description?: string;
 location?: string;
 isFinished?: boolean;
 finishedAt?: string;
}

export interface EventToolCall {
 action: EventToolAction;
 eventId?: string;
 query?: string;
 startDate?: string;
 endDate?: string;
 data?: EventToolData;
}

export function projectContextLine(project: Project): string {
 const subject = project.subjectId ? ` (subject ${project.subjectId})` :"";
 const deadline = project.deadline ? ` with deadline ${project.deadline}` :"";
 return `User is currently looking at the assessment "${project.name}"${subject}${deadline}.`;
}

export function buildContextBits(
 contextRefs: AssistantContextRefs | undefined,
 focusModeActiveFallback: boolean,
): string {
 const bits: string[] = [];
 const project = contextRefs?.project;
 if (project) bits.push(projectContextLine(project));
 if (contextRefs?.focusModeActive ?? focusModeActiveFallback) {
 bits.push(
"User is in a Pomodoro focus block right now; if they ask for help, keep replies short so they can return to the timer.",
 );
 }
 return bits.length > 0 ? `\n${bits.join("\n")}` :"";
}

// ponytail: concise snapshot of upcoming events + sessions so the AI has
// real visibility into the calendar without hallucinating. Bounded to keep
// system prompt under ~250 tokens.
export function buildCalendarContext(
 events: CalendarEvent[] | undefined,
 sessions: StudySession[] | undefined,
 today: string,
): string {
 if (!events?.length && !sessions?.length) return"";
 const lines: string[] = [];
 const now = new Date(`${today}T00:00:00`).getTime();
 const horizon = now + 14 * 24 * 60 * 60 * 1000;

 const upcomingEvents = (events ?? [])
 .filter(
 (e) =>
 new Date(e.startTime).getTime() >= now &&
 new Date(e.startTime).getTime() <= horizon,
 )
 .sort(
 (a, b) =>
 new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
 )
 .slice(0, 5);
 const upcomingSessions = (sessions ?? [])
 .filter(
 (s) =>
 new Date(s.schedule.blocks[0].start).getTime() >= now &&
 new Date(s.schedule.blocks[0].start).getTime() <= horizon,
 )
 .sort(
 (a, b) =>
 new Date(a.schedule.blocks[0].start).getTime() - new Date(b.schedule.blocks[0].start).getTime(),
 )
 .slice(0, 5);

 if (upcomingEvents.length > 0) {
 lines.push(
 `- Upcoming events: ${upcomingEvents.map((e) => `"${e.title}" ${e.startTime.slice(0, 10)}${e.eventType ? ` (${e.eventType})` :""}`).join(";")}`,
 );
 }
 if (upcomingSessions.length > 0) {
 lines.push(
 `- Upcoming sessions: ${upcomingSessions.map((s) => `"${s.title}" ${s.schedule.blocks[0].start.slice(0, 10)}`).join(";")}`,
 );
 }
 if (lines.length === 1) return `Calendar snapshot: ${lines[0].slice(2)}`;
 return lines.length > 0 ? `Calendar snapshot:\n${lines.join("\n")}` :"";
}

export function dateOnlyMs(value: string): number | null {
 const ms = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
 return Number.isFinite(ms) ? ms : null;
}

export function daysFromToday(date: string, today: string): number | null {
 const target = dateOnlyMs(date);
 const anchor = dateOnlyMs(today);
 if (target === null || anchor === null) return null;
 return Math.round((target - anchor) / (24 * 60 * 60 * 1000));
}

export function endOfWeekDate(today: string): string {
 const date = new Date(`${today}T00:00:00`);
 date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
 return getLocalDateValue(date);
}

export function relativeDeadlineLabel(days: number): string {
 if (days < 0) return `${Math.abs(days)} day${days === -1 ?"" :"s"} overdue`;
 if (days === 0) return"today";
 if (days === 1) return"tomorrow";
 return `in ${days} days`;
}

export interface AssistantOverview {
 title: string;
 detail: string;
 prompt: string;
 hasFocalContext: boolean;
}

export function formatPlannedTime(minutes: number): string {
 if (minutes < 60) return `${minutes} min`;
 const hours = Math.floor(minutes / 60);
 const remainder = minutes % 60;
 return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildAssistantOverview(
 projects: Project[] | undefined,
 sessions: StudySession[] | undefined,
 today: string,
 currentProject?: Project | null,
): AssistantOverview {
 const nextDeadline = (projects ?? [])
 .filter(
 (project) =>
 !project.isFinished && !project.isArchived && project.deadline,
 )
 .sort((a, b) =>
 (a.deadline ??"9999").localeCompare(b.deadline ??"9999"),
 )[0];
 const todayMs = dateOnlyMs(today) ?? 0;
 const nextWeekMs = todayMs + 7 * 24 * 60 * 60 * 1000;
 const planned = (sessions ?? []).filter((session) => {
 const start = new Date(session.schedule.blocks[0].start).getTime();
 return (
 session.execution.state !=="completed" && start >= todayMs && start <= nextWeekMs
 );
 });
 const plannedMinutes = planned.reduce((total, session) => {
 const duration =
 new Date(session.schedule.blocks[session.schedule.blocks.length - 1].end).getTime() -
 new Date(session.schedule.blocks[0].start).getTime();
 return total + Math.max(0, Math.round(duration / 60_000));
 }, 0);
 const plannedDetail =
 planned.length > 0
 ? `${planned.length} study block${planned.length === 1 ?"" :"s"} · ${formatPlannedTime(plannedMinutes)} planned for the next 7 days`
 :"No study blocks planned for the next 7 days";

 if (nextDeadline?.deadline) {
 const days = daysFromToday(nextDeadline.deadline, today);
 const timing =
 days === null
 ? nextDeadline.deadline.slice(0, 10)
 : days < 0
 ? `${Math.abs(days)} day${days === -1 ?"" :"s"} overdue`
 : relativeDeadlineLabel(days);
 return {
 title:
 days !== null && days < 0
 ? `${nextDeadline.name} is ${timing}`
 : `${nextDeadline.name} is due ${timing}`,
 detail: plannedDetail,
 prompt: `Help me prepare for "${nextDeadline.name}", due ${nextDeadline.deadline.slice(0, 10)}. Check my current study sessions and suggest the single best next study block.`,
 hasFocalContext: true,
 };
 }

 if (currentProject) {
 return {
 title: `Plan the next step for ${currentProject.name}`,
 detail: plannedDetail,
 prompt: `I'm working on "${currentProject.name}". Check its details and my current study sessions, then suggest the single best next study block.`,
 hasFocalContext: true,
 };
 }

 const activeProjects = (projects ?? []).filter(
 (project) => !project.isFinished && !project.isArchived,
 );
 if (activeProjects.length > 0 || planned.length > 0) {
 return {
 title:"Turn your current workload into a plan",
 detail: `${activeProjects.length} active assessment${activeProjects.length === 1 ?"" :"s"} · ${plannedDetail.toLowerCase()}`,
 prompt:
"Review my active assessments and planned study sessions, then suggest the single best next study block.",
 hasFocalContext: true,
 };
 }

 return {
 title:"Fast answers for the next study decision",
 detail:
"Ask for a concise plan, explanation, or deadline check without leaving the workspace.",
 prompt:"Help me choose one useful 45-minute study block for today.",
 hasFocalContext: false,
 };
}

export function buildSystemMessage(
 contextDay: string,
 providerName: string,
 contextLine: string,
 calendarContext: string,
 briefing: string,
): string {
 const parts = [
 VCE_SYSTEM_PREAMBLE,
 `Today is ${contextDay}. The user is talking to ${providerName}. Use the user's existing Focal context when relevant, but never invent specific page numbers, marks, or rubric items.`,
 ];
 if (briefing) parts.push(briefing);
 if (calendarContext) parts.push(calendarContext);
 if (contextLine) parts.push(contextLine);
 parts.push(getAssistantPersonalityInstruction());
 parts.push(
 `When a reply has genuinely useful next steps, end with up to 3 clickable follow-up prompts using exactly this syntax: [[follow-up: message]]. The text must be a concise message written in the user's voice that they could send verbatim, such as"Plan those sessions for me". Offer prompts only when the answer naturally branches or a useful action remains. Do not add them to simple factual answers, errors, confirmations, or every reply. Never mention this syntax.`,
 );
 return parts.join("\n\n");
}

export function buildFocalAgentSystemMessage(
 baseSystemMessage: string,
 contextDay: string,
): string {
 return `${baseSystemMessage}

You are in a Focal tool-using agent loop. Use tools before answering any request that depends on the user's current Focal data: deadlines, assessments/projects, study sessions, subjects, calendar events, or event edits. You may answer general study advice directly when it does not need Focal data.

Tool rules:
- Never say you do not have Focal information until the relevant tool returns no matches.
- For SAC, exam, assignment, assessment, deadline, due-date, next, or upcoming assessment questions, call list_deadlines before the final answer.
- If the user asks for"next 3 SACs" or similar, call list_deadlines with query"sac" and range"all_upcoming", then answer from the earliest results.
- For study-session questions, call list_study_sessions.
- For workload, prioritization, or"what should I do next?" questions, call get_study_overview.
- Base prioritization on the returned deadline, planned-time, and coverage-gap evidence. Name the evidence briefly, then recommend one concrete next block instead of generic study tips.
- Use create_study_session only when the user explicitly asks to create or schedule a session. Resolve project and subject ids first when needed.
- Use update_study_session when the user explicitly asks to reschedule, rename, complete, or edit a study session. Call list_study_sessions first when the session id is unknown; never guess between multiple matches.
- For subject ids, call list_subjects when unsure.
- If you call list_subjects for an assessment-date question, you must still call list_deadlines before answering.
- For event create/update/delete/read requests, use the event tools. The app confirms destructive deletion.
- After tool results arrive, answer naturally and briefly from the tool result.
- Do not tell the user to use an external calendar app.

Today is ${contextDay}. Date phrases are relative to this date. Tool range values include this_week, next_7_days, next_14_days, all_upcoming, and all. Use only these event types: ${EVENT_TYPE_ENUM.join(", ")}.`;
}

export const SESSION_DRAFT_SCHEMA = {
 type:"object",
 properties: {
 title: { type:"string" },
 subjectIds: { type:"array", items: { type:"string" } },
 projectId: { type:"string" },
 startTime: { type:"string" },
 endTime: { type:"string" },
 description: { type:"string" },
 notes: { type:"string" },
 },
 required: ["title","subjectIds","startTime","endTime"],
} as const;

export const EVENT_TYPE_ENUM = [
"sac",
"exam",
"assignment",
"event",
"homework",
"other",
"practice-sac",
] as const satisfies readonly EventType[];

export const EVENT_TOOL_ACTIONS = [
"none",
"list_events",
"get_event",
"create_event",
"update_event",
"delete_event",
] as const satisfies readonly EventToolAction[];
export const MONTH_INDEX: Record<string, number> = {
 jan: 1,
 january: 1,
 feb: 2,
 february: 2,
 mar: 3,
 march: 3,
 apr: 4,
 april: 4,
 may: 5,
 jun: 6,
 june: 6,
 jul: 7,
 july: 7,
 aug: 8,
 august: 8,
 sep: 9,
 sept: 9,
 september: 9,
 oct: 10,
 october: 10,
 nov: 11,
 november: 11,
 dec: 12,
 december: 12,
};

export const EVENT_DRAFT_SCHEMA = {
 type:"object",
 properties: {
 title: { type:"string" },
 eventType: { type:"string", enum: EVENT_TYPE_ENUM },
 startTime: { type:"string" },
 endTime: { type:"string" },
 subjectId: { type:"string" },
 description: { type:"string" },
 location: { type:"string" },
 },
 required: ["title","eventType","startTime"],
} as const;

export const EVENT_TOOL_SCHEMA = {
 type:"object",
 properties: {
 action: { type:"string", enum: EVENT_TOOL_ACTIONS },
 eventId: {
 type:"string",
 description:"Existing Focal event id when known; otherwise empty.",
 },
 query: {
 type:"string",
 description:
"Plain-text event title/search hint when id is unknown; otherwise empty.",
 },
 startDate: {
 type:"string",
 description:
"YYYY-MM-DD lower date bound when relevant; otherwise empty.",
 },
 endDate: {
 type:"string",
 description:
"YYYY-MM-DD upper date bound when relevant; otherwise empty.",
 },
 data: {
 type:"object",
 properties: {
 title: { type:"string" },
 eventType: { type:"string", enum: EVENT_TYPE_ENUM },
 startTime: { type:"string", description:"ISO 8601 datetime." },
 endTime: { type:"string", description:"ISO 8601 datetime or empty." },
 subjectId: { type:"string", description:"Subject id or empty." },
 description: { type:"string" },
 location: { type:"string" },
 isFinished: { type:"boolean" },
 finishedAt: {
 type:"string",
 description:"ISO 8601 datetime or empty.",
 },
 },
 },
 },
 required: ["action"],
} as const;

export const FOCAL_AGENT_TOOLS: ToolDefinition[] = [
 {
 type:"function",
 function: {
 name:"list_deadlines",
 description:
"List Focal assessment/project deadlines. Use this before answering SAC, exam, assignment, assessment, deadline, due-date, next, or upcoming assessment questions.",
 parameters: {
 type:"object",
 properties: {
 query: {
 type:"string",
 description:
"Optional title, subject, type, unit, or notes search text.",
 },
 range: {
 type:"string",
 enum: [
"this_week",
"next_7_days",
"next_14_days",
"all_upcoming",
"all",
 ],
 description:
"Optional date window. Prefer all_upcoming for 'next N SACs' and this_week only when the user says this week.",
 },
 startDate: {
 type:"string",
 description:"Optional YYYY-MM-DD lower bound.",
 },
 endDate: {
 type:"string",
 description:"Optional YYYY-MM-DD upper bound.",
 },
 includeFinished: {
 type:"boolean",
 description:"Whether to include finished assessments.",
 },
 includeArchived: {
 type:"boolean",
 description:"Whether to include archived assessments.",
 },
 },
 },
 },
 },
 {
 type:"function",
 function: {
 name:"list_projects",
 description:
"List Focal assessment/project records, optionally filtered by search text or deadline date.",
 parameters: {
 type:"object",
 properties: {
 query: {
 type:"string",
 description:
"Optional title, subject, type, unit, notes, or id search text.",
 },
 range: {
 type:"string",
 enum: [
"this_week",
"next_7_days",
"next_14_days",
"all_upcoming",
"all",
 ],
 description:"Optional deadline date window.",
 },
 startDate: {
 type:"string",
 description:"Optional YYYY-MM-DD deadline lower bound.",
 },
 endDate: {
 type:"string",
 description:"Optional YYYY-MM-DD deadline upper bound.",
 },
 includeFinished: { type:"boolean" },
 includeArchived: { type:"boolean" },
 },
 },
 },
 },
 {
 type:"function",
 function: {
 name:"list_study_sessions",
 description:
"List Focal study sessions, optionally filtered by query, date range, or status.",
 parameters: {
 type:"object",
 properties: {
 query: {
 type:"string",
 description:
"Optional title, subject, project, notes, topic, or blocker search text.",
 },
 range: {
 type:"string",
 enum: [
"this_week",
"next_7_days",
"next_14_days",
"all_upcoming",
"all",
 ],
 description:"Optional session start-date window.",
 },
 startDate: {
 type:"string",
 description:"Optional YYYY-MM-DD lower bound.",
 },
 endDate: {
 type:"string",
 description:"Optional YYYY-MM-DD upper bound.",
 },
 status: {
 type:"string",
 enum: ["planned","in-progress","completed"],
 },
 },
 },
 },
 },
 {
 type:"function",
 function: {
 name:"list_subjects",
 description:
"List Focal subjects and ids. Use before choosing or explaining subject ids.",
 parameters: {
 type:"object",
 properties: {
 query: {
 type:"string",
 description:
"Optional subject name, short code, or id search text.",
 },
 },
 },
 },
 },
 {
 type:"function",
 function: {
 name:"get_study_overview",
 description:
"Summarize the user's active workload, nearest deadline, and planned study time. Use for prioritization, workload, and 'what should I do next?' questions.",
 parameters: { type:"object", properties: {} },
 },
 },
 {
 type:"function",
 function: {
 name:"create_study_session",
 description:
"Create a Focal study session only when the user explicitly asks to schedule or create one.",
 parameters: {
 type:"object",
 properties: {
 title: { type:"string" },
 subjectIds: {
 type:"array",
 items: { type:"string" },
 description:"Subject ids from list_subjects.",
 },
 projectId: {
 type:"string",
 description:"Optional project id from list_projects.",
 },
 startTime: { type:"string", description:"ISO 8601 datetime." },
 endTime: {
 type:"string",
 description:"ISO 8601 datetime after startTime.",
 },
 description: { type:"string" },
 notes: { type:"string" },
 },
 required: ["title","subjectIds","startTime","endTime"],
 },
 },
 },
 {
 type:"function",
 function: {
 name:"update_study_session",
 description:
"Reschedule, rename, complete, or edit one existing Focal study session. Identify exactly one session, then provide only changed fields.",
 parameters: {
 type:"object",
 properties: {
 sessionId: {
 type:"string",
 description:"Existing Focal study-session id when known.",
 },
 query: {
 type:"string",
 description:
"Title, subject, or project search hint when id is unknown.",
 },
 title: { type:"string" },
 subjectIds: {
 type:"array",
 items: { type:"string" },
 description:"Subject ids from list_subjects.",
 },
 projectId: {
 type:"string",
 description:"Project id from list_projects.",
 },
 startTime: { type:"string", description:"ISO 8601 datetime." },
 endTime: {
 type:"string",
 description:"ISO 8601 datetime after startTime.",
 },
 description: { type:"string" },
 topics: { type:"array", items: { type:"string" } },
 notes: { type:"string" },
 status: {
 type:"string",
 enum: ["planned","in-progress","completed"],
 },
 confidence: { type:"number", enum: [1, 2, 3, 4, 5] },
 blockers: { type:"string" },
 nextAction: { type:"string" },
 },
 },
 },
 },
 {
 type:"function",
 function: {
 name:"list_events",
 description:
"List Focal calendar events, optionally filtered by query and YYYY-MM-DD date range.",
 parameters: {
 type:"object",
 properties: {
 query: {
 type:"string",
 description:
"Optional title, subject, type, or location search text.",
 },
 startDate: {
 type:"string",
 description:"Optional YYYY-MM-DD lower bound.",
 },
 endDate: {
 type:"string",
 description:"Optional YYYY-MM-DD upper bound.",
 },
 },
 },
 },
 },
 {
 type:"function",
 function: {
 name:"get_event",
 description:
"Get details for one existing Focal event by id or a precise query.",
 parameters: {
 type:"object",
 properties: {
 eventId: {
 type:"string",
 description:"Existing Focal event id when known.",
 },
 query: {
 type:"string",
 description:"Title/search hint when id is unknown.",
 },
 startDate: {
 type:"string",
 description:"Optional YYYY-MM-DD lower bound.",
 },
 endDate: {
 type:"string",
 description:"Optional YYYY-MM-DD upper bound.",
 },
 },
 },
 },
 },
 {
 type:"function",
 function: {
 name:"create_event",
 description:
"Create a Focal calendar event. Use known details; missing details will be reported back to the user.",
 parameters: {
 type:"object",
 properties: {
 title: { type:"string" },
 eventType: { type:"string", enum: EVENT_TYPE_ENUM },
 startTime: { type:"string", description:"ISO 8601 datetime." },
 endTime: {
 type:"string",
 description:"Optional ISO 8601 datetime.",
 },
 subjectId: {
 type:"string",
 description:"Optional subject id from the provided subject list.",
 },
 description: { type:"string" },
 location: { type:"string" },
 },
 },
 },
 },
 {
 type:"function",
 function: {
 name:"update_event",
 description:
"Update one existing Focal event. Identify exactly one event, then provide only changed fields.",
 parameters: {
 type:"object",
 properties: {
 eventId: {
 type:"string",
 description:"Existing Focal event id when known.",
 },
 query: {
 type:"string",
 description:"Title/search hint when id is unknown.",
 },
 startDate: {
 type:"string",
 description:"Optional YYYY-MM-DD lower bound for matching.",
 },
 endDate: {
 type:"string",
 description:"Optional YYYY-MM-DD upper bound for matching.",
 },
 title: { type:"string" },
 eventType: { type:"string", enum: EVENT_TYPE_ENUM },
 startTime: { type:"string", description:"ISO 8601 datetime." },
 endTime: { type:"string", description:"ISO 8601 datetime." },
 subjectId: { type:"string" },
 description: { type:"string" },
 location: { type:"string" },
 isFinished: { type:"boolean" },
 finishedAt: { type:"string", description:"ISO 8601 datetime." },
 },
 },
 },
 },
 {
 type:"function",
 function: {
 name:"delete_event",
 description:
"Delete one existing Focal event. The app will still ask the user to confirm destructive deletion.",
 parameters: {
 type:"object",
 properties: {
 eventId: {
 type:"string",
 description:"Existing Focal event id when known.",
 },
 query: {
 type:"string",
 description:"Title/search hint when id is unknown.",
 },
 startDate: {
 type:"string",
 description:"Optional YYYY-MM-DD lower bound for matching.",
 },
 endDate: {
 type:"string",
 description:"Optional YYYY-MM-DD upper bound for matching.",
 },
 },
 },
 },
 },
];

export function isRecord(value: unknown): value is Record<string, unknown> {
 return typeof value ==="object" && value !== null && !Array.isArray(value);
}

export function readOptionalString(
 record: Record<string, unknown>,
 key: string,
): string | undefined {
 const value = record[key];
 return typeof value ==="string" && value.trim() ? value.trim() : undefined;
}

export function readOptionalBoolean(
 record: Record<string, unknown>,
 key: string,
): boolean | undefined {
 const value = record[key];
 return typeof value ==="boolean" ? value : undefined;
}

export function readOptionalStringArray(
 record: Record<string, unknown>,
 key: string,
): string[] | undefined {
 const value = record[key];
 if (!Array.isArray(value)) return undefined;
 return value.filter(
 (item): item is string =>
 typeof item ==="string" && item.trim().length > 0,
 );
}

export function isEventType(value: unknown): value is EventType {
 return (
 typeof value ==="string" && EVENT_TYPE_ENUM.includes(value as EventType)
 );
}

export function isIsoDateTime(value: string | undefined): value is string {
 return Boolean(value && Number.isFinite(new Date(value).getTime()));
}

export function normaliseKey(value: string): string {
 return value
 .toLowerCase()
 .replace(/[^a-z0-9]+/g," ")
 .trim();
}

export function searchQueryVariants(query: string): string[] {
 const key = normaliseKey(query);
 if (!key) return [];
 return Array.from(
 new Set([
 key,
 key.replace(/\bmaths?\b/g,"mathematical"),
 key.replace(/\bmathematical\b/g,"math"),
 ]),
 );
}

export function searchMatches(value: string, query: string | undefined): boolean {
 if (!query) return true;
 const haystack = normaliseKey(value);
 return searchQueryVariants(query).some((variant) => {
 const terms = variant.split(/\s+/).filter(Boolean);
 return (
 terms.length === 0 ||
 haystack.includes(variant) ||
 terms.every((term) => haystack.includes(term))
 );
 });
}

export function titleCase(value: string): string {
 return value
 .split(/\s+/)
 .filter(Boolean)
 .map((word) =>
 word.length <= 3
 ? word.toUpperCase()
 : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`,
 )
 .join(" ");
}

export function parseLooseTime(value: string): string | undefined {
 const match = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(value);
 if (!match) return undefined;
 let hours = Number(match[1]);
 const minutes = Number(match[2] ??"00");
 if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59)
 return undefined;
 const meridiem = match[3]?.toLowerCase();
 if (meridiem) {
 if (hours < 1 || hours > 12) return undefined;
 if (hours === 12) hours = 0;
 if (meridiem ==="pm") hours += 12;
 } else if (hours > 23) {
 return undefined;
 }
 return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}`;
}

export function dateMatchesParts(
 date: Date,
 year: number,
 month: number,
 day: number,
): boolean {
 return (
 date.getFullYear() === year &&
 date.getMonth() + 1 === month &&
 date.getDate() === day
 );
}

export function inferEventTypeFromText(text: string): EventType {
 const lower = text.toLowerCase();
 if (/\bpractice\s+sac\b|\bpractice-sac\b/.test(lower)) return"practice-sac";
 for (const type of EVENT_TYPE_ENUM) {
 if (type !=="practice-sac" && new RegExp(`\\b${type}\\b`,"i").test(lower))
 return type;
 }
 return"event";
}

export function inferSubjectIdFromText(
 text: string,
 subjects: Subject[] | undefined,
): string | undefined {
 const key = normaliseKey(text);
 const variants = [key, key.replace(/\bmaths?\b/g,"mathematical")];
 return subjects?.find((subject) => {
 const name = normaliseKey(subject.name);
 const code = normaliseKey(subject.shortCode);
 return variants.some((variant) => {
 const compact = variant.replace(/\s+/g,"");
 return (
 compact.includes(name.replace(/\s+/g,"")) ||
 compact.includes(code.replace(/\s+/g,""))
 );
 });
 })?.id;
}

// eslint-disable-next-line react-refresh/only-export-components
export function parseLooseEventCreateRequest(
 text: string,
 today: string,
 subjects: Subject[] | undefined,
): EventToolData | null {
 const dateMatch =
 /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/i.exec(
 text,
 );
 if (!dateMatch) return null;
 const month = MONTH_INDEX[dateMatch[2].toLowerCase()];
 const day = Number(dateMatch[1]);
 if (!month || !Number.isInteger(day) || day < 1 || day > 31) return null;
 const timeText = text.slice(dateMatch.index + dateMatch[0].length);
 const timeValue = parseLooseTime(timeText) ?? parseLooseTime(text);
 if (!timeValue) return null;

 const todayDate = new Date(`${today}T00:00:00`);
 const year = dateMatch[3] ? Number(dateMatch[3]) : todayDate.getFullYear();
 const dateValue = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
 let start = combineDateAndTime(dateValue, timeValue);
 if (start && !dateMatchesParts(start, year, month, day)) return null;
 if (!dateMatch[3] && start && start < todayDate) {
 const nextYear = year + 1;
 start = combineDateAndTime(
 `${nextYear}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`,
 timeValue,
 );
 if (start && !dateMatchesParts(start, nextYear, month, day)) return null;
 }
 if (!start) return null;

 const beforeDate = text
 .slice(0, dateMatch.index)
 .replace(/\b(on|at|for)\b/gi,"")
 .trim();
 const eventType = inferEventTypeFromText(text);
 const titleSource =
 beforeDate ||
 text
 .replace(dateMatch[0],"")
 .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i,"")
 .trim();
 const title = titleCase(titleSource || eventType);
 if (!title) return null;
 return {
 title,
 eventType,
 startTime: start.toISOString(),
 subjectId: inferSubjectIdFromText(titleSource, subjects),
 };
}

export function normaliseEventToolCall(raw: unknown): EventToolCall {
 if (!isRecord(raw)) return { action:"none" };
 const action = EVENT_TOOL_ACTIONS.includes(raw.action as EventToolAction)
 ? (raw.action as EventToolAction)
 :"none";
 const dataRaw = isRecord(raw.data) ? raw.data : {};
 const eventType = dataRaw.eventType;
 return {
 action,
 eventId: readOptionalString(raw,"eventId"),
 query: readOptionalString(raw,"query"),
 startDate: readOptionalString(raw,"startDate"),
 endDate: readOptionalString(raw,"endDate"),
 data: {
 title: readOptionalString(dataRaw,"title"),
 eventType: isEventType(eventType) ? eventType : undefined,
 startTime: readOptionalString(dataRaw,"startTime"),
 endTime: readOptionalString(dataRaw,"endTime"),
 subjectId: readOptionalString(dataRaw,"subjectId"),
 description: readOptionalString(dataRaw,"description"),
 location: readOptionalString(dataRaw,"location"),
 isFinished: readOptionalBoolean(dataRaw,"isFinished"),
 finishedAt: readOptionalString(dataRaw,"finishedAt"),
 },
 };
}

export function eventToolCallFromNative(call: ToolCall): EventToolCall {
 const args = call.arguments;
 const data: Record<string, unknown> = {};
 for (const key of [
"title",
"eventType",
"startTime",
"endTime",
"subjectId",
"description",
"location",
"isFinished",
"finishedAt",
 ]) {
 if (args[key] !== undefined) data[key] = args[key];
 }
 return normaliseEventToolCall({
 action: call.name,
 eventId: args.eventId,
 query: args.query,
 startDate: args.startDate,
 endDate: args.endDate,
 data,
 });
}

export function hasEventToolIntent(text: string): boolean {
 return /\b(event|events|calendar|schedule|deadline|exam|sac|assignment|homework|due|reschedule|move|rename|delete|remove|mark|finish|finished)\b/i.test(
 text,
 );
}

export function hasEventMutationIntent(text: string): boolean {
 return /\b(add|create|make|schedule|put|edit|update|change|move|reschedule|rename|delete|remove|mark|finish|finished)\b/i.test(
 text,
 );
}

export function eventSubjectLabel(
 subjects: Subject[] | undefined,
 subjectId: string | undefined,
): string {
 if (!subjectId) return"no subject";
 const subject = subjects?.find((item) => item.id === subjectId);
 return subject ? `${subject.shortCode} ${subject.name}` : subjectId;
}

export function formatEventLine(
 event: CalendarEvent,
 subjects: Subject[] | undefined,
): string {
 const when = `${event.startTime}${event.endTime ? ` to ${event.endTime}` :""}`;
 const done = event.isFinished ?"finished" :"current";
 return `- ${event.id}:"${event.title}" (${getEventTypeInfo(event.eventType).label}, ${done}) ${when}; ${eventSubjectLabel(subjects, event.subjectId)}${event.location ? `; ${event.location}` :""}`;
}

export function buildEventToolContext(
 events: CalendarEvent[] | undefined,
 subjects: Subject[] | undefined,
 today: string,
): string {
 const items = (events ?? [])
 .slice()
 .sort(
 (a, b) =>
 Math.abs(
 new Date(a.startTime).getTime() -
 new Date(`${today}T00:00:00`).getTime(),
 ) -
 Math.abs(
 new Date(b.startTime).getTime() -
 new Date(`${today}T00:00:00`).getTime(),
 ),
 )
 .slice(0, 40);
 const eventLines =
 items.length > 0
 ? items.map((event) => formatEventLine(event, subjects)).join("\n")
 :"No events.";
 const subjectLines =
 (subjects ?? [])
 .map(
 (subject) => `- ${subject.id}: ${subject.name} (${subject.shortCode})`,
 )
 .join("\n") ||"No subjects.";
 return `Available event types: ${EVENT_TYPE_ENUM.join(", ")}

Subjects:
${subjectLines}

Nearest Focal events, by id:
${eventLines}`;
}

export function eventMatchesDate(
 event: CalendarEvent,
 startDate?: string,
 endDate?: string,
): boolean {
 const date = event.startTime.slice(0, 10);
 return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

export function eventSearchText(
 event: CalendarEvent,
 subjects: Subject[] | undefined,
): string {
 return [
 event.id,
 event.title,
 event.description,
 event.eventType,
 event.location,
 event.subjectId,
 eventSubjectLabel(subjects, event.subjectId),
 ]
 .filter(Boolean)
 .join("");
}

export function findToolEvent(
 events: CalendarEvent[] | undefined,
 subjects: Subject[] | undefined,
 call: EventToolCall,
): { event?: CalendarEvent; matches: CalendarEvent[]; reason?: string } {
 const list = events ?? [];
 if (call.eventId) {
 const event = list.find((item) => item.id === call.eventId);
 return event
 ? { event, matches: [event] }
 : { matches: [], reason: `No event has id ${call.eventId}.` };
 }
 const scoped = list.filter((event) =>
 eventMatchesDate(event, call.startDate, call.endDate),
 );
 const query = call.query?.trim();
 if (!query) {
 return scoped.length === 1
 ? { event: scoped[0], matches: scoped }
 : {
 matches: scoped,
 reason:
 scoped.length === 0
 ?"No matching events found."
 :"More than one event matches.",
 };
 }
 const exact = scoped.filter(
 (event) => normaliseKey(event.title) === normaliseKey(query),
 );
 if (exact.length === 1) return { event: exact[0], matches: exact };
 const matches = scoped.filter((event) =>
 searchMatches(eventSearchText(event, subjects), query),
 );
 return matches.length === 1
 ? { event: matches[0], matches }
 : {
 matches,
 reason:
 matches.length === 0
 ?"No matching events found."
 :"More than one event matches.",
 };
}

export function listToolEvents(
 events: CalendarEvent[] | undefined,
 subjects: Subject[] | undefined,
 call: EventToolCall,
): CalendarEvent[] {
 const query = call.query?.trim();
 return (events ?? [])
 .filter((event) => eventMatchesDate(event, call.startDate, call.endDate))
 .filter((event) => searchMatches(eventSearchText(event, subjects), query))
 .sort(
 (a, b) =>
 new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
 )
 .slice(0, 20);
}

export function addDays(date: string, days: number): string {
 const base = dateOnlyMs(date) ?? Date.now();
 return getLocalDateValue(new Date(base + days * 24 * 60 * 60 * 1000));
}

export function readToolDateRange(
 args: Record<string, unknown>,
 today: string,
): { startDate?: string; endDate?: string } {
 const startDate = readOptionalString(args,"startDate");
 const endDate = readOptionalString(args,"endDate");
 const range = readOptionalString(args,"range");
 if (startDate || endDate) return { startDate, endDate };
 if (range ==="this_week")
 return { startDate: today, endDate: endOfWeekDate(today) };
 if (range ==="next_7_days")
 return { startDate: today, endDate: addDays(today, 7) };
 if (range ==="next_14_days")
 return { startDate: today, endDate: addDays(today, 14) };
 if (range ==="all_upcoming") return { startDate: today };
 return {};
}

export function dateMatchesRange(
 value: string | undefined,
 startDate?: string,
 endDate?: string,
): boolean {
 if (!value) return !startDate && !endDate;
 const date = value.slice(0, 10);
 return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

export function projectSubjectLabel(
 subjects: Subject[] | undefined,
 subjectId: string | undefined,
): string {
 if (!subjectId) return"no subject";
 const subject = subjects?.find((item) => item.id === subjectId);
 return subject ? `${subject.shortCode} ${subject.name}` : subjectId;
}

export function projectSearchText(
 project: Project,
 subjects: Subject[] | undefined,
): string {
 return [
 project.id,
 project.name,
 project.description,
 project.deadlineType,
 project.deadline,
 project.unit,
 project.subjectId,
 projectSubjectLabel(subjects, project.subjectId),
 project.notes,
 ]
 .filter(Boolean)
 .join("");
}

export function formatProjectLine(
 project: Project,
 subjects: Subject[] | undefined,
 today: string,
): string {
 const state = project.isFinished
 ?"finished"
 : project.isArchived
 ?"archived"
 :"active";
 const days = project.deadline ? daysFromToday(project.deadline, today) : null;
 const deadline = project.deadline
 ? `due ${project.deadline.slice(0, 10)}${
 days !== null ? ` (${relativeDeadlineLabel(days)})` :""
 }`
 :"no deadline";
 return [
 `- ${project.id}:"${project.name}"`,
 `(${project.deadlineType ? getDeadlineTypeInfo(project.deadlineType).label : "Assessment"}, ${state})`,
 deadline,
 projectSubjectLabel(subjects, project.subjectId),
 project.unit ? `Unit ${project.unit}` : null,
 ]
 .filter(Boolean)
 .join(";");
}

export function filterProjectsForTool(
 projects: Project[] | undefined,
 subjects: Subject[] | undefined,
 opts: {
 query?: string;
 startDate?: string;
 endDate?: string;
 includeFinished: boolean;
 includeArchived: boolean;
 onlyDeadlines: boolean;
 ignoreDate?: boolean;
 },
): Project[] {
 return (projects ?? [])
 .filter((project) => opts.includeFinished || !project.isFinished)
 .filter((project) => opts.includeArchived || !project.isArchived)
 .filter((project) => !opts.onlyDeadlines || Boolean(project.deadline))
 .filter(
 (project) =>
 opts.ignoreDate === true ||
 dateMatchesRange(project.deadline, opts.startDate, opts.endDate),
 )
 .filter((project) =>
 searchMatches(projectSearchText(project, subjects), opts.query),
 );
}

export function sessionSearchText(
 session: StudySession,
 subjects: Subject[] | undefined,
 projects: Project[] | undefined,
): string {
 const project = projects?.find((item) => item.id === session.projectId);
 const subjectLabels = session.subjectIds
 .map((id) => projectSubjectLabel(subjects, id))
 .join("");
 return [
 session.id,
 session.title,
 session.description,
 session.execution.state,
 session.reflection?.notes,
 session.reflection?.blockers,
 session.reflection?.nextAction,
 session.topics?.join(""),
 subjectLabels,
 project?.name,
 ]
 .filter(Boolean)
 .join("");
}

export function formatSessionLine(
 session: StudySession,
 subjects: Subject[] | undefined,
 projects: Project[] | undefined,
): string {
 const project = projects?.find((item) => item.id === session.projectId);
 const subjectLabels =
 session.subjectIds
 .map((id) => projectSubjectLabel(subjects, id))
 .join(", ") ||"no subject";
 const projectLabel = project ? `; project "${project.name}"` :"";
 const confidence = session.reflection?.confidence
 ? `; confidence ${session.reflection.confidence}/5`
 :"";
 return `- ${session.id}:"${session.title}" (${session.execution.state}) ${session.schedule.blocks[0].start} to ${session.schedule.blocks[session.schedule.blocks.length - 1].end}; ${subjectLabels}${projectLabel}${confidence}`;
}

export type PreparedStudySessionUpdate =
 | {
 session: StudySession;
 updates: Partial<Omit<StudySession,"id" |"created_at">>;
 }
 | { error: string };

// eslint-disable-next-line react-refresh/only-export-components
export function prepareStudySessionUpdate(
 call: ToolCall,
 context: {
 sessions?: StudySession[];
 subjects?: Subject[];
 projects?: Project[];
 now?: string;
 },
): PreparedStudySessionUpdate {
 const args = call.arguments;
 const sessionId = readOptionalString(args,"sessionId");
 const query = readOptionalString(args,"query");
 const candidates = context.sessions ?? [];
 let matches = sessionId
 ? candidates.filter((session) => session.id === sessionId)
 : candidates.filter((session) =>
 searchMatches(
 sessionSearchText(session, context.subjects, context.projects),
 query,
 ),
 );
 if (!sessionId && query) {
 const exact = matches.filter(
 (session) => normaliseKey(session.title) === normaliseKey(query),
 );
 if (exact.length === 1) matches = exact;
 }
 if (matches.length !== 1) {
 if (matches.length === 0)
 return { error:"No matching study session found." };
 return {
 error: `More than one study session matches:\n${matches
 .slice(0, 8)
 .map((session) =>
 formatSessionLine(session, context.subjects, context.projects),
 )
 .join("\n")}`,
 };
 }

 const session = matches[0];
 const updates: Partial<StudySessionDraft> = {};
 const title = readOptionalString(args,"title");
 const subjectIds = readOptionalStringArray(args,"subjectIds");
 const projectId = readOptionalString(args,"projectId");
 const startTime = readOptionalString(args,"startTime");
 const endTime = readOptionalString(args,"endTime");
 const status = readOptionalString(args,"status");
 const confidence = args.confidence;

 if (title) updates.title = title;
 if (subjectIds) updates.subjectIds = subjectIds;
 if (projectId) updates.projectId = projectId;
 if (startTime) updates.startTime = startTime;
 if (endTime) updates.endTime = endTime;
 for (const key of [
"description",
"notes",
"blockers",
"nextAction",
 ] as const) {
 const value = readOptionalString(args, key);
 if (value) updates[key] = value;
 }
 const topics = readOptionalStringArray(args,"topics");
 if (topics) updates.topics = topics;
 if (
 status ==="planned" ||
 status ==="in-progress" ||
 status ==="completed"
 ) {
 updates.status = status;
 updates.completedAt =
 status ==="completed"
 ? (context.now ?? new Date().toISOString())
 : undefined;
 } else if (status) {
 return { error: `"${status}" is not a valid study-session status.` };
 }
 if (confidence !== undefined) {
 if (
 confidence !== 1 &&
 confidence !== 2 &&
 confidence !== 3 &&
 confidence !== 4 &&
 confidence !== 5
 ) {
 return { error:"Confidence must be a whole number from 1 to 5." };
 }
 updates.confidence = confidence;
 }

 if (Object.keys(updates).length === 0)
 return { error:"No study-session changes were provided." };
 if (
 subjectIds?.some(
 (id) => !(context.subjects ?? []).some((subject) => subject.id === id),
 )
 ) {
 return {
 error:
"One or more subject ids do not exist, so I did not update the session.",
 };
 }
 if (
 projectId &&
 !(context.projects ?? []).some((project) => project.id === projectId)
 ) {
 return {
 error: `Project id "${projectId}" does not exist, so I did not update the session.`,
 };
 }
 const nextStart = updates.startTime ?? session.schedule.blocks[0].start;
 const nextEnd = updates.endTime ?? session.schedule.blocks[session.schedule.blocks.length - 1].end;
 if (!isIsoDateTime(nextStart) || !isIsoDateTime(nextEnd)) {
 return {
 error:"The updated study-session times were not valid ISO dates.",
 };
 }
 if (new Date(nextEnd).getTime() <= new Date(nextStart).getTime()) {
 return { error:"The study session must end after it starts." };
 }
 return { session, updates: studySessionDraftPatch(session, updates) };
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildStudyOverviewToolResult(
 projects: Project[] | undefined,
 sessions: StudySession[] | undefined,
 subjects: Subject[] | undefined,
 today: string,
): string {
 const overview = buildAssistantOverview(projects, sessions, today);
 const todayMs = dateOnlyMs(today) ?? 0;
 const nextWeekMs = todayMs + 7 * 24 * 60 * 60 * 1000;
 const nextFortnightMs = todayMs + 14 * 24 * 60 * 60 * 1000;
 const nearestDeadlines = (projects ?? [])
 .filter(
 (project) =>
 !project.isFinished && !project.isArchived && project.deadline,
 )
 .sort((a, b) => (a.deadline ??"9999").localeCompare(b.deadline ??"9999"))
 .slice(0, 5);
 const plannedSessions = (sessions ?? [])
 .filter((session) => {
 const start = new Date(session.schedule.blocks[0].start).getTime();
 return (
 session.execution.state !=="completed" &&
 start >= todayMs &&
 start <= nextWeekMs
 );
 })
 .sort(
 (a, b) =>
 new Date(a.schedule.blocks[0].start).getTime() - new Date(b.schedule.blocks[0].start).getTime(),
 )
 .slice(0, 8);
 // ponytail: project/subject linkage is a deliberately cheap coverage heuristic.
 // Upgrade to explicit per-assessment coverage only if sessions gain that relation.
 const uncovered = nearestDeadlines.filter((project) => {
 const deadlineMs = project.deadline ? dateOnlyMs(project.deadline) : null;
 if (deadlineMs === null || deadlineMs > nextFortnightMs) return false;
 return !(sessions ?? []).some((session) => {
 if (session.execution.state ==="completed") return false;
 const start = new Date(session.schedule.blocks[0].start).getTime();
 if (start < todayMs || start > deadlineMs + 24 * 60 * 60 * 1000 - 1)
 return false;
 return (
 session.projectId === project.id ||
 Boolean(
 project.subjectId && session.subjectIds.includes(project.subjectId),
 )
 );
 });
 });

 const deadlineEvidence =
 nearestDeadlines.length > 0
 ? nearestDeadlines
 .map((project) => formatProjectLine(project, subjects, today))
 .join("\n")
 :"- None";
 const sessionEvidence =
 plannedSessions.length > 0
 ? plannedSessions
 .map((session) => formatSessionLine(session, subjects, projects))
 .join("\n")
 :"- None";
 const gapEvidence =
 uncovered.length > 0
 ? uncovered
 .map((project) => formatProjectLine(project, subjects, today))
 .join("\n")
 :"- None among deadlines in the next 14 days";

 return `Study overview: ${overview.title}. ${overview.detail}.

Nearest active deadlines:
${deadlineEvidence}

Planned study in the next 7 days:
${sessionEvidence}

Coverage gaps (no linked planned session before the deadline):
${gapEvidence}`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function executeReadOnlyFocalToolCall(
 call: ToolCall,
 context: {
 projects?: Project[];
 sessions?: StudySession[];
 subjects?: Subject[];
 today: string;
 },
): string | null {
 const args = call.arguments;
 const query = readOptionalString(args,"query");
 const { startDate, endDate } = readToolDateRange(args, context.today);

 if (call.name ==="list_subjects") {
 const matches = (context.subjects ?? [])
 .filter((subject) =>
 searchMatches(
 `${subject.id} ${subject.name} ${subject.shortCode}`,
 query,
 ),
 )
 .sort((a, b) => a.name.localeCompare(b.name));
 if (matches.length === 0) return"No matching subjects found.";
 return `Subjects:\n${matches.map((subject) => `- ${subject.id}: ${subject.name} (${subject.shortCode})`).join("\n")}\n\nSubject lookup does not include SAC, exam, assignment, or deadline dates. For assessment dates, call list_deadlines next.`;
 }

 if (call.name ==="list_deadlines" || call.name ==="list_projects") {
 const includeFinished =
 readOptionalBoolean(args,"includeFinished") ?? false;
 const includeArchived =
 readOptionalBoolean(args,"includeArchived") ?? false;
 const onlyDeadlines = call.name ==="list_deadlines";
 const matches = filterProjectsForTool(context.projects, context.subjects, {
 query,
 startDate,
 endDate,
 includeFinished,
 includeArchived,
 onlyDeadlines,
 })
 .sort(
 (a, b) =>
 (a.deadline ??"9999").localeCompare(b.deadline ??"9999") ||
 a.name.localeCompare(b.name),
 )
 .slice(0, 30);
 if (matches.length === 0) {
 const fallbackMatches = filterProjectsForTool(
 context.projects,
 context.subjects,
 {
 query,
 includeFinished,
 includeArchived,
 onlyDeadlines,
 ignoreDate: true,
 },
 )
 .sort(
 (a, b) =>
 (a.deadline ??"9999").localeCompare(b.deadline ??"9999") ||
 a.name.localeCompare(b.name),
 )
 .slice(0, 8);
 const empty = onlyDeadlines
 ?"No matching deadlines found in the requested date range."
 :"No matching projects found in the requested date range.";
 if (fallbackMatches.length === 0)
 return onlyDeadlines
 ?"No matching deadlines found."
 :"No matching projects found.";
 const label = onlyDeadlines
 ?"Matching deadlines outside that range"
 :"Matching projects outside that range";
 return `${empty}\n${label}:\n${fallbackMatches.map((project) => formatProjectLine(project, context.subjects, context.today)).join("\n")}`;
 }
 const label = onlyDeadlines ?"Deadlines" :"Projects";
 return `${label}:\n${matches.map((project) => formatProjectLine(project, context.subjects, context.today)).join("\n")}`;
 }

 if (call.name ==="list_study_sessions") {
 const status = readOptionalString(args,"status");
 const matches = (context.sessions ?? [])
 .filter((session) => !status || session.execution.state === status)
 .filter((session) =>
 dateMatchesRange(session.schedule.blocks[0].start, startDate, endDate),
 )
 .filter((session) =>
 searchMatches(
 sessionSearchText(session, context.subjects, context.projects),
 query,
 ),
 )
 .sort(
 (a, b) =>
 new Date(a.schedule.blocks[0].start).getTime() - new Date(b.schedule.blocks[0].start).getTime(),
 )
 .slice(0, 30);
 if (matches.length === 0) return"No matching study sessions found.";
 return `Study sessions:\n${matches.map((session) => formatSessionLine(session, context.subjects, context.projects)).join("\n")}`;
 }

 if (call.name ==="get_study_overview") {
 return buildStudyOverviewToolResult(
 context.projects,
 context.sessions,
 context.subjects,
 context.today,
 );
 }

 return null;
}

export function toolDisplayName(name: string): string {
 return name.replace(/_/g," ").trim();
}

export function toolFailureText(name: string, error: unknown): string {
 const detail = error instanceof Error ? error.message.trim() : "";
 const suffix = detail ? `: ${detail.slice(0, 240)}` : "";
 return `${toolDisplayName(name)} failed${suffix}.`;
}

export function toolRunningText(name: string): string {
 const label = toolDisplayName(name);
 if (name.startsWith("list_"))
 return `Checking ${label.replace(/^list /,"")}`;
 if (name.startsWith("get_")) return `Reading ${label.replace(/^get /,"")}`;
 if (name.startsWith("create_"))
 return `Creating ${label.replace(/^create /,"")}`;
 if (name.startsWith("update_"))
 return `Updating ${label.replace(/^update /,"")}`;
 if (name.startsWith("delete_"))
 return `Deleting ${label.replace(/^delete /,"")}`;
 return `Using ${label}`;
}

export function toolDoneText(name: string): string {
 const label = toolDisplayName(name);
 if (name.startsWith("list_")) return `Checked ${label.replace(/^list /,"")}`;
 if (name.startsWith("get_")) return `Read ${label.replace(/^get /,"")}`;
 if (name.startsWith("create_"))
 return `Created ${label.replace(/^create /,"")}`;
 if (name.startsWith("update_"))
 return `Updated ${label.replace(/^update /,"")}`;
 if (name.startsWith("delete_"))
 return `Deleted ${label.replace(/^delete /,"")}`;
 return `Used ${label}`;
}
