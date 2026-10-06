// Pure (no React/Tauri): the stoplight checklist, its chatbot import contract, and evidence from mistakes.
import { parseJsonPayload } from "./calendarImport"
import { getMistakeSchedule, type AppData, type Mistake } from "./exam-data"
import {
  localDate, materialiseTask, type CurriculumArea, type LearningWorkspace, type StoplightRating, type StoplightType,
} from "./learning-workspace"

const DAY_MS = 24 * 60 * 60 * 1000
const RECHECK_DAYS = { green: 21, amber: 14 }
const TYPES: StoplightType[] = ["recall", "technique", "apply", "practical"]
export const UNGROUPED = "Ungrouped"

export const RATINGS: Array<{ id: StoplightRating; label: string; meaning: string }> = [
  { id: "red", label: "Red", meaning: "Can't start the check without notes" },
  { id: "amber", label: "Amber", meaning: "Can do it with notes, slowly, or with errors" },
  { id: "green", label: "Green", meaning: "Can pass the check cold and timed" },
]

const key = (subject: string, group: string, name: string) => `${subject}|${group}|${name}`.toLowerCase().replace(/\s+/g, " ")
const label = (value: string | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

export function groupBy<T>(list: T[], keyOf: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of list) groups.set(keyOf(item), [...groups.get(keyOf(item)) ?? [], item])
  return groups
}

export const itemGroup = (item: CurriculumArea) => item.group?.trim() || UNGROUPED
export const activeItems = (learning: LearningWorkspace) => learning.curriculumAreas.filter((item) => !item.archivedAt)

export function isRecheckDue(item: CurriculumArea, now = new Date()) {
  if (item.rating !== "green" && item.rating !== "amber") return false
  return now.getTime() - new Date(item.ratedAt ?? 0).getTime() > RECHECK_DAYS[item.rating] * DAY_MS
}

// --- Evidence from mistakes and marked questions ---

export type ItemEvidence = { mistakes: number; open: number; due: number; awarded: number; available: number; lastAt?: string }

export function buildItemEvidence(data: Pick<AppData, "attempts" | "mistakes">, now = new Date()) {
  const evidence = new Map<string, ItemEvidence>()
  const at = (id: string) => {
    const current = evidence.get(id) ?? { mistakes: 0, open: 0, due: 0, awarded: 0, available: 0 }
    evidence.set(id, current)
    return current
  }
  const seen = (entry: ItemEvidence, date: string) => { if (!entry.lastAt || date > entry.lastAt) entry.lastAt = date }
  for (const mistake of data.mistakes) {
    const schedule = getMistakeSchedule(mistake)
    const open = !schedule.resolved && !mistake.suspended
    for (const id of mistake.itemIds ?? []) {
      const entry = at(id)
      entry.mistakes += 1
      if (open) { entry.open += 1; if (new Date(schedule.dueAt) <= now) entry.due += 1 }
      seen(entry, mistake.createdAt.slice(0, 10))
    }
  }
  for (const attempt of data.attempts) {
    for (const result of attempt.questionResults ?? []) {
      for (const id of result.itemIds ?? []) {
        const entry = at(id)
        entry.awarded += result.marksAwarded
        entry.available += result.maxMarks
        seen(entry, attempt.completedAt.slice(0, 10))
      }
    }
  }
  return evidence
}

/** Self-rated green, but unresolved mistakes or poor marks say otherwise. */
export function evidenceDisagrees(item: CurriculumArea, evidence?: ItemEvidence) {
  if (item.rating !== "green" || !evidence) return false
  return evidence.open > 0 || evidence.available > 0 && evidence.awarded / evidence.available < 0.6
}

// --- Rating ---

export function setRating(learning: LearningWorkspace, id: string, rating: StoplightRating, now = new Date()): LearningWorkspace {
  const timestamp = now.toISOString()
  return {
    ...learning,
    curriculumAreas: learning.curriculumAreas.map((item) => item.id === id ? { ...item, rating, ratedAt: timestamp, updatedAt: timestamp } : item),
    updatedAt: timestamp,
  }
}

