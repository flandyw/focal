import { isRecord } from "@/lib/utils"
export { isRecord }
import { normalizeStudySession } from "@/lib/studySessions"
import type { CalendarEvent, EventType, NotionSource, NotionSyncSnapshot, StudySession, StudySessionDraft, Subject } from "@/lib/types"

export type NotionProperty = Record<string, unknown>

export const FOCAL_ID_PROPERTY = "Focal ID"
export const FOCAL_KIND_PROPERTY = "Focal Kind"

export interface NotionPage {
  id: string
  url?: string
  last_edited_time?: string
  properties?: Record<string, NotionProperty>
}

/** Structured conflict data for resolution. */
export interface ConflictItem {
  localId: string
  kind: "event" | "session"
  title: string
  startTime?: string
  endTime?: string
  notionPageId: string
  notionLastEditedTime?: string
  notionUrl?: string
  localUpdates: EventUpdates | SessionUpdates
  remoteUpdates: EventUpdates | SessionUpdates
  localSnapshot: NotionSyncSnapshot
  remoteSnapshot: NotionSyncSnapshot
  conflictingFields: string[]
  localUpdatedAt?: string
  localBodyHash?: string
  localSubjectIds?: string[]
}

export interface NotionQueryError {
  code: string
  message: string
  retry_after_ms?: number
}

export interface NotionQueryResponse {
  data?: unknown[] | null
  error?: NotionQueryError | null
}

export interface NotionPageResponse {
  data?: Record<string, unknown> | null
  error?: NotionQueryError | null
}

export interface NotionCalendarSyncResult {
  created: (Omit<CalendarEvent, "id" | "created_at"> & { id?: string })[]
  updated: {
    id: string
    updates: Partial<Omit<CalendarEvent, "id" | "created_at">>
  }[]
  createdSessions: (StudySessionDraft & { id?: string })[]
  updatedSessions: {
    id: string
    updates: Partial<Omit<StudySession, "id" | "created_at">>
  }[]
  skipped: number
  skippedReasons: string[]
  pushedCreated: number
  pushedUpdated: number
  conflicts: number
  conflictDetails: string[]
  conflictItems: ConflictItem[]
  pushErrors: string[]
  deleted: number
  acknowledgedEventIds: string[]
  acknowledgedSessionIds: string[]
}

export type EventUpdates = Partial<Omit<CalendarEvent, "id" | "created_at">>
/** Notion's date/completion wire DTO, converted once before a local mutation. */
export type SessionUpdates = Partial<StudySessionDraft>

