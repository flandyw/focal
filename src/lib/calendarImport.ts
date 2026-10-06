// Pure (no React/Tauri) so desktop and web share one chatbot-import contract.
type ImportEventType = "sac" | "exam" | "assignment" | "event" | "homework" | "other" | "practice-sac"
export interface ImportSubject { id: string; name: string; shortCode: string }
export interface ImportProject { id: string; name: string }

// --- Types ---

export interface TextEventDraft {
  kind: "event" | "session"
  title: string
  description?: string
  date: string
  endDate?: string
  startTime: string
  durationMinutes: number
  eventType: ImportEventType
  subjectId?: string
  subjectIds: string[]
  projectId?: string
  location?: string
  topics?: string[]
  approved: boolean
}

// --- Constants ---

const VALID_EVENT_TYPES = new Set<ImportEventType>(["sac", "exam", "assignment", "event", "homework", "other", "practice-sac"])
// --- API / Parsing ---

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function readStringArray(record: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    }
    if (typeof value === "string" && value.trim()) return [value.trim()]
  }
  return []
}

function readNumber(record: Record<string, unknown>, fallback: number, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return fallback
}

function readDurationMinutes(record: Record<string, unknown>): number {
  const value = record.duration_minutes ?? record.durationMinutes ?? record.duration ?? record.minutes
  if (typeof value === "string") {
    const match = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?)?)?(?:\s*(\d+)\s*m(?:in(?:utes?)?)?)?$/i.exec(value.trim())
    if (match && (match[1] || match[2])) return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
  }
  return readNumber(record, 60, "duration_minutes", "durationMinutes", "duration", "minutes")
}

function keyText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function compactKey(value: string): string {
  return keyText(value).replace(/\s+/g, "")
}

function resolveSubjectId(raw: string, subjects: ImportSubject[]): string | undefined {
  if (!raw || raw.toLowerCase() === "none") return undefined
  const rawKey = keyText(raw)
  const rawCompact = compactKey(raw)
  for (const subject of subjects) {
    if (
      subject.id === raw ||
      keyText(subject.id) === rawKey ||
      keyText(subject.shortCode) === rawKey ||
      keyText(subject.name) === rawKey ||
      compactKey(subject.shortCode) === rawCompact ||
      compactKey(subject.name) === rawCompact
    ) {
      return subject.id
    }
  }
  const fuzzy = subjects.filter((subject) => {
    const name = keyText(subject.name)
    const code = keyText(subject.shortCode)
    return rawKey.length >= 4 && (name.includes(rawKey) || rawKey.includes(name) || code.includes(rawKey))
  })
  // ponytail: one unambiguous fuzzy subject match is useful; multiple matches
  // stay unresolved so we don't attach sessions to the wrong class.
  return fuzzy.length === 1 ? fuzzy[0].id : undefined
}

function resolveProjectId(raw: string, projects: ImportProject[]): string | undefined {
  if (!raw || raw.toLowerCase() === "none") return undefined
  const rawKey = keyText(raw)
  const exact = projects.find((project) => project.id === raw || keyText(project.name) === rawKey)
  if (exact) return exact.id
  const fuzzy = projects.filter((project) => rawKey.length >= 4 && keyText(project.name).includes(rawKey))
  return fuzzy.length === 1 ? fuzzy[0].id : undefined
}

function normaliseDateValue(value: string): string {
  const trimmed = value.trim()
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`
  const local = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed)
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`
  return trimmed
}

function normaliseTimeValue(value: string): string {
  const compact = value.trim().toLowerCase().replace(/\s+/g, "")
  const ampm = /^(\d{1,2})(?::?(\d{2}))?(am|pm)$/.exec(compact)
  if (ampm) {
    let hours = Number(ampm[1])
    const minutes = Number(ampm[2] ?? "00")
    if (hours === 12) hours = 0
    if (ampm[3] === "pm") hours += 12
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  }
  const time = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(compact)
  if (time) {
    return `${time[1].padStart(2, "0")}:${(time[2] ?? "00").padStart(2, "0")}`
  }
  return value.trim()
}

function coerceItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (typeof parsed !== "object" || parsed === null) return []
  const events = (parsed as { events?: unknown }).events
  // ponytail: 8B local models sometimes return one event object or a bare
  // array even after schema nudging; accept those shallow shapes here.
  if (Array.isArray(events)) return events.flat()
  if (typeof events === "object" && events !== null) return [events]
  return []
}

function parseJsonPayload(content: string): unknown {
  const trimmed = content.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // ponytail: recover the single JSON object/array commonly wrapped by
    // small local models; nested prose with multiple payloads stays rejected.
    const firstObject = trimmed.indexOf("{")
    const firstArray = trimmed.indexOf("[")
    const start = [firstObject, firstArray].filter((index) => index >= 0).sort((a, b) => a - b)[0]
    if (start === undefined) throw new Error("Planner response was not valid JSON")
    const closing = trimmed[start] === "{" ? "}" : "]"
    const end = trimmed.lastIndexOf(closing)
    if (end <= start) throw new Error("Planner response was not valid JSON")
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

function isValidDateTime(dateValue: string, timeValue: string): boolean {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue)
  if (!dateMatch || !timeMatch) return false
  const [, y, mo, d] = dateMatch.map(Number)
  const [, h, mi] = timeMatch.map(Number)
  const date = new Date(y, mo - 1, d, h, mi)
  return date.getFullYear() === y && date.getMonth() + 1 === mo && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi
}