/** A new open mistake on a green item drops it to amber; promotion stays manual. */
export function demoteGreens(learning: LearningWorkspace, mistakes: Mistake[], now = new Date()) {
  const hit = new Set(mistakes.filter((mistake) => !mistake.resolved && (mistake.marksLost ?? 1) > 0).flatMap((mistake) => mistake.itemIds ?? []))
  const previous = learning.curriculumAreas.filter((item) => item.rating === "green" && !item.archivedAt && hit.has(item.id))
  if (!previous.length) return { learning, previous }
  const demoted = new Set(previous.map((item) => item.id))
  const timestamp = now.toISOString()
  return {
    previous,
    learning: {
      ...learning,
      curriculumAreas: learning.curriculumAreas.map((item) => demoted.has(item.id) ? { ...item, rating: "amber" as const, ratedAt: timestamp, updatedAt: timestamp } : item),
      updatedAt: timestamp,
    },
  }
}

export function restoreItems(learning: LearningWorkspace, previous: CurriculumArea[], now = new Date()): LearningWorkspace {
  const timestamp = now.toISOString()
  const byId = new Map(previous.map((item) => [item.id, item]))
  return {
    ...learning,
    curriculumAreas: learning.curriculumAreas.map((item) => byId.has(item.id) ? { ...byId.get(item.id)!, updatedAt: timestamp } : item),
    updatedAt: timestamp,
  }
}

// --- Revision plan ---

const TASK_MINUTES = 25
const PLAN_DAYS = 7

/** Spreads the weakest items over the next study days; items with a planned task are skipped. */
export function planRevision(learning: LearningWorkspace, data: Pick<AppData, "attempts" | "mistakes">, subject?: string, now = new Date()) {
  const evidence = buildItemEvidence(data, now)
  const planned = new Set(learning.tasks.filter((task) => !task.archivedAt && task.status === "planned").map((task) => task.sourceId))
  const score = (item: CurriculumArea) => {
    const entry = evidence.get(item.id)
    return (item.rating === "red" ? 30 : item.rating === "amber" ? 20 : 10) + Math.min(entry?.open ?? 0, 5) * 2 + (entry?.available ? 10 * (1 - entry.awarded / entry.available) : 0)
  }
  const queue = activeItems(learning)
    .filter((item) => (!subject || item.subject === subject) && !planned.has(item.id) && (item.rating === "red" || item.rating === "amber" || isRecheckDue(item, now)))
    .toSorted((a, b) => score(b) - score(a))
  const days: string[] = []
  for (let offset = 0; days.length < PLAN_DAYS && offset < 14; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    if (learning.preferences.studyDays.includes(day.getDay())) days.push(localDate(day))
  }
  const perDay = Math.max(1, Math.floor(learning.preferences.dailyMinutes / TASK_MINUTES))
  const tasks = queue.slice(0, days.length * perDay).map((item, index) => materialiseTask({
    kind: "topic-practice",
    title: `Revise: ${item.name}`,
    subject: item.subject,
    detail: item.check ? `${itemGroup(item)} · Check: ${item.check}` : itemGroup(item),
    durationMinutes: Math.min(TASK_MINUTES, learning.preferences.dailyMinutes),
    plannedFor: days[Math.floor(index / perDay)],
    sourceId: item.id,
  }, now))
  if (!tasks.length) return { learning, count: 0 }
  return { learning: { ...learning, tasks: [...learning.tasks, ...tasks], updatedAt: now.toISOString() }, count: tasks.length }
}

// --- Chatbot import ---

export type ImportedItem = { group: string; name: string; check?: string; type?: StoplightType }

const SUBJECT_GUIDANCE: Array<[RegExp, string]> = [
  [/math|specialist|methods/i, "- Mathematics: one item per technique and per CAS skill. Say in the check whether it is tech-free or CAS. Include proofs and \"show that\" items as their own items."],
  [/physical education/i, "- Physical Education: keep study design terminology in the name (e.g. ATP-PC system, acute vs chronic responses). Checks use VCAA command terms (describe, explain, compare, analyse). Include the practical and data-analysis items needed for the SAC."],
  [/chem|physics|biolog|psych/i, "- Sciences: one recall item and, where relevant, one calculation or experimental-design item per concept."],
  [/english|literature|language|history|politic|legal|business|economics/i, "- Humanities and languages: one item per content point, one per skill (e.g. analysing an argument, a grammar structure), each checkable by a short written response."],
]