export interface PushTask {
  run: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Schema cache
// ---------------------------------------------------------------------------

const SCHEMA_CACHE_PREFIX = "focal-notion-schema"

export function getCachedSchema(dataSourceId: string): Record<string, NotionProperty> | null {
  try {
    const raw = localStorage.getItem(`${SCHEMA_CACHE_PREFIX}:${dataSourceId}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? (parsed as Record<string, NotionProperty>) : null
  } catch {
    return null
  }
}

export function setCachedSchema(dataSourceId: string, schema: Record<string, NotionProperty>): void {
  localStorage.setItem(`${SCHEMA_CACHE_PREFIX}:${dataSourceId}`, JSON.stringify(schema))
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------


export function getRichTextPlainText(items: unknown): string | undefined {
  if (!Array.isArray(items)) return undefined
  const text = items
    .map((item) => (isRecord(item) && typeof item.plain_text === "string" ? item.plain_text : ""))
    .join("")
    .trim()
  return text || undefined
}

export function getPropertyText(property: NotionProperty | undefined): string | undefined {
  if (!property) return undefined
  const type = typeof property.type === "string" ? property.type : undefined
  if (type === "title") return getRichTextPlainText(property.title)
  if (type === "rich_text") return getRichTextPlainText(property.rich_text)
  if (type === "select" && isRecord(property.select) && typeof property.select.name === "string") return property.select.name
  if (type === "status" && isRecord(property.status) && typeof property.status.name === "string") return property.status.name
  if (type === "multi_select" && Array.isArray(property.multi_select)) {
    const labels = property.multi_select
      .map((item) => (isRecord(item) && typeof item.name === "string" ? item.name : ""))
      .filter(Boolean)
    return labels.length > 0 ? labels.join(", ") : undefined
  }
  if (type === "url" && typeof property.url === "string") return property.url
  if (type === "email" && typeof property.email === "string") return property.email
  if (type === "phone_number" && typeof property.phone_number === "string") return property.phone_number
  if (type === "formula" && isRecord(property.formula)) {
    if (typeof property.formula.string === "string") return property.formula.string
    if (typeof property.formula.number === "number") return String(property.formula.number)
    if (typeof property.formula.boolean === "boolean") return property.formula.boolean ? "Yes" : "No"
  }
  return undefined
}

export function getPropertyTexts(property: NotionProperty | undefined): string[] {
  const text = getPropertyText(property)
  if (!text) return []
  return text.split(",").map((item) => item.trim()).filter(Boolean)
}

export function getPropertyBoolean(property: NotionProperty | undefined): boolean | undefined {
  if (!property) return undefined
  if (property.type === "checkbox" && typeof property.checkbox === "boolean") return property.checkbox
  if (property.type === "formula" && isRecord(property.formula) && typeof property.formula.boolean === "boolean") {
    return property.formula.boolean
  }
  if (property.type === "rollup" && isRecord(property.rollup)) {
    if (property.rollup.type === "boolean" && typeof property.rollup.boolean === "boolean") {
      return property.rollup.boolean
    }
    if (property.rollup.type === "array" && Array.isArray(property.rollup.array)) {
      const values = property.rollup.array
        .map((item) => getPropertyBoolean(isRecord(item) ? item : undefined))
        .filter((item): item is boolean => typeof item === "boolean")
      if (values.length > 0) return values.some(Boolean)
    }
  }
  return undefined
}

export function getDateFromValue(value: unknown): { start?: string; end?: string } {
  if (typeof value === "string") return { start: value }
  if (!isRecord(value)) return {}
  return {
    start: typeof value.start === "string" ? value.start : undefined,
    end: typeof value.end === "string" ? value.end : undefined,
  }
}

export function getPropertyDate(property: NotionProperty | undefined): { start?: string; end?: string } {
  if (!property) return {}
  if (property.type === "date") return getDateFromValue(property.date)
  if (property.type === "created_time" && typeof property.created_time === "string") {
    return { start: property.created_time }
  }
  if (property.type === "last_edited_time" && typeof property.last_edited_time === "string") {
    return { start: property.last_edited_time }
  }
  if (property.type === "formula" && isRecord(property.formula)) {
    if (property.formula.type === "date") return getDateFromValue(property.formula.date)
    if (property.formula.type === "string" && typeof property.formula.string === "string") {
      return { start: property.formula.string }
    }
  }
  if (property.type === "rollup" && isRecord(property.rollup)) {
    if (property.rollup.type === "date") return getDateFromValue(property.rollup.date)
    if (property.rollup.type === "array" && Array.isArray(property.rollup.array)) {
      const dates = property.rollup.array
        .map((item) => getPropertyDate(isRecord(item) ? item : undefined))
        .filter((date) => date.start)
      return dates[0] ?? {}
    }
  }
  return {}
}

export function hasEmptyDateValue(property: NotionProperty | undefined): boolean {
  if (!property) return false
  if (property.type === "date") return property.date == null
  if (property.type === "formula" && isRecord(property.formula)) {
    return property.formula.type === "date" && property.formula.date == null
  }
  if (property.type === "rollup" && isRecord(property.rollup)) {
    return property.rollup.type === "date" && property.rollup.date == null
  }
  return false
}

export function findProperty(properties: Record<string, NotionProperty>, name: string): NotionProperty | undefined {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  if (properties[trimmed]) return properties[trimmed]
  const normalized = trimmed.toLowerCase()
  const match = Object.entries(properties).find(([key]) => key.trim().toLowerCase() === normalized)
  return match?.[1]
}

export function findFirstDateProperty(properties: Record<string, NotionProperty>): {
  property?: NotionProperty
  name?: string
} {
  for (const [name, property] of Object.entries(properties)) {
    if (getPropertyDate(property).start) return { property, name }
  }
  return {}
}

export function getConfiguredDate(
  properties: Record<string, NotionProperty>,
  datePropertyName: string,
): { date: { start?: string; end?: string }; propertyName?: string; usedFallback: boolean } {
  const configuredProperty = findProperty(properties, datePropertyName)
  const configuredDate = getPropertyDate(configuredProperty)
  if (configuredDate.start) {
    return { date: configuredDate, propertyName: datePropertyName.trim(), usedFallback: false }
  }

  const fallback = findFirstDateProperty(properties)
  return {
    date: getPropertyDate(fallback.property),
    propertyName: fallback.name,
    usedFallback: Boolean(fallback.property),
  }
}

export function getPropertyType(property: NotionProperty | undefined): string {
  return typeof property?.type === "string" ? property.type : "missing"
}

export function getAvailablePropertySummary(properties: Record<string, NotionProperty>): string {
  return Object.entries(properties)
    .map(([name, property]) => `${name} (${getPropertyType(property)})`)
    .slice(0, 8)
    .join(", ")
}

export function getPageTitle(properties: Record<string, NotionProperty>, titlePropertyName: string): string {
  const configuredTitle = getPropertyText(findProperty(properties, titlePropertyName))
  if (configuredTitle) return configuredTitle

  const titleProperty = Object.values(properties).find((property) => property.type === "title")
  return getPropertyText(titleProperty) ?? "Untitled Notion Event"
}

export function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
  const date = dateOnly ? new Date(`${trimmed}T00:00:00`) : new Date(trimmed)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function sameInstant(a: string | undefined, b: string | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  const aTime = new Date(a).getTime()
  const bTime = new Date(b).getTime()
  return Number.isFinite(aTime) && Number.isFinite(bTime) && Math.floor(aTime / 60_000) === Math.floor(bTime / 60_000)
}

export function normaliseToken(value: string | undefined): string {
  return value?.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "") ?? ""
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

export function toEventType(value: string | undefined): EventType {
  const normalized = normaliseToken(value)
  if (normalized === "sac") return "sac"
  if (normalized === "exam") return "exam"
  if (normalized === "event") return "event"
  if (normalized === "homework") return "homework"
  if (normalized === "other") return "other"
  if (normalized === "practicesac" || normalized === "practiceassessment" || normalized === "practicetest") {
    return "practice-sac"
  }
  if (normalized === "assignment" || normalized === "assessment") return "assignment"
  return "other"
}

export function toNotionType(value: EventType): string {
  switch (value) {
    case "homework":
      return "Homework"
    case "assignment":
      return "Assignment"
    case "sac":
      return "SAC"
    case "exam":
      return "Exam"
    case "practice-sac":
      return "Practice SAC"
    case "event":
      return "Event"
    case "other":
    default:
      return "Other"
  }
}

export function isSessionType(value: string | undefined): boolean {
  return normaliseToken(value).includes("session")
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

export function normalisePage(value: unknown): NotionPage | null {
  if (!isRecord(value) || typeof value.id !== "string") return null
  return {
    id: value.id,
    url: typeof value.url === "string" ? value.url : undefined,
    last_edited_time: typeof value.last_edited_time === "string" ? value.last_edited_time : undefined,
    properties: isRecord(value.properties) ? (value.properties as Record<string, NotionProperty>) : undefined,
  }
}

export function getNotionSource(
  page: NotionPage,
  kind: "event" | "session",
  bodyHash?: string,
  syncSnapshot?: NotionSyncSnapshot,
): NotionSource {
  const source: NotionSource = {
    type: "notion",
    id: page.id,
    url: page.url,
    lastEditedTime: page.last_edited_time,
    kind,
  }
  if (bodyHash !== undefined) source.bodyHash = bodyHash
  if (syncSnapshot !== undefined) source.syncSnapshot = syncSnapshot
  return source
}

// ---------------------------------------------------------------------------
// Property extraction for date / type / subject / completed
// ---------------------------------------------------------------------------

export function getPropertyDateForEvent(
  properties: Record<string, NotionProperty>,
  settings: { dateProperty: string; typeProperty: string; completedProperty: string; subjectProperty: string; titleProperty: string },
): {
  startTime?: string
  endTime?: string
  skippedReason?: string
} {
  const configuredProperty = findProperty(properties, settings.dateProperty)
  const { date, propertyName, usedFallback } = getConfiguredDate(properties, settings.dateProperty)
  const startTime = toIsoDate(date.start)
  if (startTime) {
    return {
      startTime,
      endTime: toIsoDate(date.end),
      skippedReason: usedFallback && propertyName
        ? `Used "${propertyName}" because "${settings.dateProperty}" was ${getPropertyType(configuredProperty)}`
        : undefined,
    }
  }

  const available = getAvailablePropertySummary(properties)
  return {
    skippedReason: configuredProperty
      ? hasEmptyDateValue(configuredProperty)
        ? `"${settings.dateProperty}" is empty on skipped Notion rows`
        : `"${settings.dateProperty}" is ${getPropertyType(configuredProperty)} but has no parseable date`
      : `"${settings.dateProperty}" was not found${available ? `. Available: ${available}` : ""}`,
  }
}

export function getEventSubjectId(
  properties: Record<string, NotionProperty>,
  title: string,
  settings: { subjectProperty: string },
  subjects: Subject[],
  findSubjectIdFromValues: (values: string[], subjects: Subject[]) => string | undefined,
): string | undefined {
  const configuredProperty = settings.subjectProperty.trim()
    ? findProperty(properties, settings.subjectProperty)
    : undefined
  if (configuredProperty) {
    return findSubjectIdFromValues(getPropertyTexts(configuredProperty), subjects)
  }
  return findSubjectIdFromValues([title], subjects)
}

export function getEventTypeFromPage(
  properties: Record<string, NotionProperty>,
  settings: { typeProperty: string },
): EventType {
  return settings.typeProperty ? toEventType(getPropertyText(findProperty(properties, settings.typeProperty))) : "event"
}

export function isCompleted(properties: Record<string, NotionProperty>, settings: { completedProperty: string }): boolean {
  return Boolean(getPropertyBoolean(findProperty(properties, settings.completedProperty)))
}

// ---------------------------------------------------------------------------
// Notion property building (for push)
// ---------------------------------------------------------------------------

export function richTextValue(value: string): unknown[] {
  const chunks: unknown[] = []
  for (let offset = 0; offset < value.length; offset += 2_000) {
    chunks.push({ type: "text", text: { content: value.slice(offset, offset + 2_000) } })
  }
  return chunks
}

export function createTextProperty(propertyType: string | undefined, value: string | undefined): unknown {
  if (!value) {
    if (propertyType === "select") return { select: null }
    if (propertyType === "multi_select") return { multi_select: [] }
    if (propertyType === "status") return { status: null }
    if (propertyType === "url") return { url: null }
    if (propertyType === "email") return { email: null }
    if (propertyType === "phone_number") return { phone_number: null }
    if (!propertyType || propertyType === "rich_text") return { rich_text: [] }
    return undefined
  }
  if (propertyType === "select") return { select: { name: value } }
  if (propertyType === "multi_select") return { multi_select: [{ name: value }] }
  if (propertyType === "status") return { status: { name: value } }
  if (propertyType === "url") return { url: value }
  if (propertyType === "email") return { email: value }
  if (propertyType === "phone_number") return { phone_number: value }
  if (!propertyType || propertyType === "rich_text") return { rich_text: richTextValue(value) }
  return undefined
}

export function createPropertyValue(propertyType: string | undefined, value: string | boolean | undefined): unknown {
  if (typeof value === "boolean") {
    return propertyType === "checkbox" ? { checkbox: value } : undefined
  }
  return createTextProperty(propertyType, value)
}

export function getSchemaPropertyType(
  schema: Record<string, NotionProperty>,
  propertyName: string,
  fallback: string,
): string {
  const found = findProperty(schema, propertyName)
  return getPropertyType(found) === "missing" ? fallback : getPropertyType(found)
}

export function buildPageChildren(description: string | undefined): unknown[] | undefined {
  const text = description?.trim()
  if (!text) return undefined
  return [
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: richTextValue(text),
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Body hash (for detecting description changes)
// ---------------------------------------------------------------------------

export function hashBody(text: string | undefined): string | undefined {
  const s = text?.trim()
  if (!s) return undefined
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i)
    hash |= 0
  }
  return hash.toString(36)
}

export function bodyHasChanged(storedHash: string | undefined, text: string | undefined): boolean {
  return hashBody(text) !== storedHash
}

export function buildSessionBodyText(session: StudySession): string | undefined {
  const base = [session.description, session.reflection?.notes].filter(Boolean).join("\n\n")
  const activeDurations = session.execution.intervals.filter(
    (interval): interval is typeof interval & { end: string } => Boolean(interval.end),
  )
  if (activeDurations.length === 0) return base || undefined

  const sorted = [...activeDurations].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  )
  const lines: string[] = []
  let lastEnd: Date | null = null
  let totalActive = 0
  for (const duration of sorted) {
    const startDate = new Date(duration.start)
    const endDate = new Date(duration.end!)
    const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60_000)
    totalActive += durationMinutes
    const time = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    if (lastEnd) {
      const restMinutes = Math.round((startDate.getTime() - lastEnd.getTime()) / 60_000)
      lines.push(`Break: ${time(lastEnd)} – ${time(startDate)} (${restMinutes}m)`)
    }
    lines.push(`Active: ${time(startDate)} – ${time(endDate)} (${durationMinutes}m)`)
    lastEnd = endDate
  }
  lines.push(`\nTotal active study: ${totalActive}m`)
  const timeline = lines.join("\n")
  return base ? `${base}\n\n${timeline}` : timeline
}

export function getPrimarySessionSubjectId(
  session: Pick<StudySessionDraft, "subjectIds">,
  subjects: Subject[],
): string | null {
  return session.subjectIds.find((subjectId) => (
    subjects.some((subject) => subject.id === subjectId)
  )) ?? null
}

interface NotionMappedSettings {
  typeProperty: string
  completedProperty: string
  subjectProperty: string
}

function canonicalSyncInstant(value: string | undefined): string | null {
  if (!value) return null
  const time = new Date(value).getTime()
  // ponytail: Notion date properties round to minutes. If their API gains
  // second precision, remove this normalization from matching and snapshots.
  return Number.isFinite(time) ? new Date(Math.floor(time / 60_000) * 60_000).toISOString() : value.trim()
}

export function eventSyncSnapshot(
  event: Pick<CalendarEvent, "title" | "startTime" | "endTime" | "eventType" | "subjectId" | "isFinished">,
  settings: NotionMappedSettings,
): NotionSyncSnapshot {
  return {
    title: event.title,
    startTime: canonicalSyncInstant(event.startTime),
    endTime: canonicalSyncInstant(event.endTime),
    ...(settings.typeProperty.trim() ? { eventType: event.eventType } : {}),
    ...(settings.completedProperty.trim() ? { isFinished: Boolean(event.isFinished) } : {}),
    ...(settings.subjectProperty.trim() ? { subjectId: event.subjectId ?? null } : {}),
  }
}

export function sessionSyncSnapshot(
  session: StudySession | StudySessionDraft,
  settings: NotionMappedSettings,
  subjects: Subject[],
): NotionSyncSnapshot {
  const record = "schedule" in session ? session : normalizeStudySession(session)
  const primarySubjectId = getPrimarySessionSubjectId(record, subjects)
  return {
    title: record.title,
    startTime: canonicalSyncInstant(record.schedule.blocks[0].start),
    endTime: canonicalSyncInstant(record.schedule.blocks[record.schedule.blocks.length - 1].end),
    ...(settings.completedProperty.trim()
      ? { isCompleted: record.execution.state === "completed" }
      : {}),
    ...(settings.subjectProperty.trim() ? { subjectId: primarySubjectId } : {}),
  }
}

export function notionSnapshotsEqual(a: NotionSyncSnapshot, b: NotionSyncSnapshot): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => a[key] === b[key])
}

export function mergeNotionSyncSnapshots(
  baseline: NotionSyncSnapshot,
  local: NotionSyncSnapshot,
  remote: NotionSyncSnapshot,
): { merged: NotionSyncSnapshot; conflictingFields: string[] } {
  const merged: NotionSyncSnapshot = {}
  const conflictingFields: string[] = []
  const keys = new Set([...Object.keys(baseline), ...Object.keys(local), ...Object.keys(remote)])
  for (const key of keys) {
    const baselineValue = baseline[key]
    const localValue = local[key]
    const remoteValue = remote[key]
    const localChanged = localValue !== baselineValue
    const remoteChanged = remoteValue !== baselineValue
    if (localChanged && remoteChanged && localValue !== remoteValue) {
      conflictingFields.push(key)
      continue
    }
    const value = remoteChanged ? remoteValue : localValue
    if (value !== undefined) merged[key] = value
  }
  return { merged, conflictingFields }
}

export function resolveNotionSyncSnapshot(
  merged: NotionSyncSnapshot,
  chosen: NotionSyncSnapshot,
  conflictingFields: readonly string[],
): NotionSyncSnapshot {
  if (conflictingFields.includes("record")) return { ...chosen }
  const resolved = { ...merged }
  for (const field of conflictingFields) {
    const value = chosen[field]
    if (value === undefined) delete resolved[field]
    else resolved[field] = value
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Fingerprinting (for duplicate-page prevention)
// ---------------------------------------------------------------------------

export function eventFingerprint(e: CalendarEvent | Omit<CalendarEvent, "id" | "created_at">): string {
  return [
    e.title,
    e.startTime,
    e.endTime ?? "",
    e.eventType,
    e.subjectId ?? "",
    e.isFinished ? "1" : "0",
  ].join("|")
}

export function sessionFingerprint(value: StudySession | StudySessionDraft): string {
  const s = "schedule" in value ? value : normalizeStudySession(value)
  return [s.title, s.schedule.blocks[0].start, s.schedule.blocks[s.schedule.blocks.length - 1].end, [...s.subjectIds].sort().join(","), s.execution.state].join("|")
}

export function getFocalId(page: NotionPage): string | undefined {
  const value = getPropertyText(findProperty(page.properties ?? {}, FOCAL_ID_PROPERTY))?.trim()
  return value?.length ? value : undefined
}

export function getFocalKind(page: NotionPage): "event" | "session" | undefined {
  const value = getPropertyText(findProperty(page.properties ?? {}, FOCAL_KIND_PROPERTY))?.trim().toLowerCase()
  return value === "event" || value === "session" ? value : undefined
}

export function focalIdentityProperties(id: string, kind: "event" | "session"): Record<string, unknown> {
  return {
    [FOCAL_ID_PROPERTY]: { rich_text: richTextValue(id) },
    [FOCAL_KIND_PROPERTY]: { rich_text: richTextValue(kind) },
  }
}

export function notionPageFingerprint(
  page: NotionPage,
  settings: { dateProperty: string; typeProperty: string; completedProperty: string; subjectProperty: string; titleProperty: string },
): string | null {
  const properties = page.properties ?? {}
  const { startTime, endTime } = getPropertyDateForEvent(properties, settings)
  if (!startTime) return null
  const kind = getFocalKind(page) ?? getPageKind(properties, settings)
  return [
    kind,
    kind === "event" ? getEventTypeFromPage(properties, settings) : "",
    getPageTitle(properties, settings.titleProperty),
    String(new Date(startTime).getTime()),
    String(new Date(endTime ?? startTime).getTime()),
    getPropertyTexts(findProperty(properties, settings.subjectProperty)).sort().join(","),
    isCompleted(properties, settings) ? "1" : "0",
  ].join("|")
}

// ---------------------------------------------------------------------------
// Sync state context
// ---------------------------------------------------------------------------

export interface SyncCtx {
  created: NotionCalendarSyncResult["created"]
  createdSessions: NotionCalendarSyncResult["createdSessions"]
  updatedEvents: Map<string, EventUpdates>
  updatedSessions: Map<string, SessionUpdates>
  matchedEventIds: Set<string>
  matchedSessionIds: Set<string>
  blockedEventFingerprints: Set<string>
  blockedSessionFingerprints: Set<string>
  skipped: number
  skippedReasons: string[]
  pushedCreated: number
  pushedUpdated: number
  deleted: number
  conflicts: number
  conflictDetails: string[]
  conflictItems: ConflictItem[]
  pushErrors: string[]
  newNotionIds: Set<string>
  dirtyEventIds: ReadonlySet<string>
  dirtySessionIds: ReadonlySet<string>
  pulledEventIds: Set<string>
  pulledSessionIds: Set<string>
  conflictedEventIds: Set<string>
  conflictedSessionIds: Set<string>
  acknowledgedEventIds: Set<string>
  acknowledgedSessionIds: Set<string>
}

export function createSyncCtx(
  dirtyEventIds: ReadonlySet<string> = new Set(),
  dirtySessionIds: ReadonlySet<string> = new Set(),
): SyncCtx {
  return {
    created: [],
    createdSessions: [],
    updatedEvents: new Map(),
    updatedSessions: new Map(),
    matchedEventIds: new Set(),
    matchedSessionIds: new Set(),
    blockedEventFingerprints: new Set(),
    blockedSessionFingerprints: new Set(),
    skipped: 0,
    skippedReasons: [],
    pushedCreated: 0,
    pushedUpdated: 0,
    deleted: 0,
    conflicts: 0,
    conflictDetails: [],
    conflictItems: [],
    pushErrors: [],
    newNotionIds: new Set(),
    dirtyEventIds,
    dirtySessionIds,
    pulledEventIds: new Set(),
    pulledSessionIds: new Set(),
    conflictedEventIds: new Set(),
    conflictedSessionIds: new Set(),
    acknowledgedEventIds: new Set(),
    acknowledgedSessionIds: new Set(),
  }
}

// ---------------------------------------------------------------------------
// Page helpers (matching / conversion)
// ---------------------------------------------------------------------------

export function getPageKind(properties: Record<string, NotionProperty>, settings: { typeProperty: string }): "event" | "session" {
  const typeValue = settings.typeProperty ? getPropertyText(findProperty(properties, settings.typeProperty)) : undefined
  return isSessionType(typeValue) ? "session" : "event"
}

export function pageMatchesEvent(
  page: NotionPage,
  event: CalendarEvent,
  settings: { dateProperty: string; typeProperty: string; completedProperty: string; subjectProperty: string; titleProperty: string },
  subjects: Subject[],
  findSubjectIdFromValues: (values: string[], subjects: Subject[]) => string | undefined,
): boolean {
  const properties = page.properties ?? {}
  const title = getPageTitle(properties, settings.titleProperty)
  const { startTime, endTime } = getPropertyDateForEvent(properties, settings)

  return (
    title === event.title &&
    sameInstant(startTime, event.startTime) &&
    sameInstant(endTime, event.endTime) &&
    (!settings.typeProperty.trim()
      || getEventTypeFromPage(properties, settings) === event.eventType) &&
    (!settings.subjectProperty.trim()
      || getEventSubjectId(properties, title, settings, subjects, findSubjectIdFromValues) === event.subjectId) &&
    (!settings.completedProperty.trim()
      || isCompleted(properties, settings) === Boolean(event.isFinished))
  )
}

export function pageMatchesSession(
  page: NotionPage,
  session: StudySession,
  settings: { dateProperty: string; typeProperty: string; completedProperty: string; subjectProperty: string; titleProperty: string },
  subjects: Subject[],
  findSubjectIdFromValues: (values: string[], subjects: Subject[]) => string | undefined,
): boolean {
  const properties = page.properties ?? {}
  const title = getPageTitle(properties, settings.titleProperty)
  const { startTime, endTime } = getPropertyDateForEvent(properties, settings)
  const subjectId = getEventSubjectId(properties, title, settings, subjects, findSubjectIdFromValues)
  const subjectMatches = !settings.subjectProperty.trim()
    || (subjectId ?? null) === getPrimarySessionSubjectId(session, subjects)

  return (
    title === session.title &&
    sameInstant(startTime, session.schedule.blocks[0].start) &&
    sameInstant(endTime, session.schedule.blocks[session.schedule.blocks.length - 1].end) &&
    subjectMatches &&
    (!settings.completedProperty.trim()
      || isCompleted(properties, settings) === (session.execution.state === "completed"))
  )
}

export function toEventFromPage(
  page: NotionPage,
  settings: { dateProperty: string; typeProperty: string; completedProperty: string; subjectProperty: string; titleProperty: string },
  subjects: Subject[],
  findSubjectIdFromValues: (values: string[], subjects: Subject[]) => string | undefined,
): Omit<CalendarEvent, "id" | "created_at"> {
  const properties = page.properties ?? {}
  const title = getPageTitle(properties, settings.titleProperty)
  const { startTime, endTime } = getPropertyDateForEvent(properties, settings)
  if (!startTime) throw new Error("The Notion page no longer has a valid date")
  const event = {
    title,
    startTime,
    endTime,
    eventType: getEventTypeFromPage(properties, settings),
    subjectId: getEventSubjectId(properties, title, settings, subjects, findSubjectIdFromValues),
    isFinished: isCompleted(properties, settings),
  }
  return {
    ...event,
    source: getNotionSource(page, "event", undefined, eventSyncSnapshot(event, settings)),
  }
}

export function toSessionFromPage(
  page: NotionPage,
  settings: { dateProperty: string; typeProperty: string; completedProperty: string; subjectProperty: string; titleProperty: string },
  subjects: Subject[],
  findSubjectIdFromValues: (values: string[], subjects: Subject[]) => string | undefined,
): StudySessionDraft | null {
  const properties = page.properties ?? {}
  const title = getPageTitle(properties, settings.titleProperty)
  const { startTime, endTime } = getPropertyDateForEvent(properties, settings)
  if (!startTime) return null

  const completed = isCompleted(properties, settings)
  const session: StudySessionDraft = {
    projectId: undefined,
    subjectIds: getEventSubjectId(properties, title, settings, subjects, findSubjectIdFromValues)
      ? [getEventSubjectId(properties, title, settings, subjects, findSubjectIdFromValues)!]
      : [],
    title,
    startTime,
    endTime: endTime ?? startTime,
    status: completed ? "completed" : "planned",
    topics: undefined,
    notes: undefined,
    confidence: undefined,
    blockers: undefined,
    nextAction: undefined,
    completedAt: completed ? (page.last_edited_time ?? new Date().toISOString()) : undefined,
  }
  return {
    ...session,
    source: getNotionSource(page, "session", undefined, sessionSyncSnapshot(session, settings, subjects)),
  }
}