export function parseTextEventResponse(content: string, subjects: ImportSubject[], projects: ImportProject[]): TextEventDraft[] {
  const parsed = parseJsonPayload(content)
  if ((typeof parsed !== "object" || parsed === null) && !Array.isArray(parsed)) {
    throw new Error("Invalid planner response")
  }

  const items = coerceItems(parsed)
  if (items.length === 0) {
    throw new Error("Planner response missing events array")
  }

  const drafts: TextEventDraft[] = items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const record = item as Record<string, unknown>
    const title = readString(record, "title", "name")
    const date = normaliseDateValue(readString(record, "date", "start_date", "startDate"))
    const endDate = normaliseDateValue(readString(record, "end_date", "endDate")) || undefined
    const startTime = normaliseTimeValue(readString(record, "start_time", "startTime", "time"))
    const durationMinutes = readDurationMinutes(record)
    const itemType = readString(record, "item_type", "itemType", "kind", "type").toLowerCase()
    const kind = itemType === "session" || itemType === "study" || itemType === "study_session" ? "session" : "event"
    const rawEventType = readString(record, "event_type", "eventType").toLowerCase()
    const eventType = VALID_EVENT_TYPES.has(rawEventType as ImportEventType) ? (rawEventType as ImportEventType) : "event"
    const rawSubjectId = readString(record, "subject_id", "subjectId")
    const subjectId = resolveSubjectId(rawSubjectId, subjects)
    const subjectIdsForDraft = readStringArray(record, "subject_ids", "subjectIds", "subjects")
      .flatMap((id) => {
        const resolved = resolveSubjectId(id, subjects)
        return resolved ? [resolved] : []
      })
    const resolvedSubjectIds = subjectIdsForDraft.length > 0
      ? Array.from(new Set(subjectIdsForDraft))
      : subjectId ? [subjectId] : []
    const rawProjectId = readString(record, "project_id", "projectId", "assessment_id", "assessmentId")
    const projectId = resolveProjectId(rawProjectId, projects)
    const description = readString(record, "description", "notes")
    const location = readString(record, "location", "place")
    const topics = readStringArray(record, "topics", "topic")

    if (!title || !isValidDateTime(date, startTime)) return []
    if (endDate && (!isValidDateTime(endDate, startTime) || endDate < date)) return []
    if (kind === "session" && resolvedSubjectIds.length === 0) return []

    return [{
      kind,
      title,
      description: description || undefined,
      date,
      endDate: endDate && endDate !== date ? endDate : undefined,
      startTime,
      durationMinutes: Math.min(180, Math.max(15, Math.round(durationMinutes))),
      eventType,
      subjectId,
      subjectIds: resolvedSubjectIds,
      projectId,
      location: location || undefined,
      topics: topics.length > 0 ? topics : undefined,
      approved: true,
    }]
  })

  const seen = new Set<string>()
  return drafts.filter((draft) => {
    const key = `${draft.kind}|${keyText(draft.title)}|${draft.date}|${draft.startTime}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Local YYYY-MM-DD for a Date. */
function localDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** Prompt the user pastes into any chatbot; the reply is read back by parseTextEventResponse. */
export function buildChatbotImportPrompt(subjects: ImportSubject[], projects: ImportProject[], now = new Date()): string {
  const today = localDateValue(now)
  const weekday = now.toLocaleDateString("en-AU", { weekday: "long" })
  const subjectLines = subjects.map((subject) => `- ${subject.id}: ${subject.name}`).join("\n") || "- (none)"
  const projectLines = projects.map((project) => `- ${project.id}: ${project.name}`).join("\n") || "- (none)"
  return `Turn the schedule, notice, or plan I give you (text, screenshot, or file) into calendar items for my study planner.

Today is ${weekday} ${today}. Resolve relative dates ("next Tuesday") from that. Australian dates like 10/05 are DD/MM.

Reply with ONLY one JSON code block, no other text, in exactly this shape:
{"events":[{"title":"Maths SAC 2","item_type":"event","date":"YYYY-MM-DD","end_date":"","start_time":"HH:mm","duration_minutes":60,"event_type":"sac","subject_id":"none","project_id":"none","location":"","description":"","topics":[]}]}

Rules:
- item_type: "event" for SACs, exams, deadlines, meetings, reminders; "session" for study, revision or homework blocks.
- event_type: one of sac, exam, assignment, event, homework, other, practice-sac.
- date and end_date are YYYY-MM-DD; end_date is "" unless the item spans several days. start_time is 24-hour HH:mm (use 15:30 if no time is given).
- duration_minutes is 15-180.
- subject_id: pick from my subjects below, or "none". A "session" must have a subject.
- project_id: pick from my assessments below, or "none".
- Only include items actually in my source. Do not invent extras.

My subjects:
${subjectLines}

My assessments:
${projectLines}

Source:
`
}