export function buildStoplightPrompt(subject: string) {
  const guidance = SUBJECT_GUIDANCE.filter(([pattern]) => pattern.test(subject)).map(([, text]) => text).join("\n")
  return `Turn the attached VCAA study design (or my teacher's course outline) for "${subject}" into a revision checklist.

Reply with ONLY one JSON code block, no other text, in exactly this shape:
{"groups":[{"group":"Unit 3 AOS 2 – Differentiation","items":[{"name":"Product rule","type":"technique","check":"Differentiate x²·sin(3x) without notes in under 1 minute"}]}]}

Rules:
- One item per key knowledge or key skill dot point. Split compound dot points into separate items, each one testable idea.
- Group by Unit and Area of Study, in study design order. At most 12 items per group. Item names must be unique within the subject.
- type: "recall" (definitions, facts), "technique" (a procedure you perform), "apply" (use in an unfamiliar context) or "practical" (data, investigations, practical work).
- check: ONE sentence a student could pass or fail in under 3 minutes, unaided. It must be observable ("Differentiate…", "Explain … using the terms …"), never "understand X".
${guidance ? `${guidance}\n` : ""}- Only include what is in my source. Do not invent content.
- If the reply would be very long, stop after a complete group and write CONTINUE? after the code block; I will ask for the rest.

Source:
`
}

// --- Chatbot revision session ---

/** Items are numbered by position so the reply can be mapped back without exposing ids. */
export function buildRevisionPrompt(subject: string, items: CurriculumArea[], evidence: Map<string, ItemEvidence>) {
  const lines = items.map((item, index) => {
    const entry = evidence.get(item.id)
    const notes = [item.rating ?? "unrated", entry?.open ? `${entry.open} open mistakes` : "", entry?.available ? `${entry.awarded}/${entry.available} marks` : ""].filter(Boolean).join(", ")
    return `${index + 1}. [${itemGroup(item)}] ${item.name}${item.check ? ` — check: ${item.check}` : ""} (${notes})`
  })
  return `You are my VCE ${subject} tutor. Help me revise the checklist below and decide a red, amber or green rating for each item.

Ratings: ${RATINGS.map(({ id, meaning }) => `${id} = ${meaning.toLowerCase()}`).join("; ")}.

Method:
- Start with red, then amber, unrated, and items with open mistakes or low marks. Ask ONE question at a time that tests an item's check, unaided, and wait for my answer.
- Mark my answer, correct it briefly, and re-teach if I was wrong. Then move on or retry in a different way.
- Judge ratings from my answers, not my confidence. Only rate items I was actually tested on.
- When I say "done", reply with ONLY one JSON code block in exactly this shape, using the item numbers below:
{"ratings":[{"n":1,"rating":"amber"}]}

Checklist:
${lines.join("\n")}
`
}

export function parseRatingsResponse(content: string, items: CurriculumArea[]) {
  const parsed = parseJsonPayload(content) as { ratings?: unknown } | unknown[]
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.ratings) ? parsed.ratings : []
  const ratings = new Map<string, StoplightRating>()
  for (const entry of list as Array<{ n?: unknown; rating?: unknown }>) {
    const item = items[Number(entry?.n) - 1]
    const rating = RATINGS.find(({ id }) => id === String(entry?.rating).toLowerCase())?.id
    if (item && rating) ratings.set(item.id, rating)
  }
  return ratings
}

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : ""

export function parseStoplightResponse(content: string): ImportedItem[] {
  const parsed = parseJsonPayload(content) as { groups?: unknown; items?: unknown } | unknown[]
  const record = (value: unknown) => typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
  const entries = Array.isArray(parsed)
    ? parsed.map((value) => ({ group: record(value).group, item: value }))
    : [
        ...(Array.isArray(parsed.groups) ? parsed.groups.flatMap((group) => Array.isArray(record(group).items) ? (record(group).items as unknown[]).map((item) => ({ group: record(group).group ?? record(group).name, item })) : []) : []),
        ...(Array.isArray(parsed.items) ? parsed.items.map((item) => ({ group: record(item).group, item })) : []),
      ]
  const seen = new Set<string>()
  return entries.flatMap(({ group, item }) => {
    const fields = typeof item === "string" ? { name: item } : record(item)
    const name = text(fields.name ?? fields.title, 200)
    const type = TYPES.find((candidate) => candidate === text(fields.type, 20).toLowerCase())
    const entry: ImportedItem = { group: text(group, 200) || "General", name, check: text(fields.check, 200) || undefined, type }
    const id = key("", entry.group, name)
    if (!name || seen.has(id)) return []
    seen.add(id)
    return [entry]
  })
}

/** Adds new items, refreshes check/type on existing ones. Ratings and ids are never touched, so links survive a re-import. */
export function mergeStoplightItems(learning: LearningWorkspace, subject: string, imported: ImportedItem[], now = new Date()) {
  const timestamp = now.toISOString()
  const existing = new Map(learning.curriculumAreas.map((item) => [key(item.subject, itemGroup(item), item.name), item]))
  const changed = new Map<string, CurriculumArea>()
  let added = 0
  for (const entry of imported) {
    const found = existing.get(key(subject, entry.group, entry.name))
    if (found) {
      const next = { ...(changed.get(found.id) ?? found), archivedAt: undefined, check: entry.check ?? found.check, type: entry.type ?? found.type, updatedAt: timestamp }
      changed.set(found.id, next)
    } else {
      added += 1
      const item: CurriculumArea = { id: crypto.randomUUID(), subject, name: entry.name, group: entry.group, check: entry.check, type: entry.type, createdAt: timestamp, updatedAt: timestamp }
      existing.set(key(subject, entry.group, entry.name), item)
      changed.set(item.id, item)
    }
  }
  const known = new Set(learning.curriculumAreas.map((item) => item.id))
  return {
    added,
    learning: {
      ...learning,
      curriculumAreas: [...learning.curriculumAreas.map((item) => changed.get(item.id) ?? item), ...[...changed.values()].filter((item) => !known.has(item.id))],
      updatedAt: timestamp,
    },
  }
}

// --- Linking mistakes and marked questions to items ---

export type LinkRecord = { id: string; subject: string; areaOfStudy?: string; text: string }
export type ItemLink = { id: string; itemIds: string[] }

/** Unlinked mistakes and marked questions in subjects that have a checklist. `only` limits to given ids. */
export function collectLinkRecords(data: Pick<AppData, "attempts" | "mistakes" | "learning">, only?: Set<string>): LinkRecord[] {
  const subjects = new Set(activeItems(data.learning).filter((item) => item.group).map((item) => item.subject.toLowerCase()))
  const attempts = new Map(data.attempts.map((attempt) => [attempt.id, attempt]))
  const records: LinkRecord[] = []
  for (const mistake of data.mistakes) {
    const subject = attempts.get(mistake.attemptId)?.subject
    if (!subject || !subjects.has(subject.toLowerCase()) || mistake.itemIds?.length || only && !only.has(mistake.id)) continue
    records.push({ id: mistake.id, subject, areaOfStudy: mistake.areaOfStudy, text: [mistake.question, mistake.questionText, mistake.explanation].filter(Boolean).join(" | ").slice(0, 600) })
  }
  for (const attempt of data.attempts) {
    if (!subjects.has(attempt.subject.toLowerCase())) continue
    for (const result of attempt.questionResults ?? []) {
      if (result.itemIds?.length || only && !only.has(result.id) || !result.areaOfStudy && !result.examinerNote) continue
      records.push({ id: result.id, subject: attempt.subject, areaOfStudy: result.areaOfStudy, text: [result.label, result.examinerNote].filter(Boolean).join(" | ").slice(0, 300) })
    }
  }
  return records
}

/** Items worth sending for these records: their matching groups when every record names one, else the whole subject. */
export function candidateItems(items: CurriculumArea[], records: LinkRecord[]) {
  const matched = records.map((record) => items.filter((item) => record.areaOfStudy && label(item.group) && label(item.group) === label(record.areaOfStudy)))
  return matched.every((group) => group.length) ? [...new Set(matched.flat())] : items
}

/** Writes AI links onto the latest data; manual (`user`) links are never overwritten. */
export function applyItemLinks(data: AppData, links: ItemLink[], now = new Date()) {
  const timestamp = now.toISOString()
  const byId = new Map(links.filter((link) => link.itemIds.length).map((link) => [link.id, link.itemIds.slice(0, 3)]))
  const linked: Mistake[] = []
  const mistakes = data.mistakes.map((mistake) => {
    const itemIds = byId.get(mistake.id)
    if (!itemIds || mistake.itemsBy === "user") return mistake
    const next = { ...mistake, itemIds, itemsBy: "ai" as const, updatedAt: timestamp }
    linked.push(next)
    return next
  })
  const attempts = data.attempts.map((attempt) => {
    if (!attempt.questionResults?.some((result) => byId.has(result.id) && result.itemsBy !== "user")) return attempt
    return {
      ...attempt,
      updatedAt: timestamp,
      questionResults: attempt.questionResults.map((result) => byId.has(result.id) && result.itemsBy !== "user" ? { ...result, itemIds: byId.get(result.id), itemsBy: "ai" as const } : result),
    }
  })
  const { learning, previous } = demoteGreens(data.learning, linked, now)
  return { data: { ...data, mistakes, attempts, learning }, linked: byId.size, demoted: previous }
}
