import { currentSubjectWork, isCurrentSubject } from "./subject-completion"
import { useEffect, useRef, useSyncExternalStore } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { AppData, AssessmentReference } from "./exam-data"
import { atarYears, buildAtarHistory, buildAtarModel, latestSavedEstimate, subjectAtarRows } from "./atar-model"
import type { ScalingReference } from "./scaling"
import { getMistakeSchedule } from "./exam-data"
import type { AppView } from "./app-view"
import { classPeriodsOn, periodSubjectName, subjectNameFor } from "./class-timetable"
import { isTimetableBreakLabel } from "./class-timetable-core"
import { isCompletedSac } from "./sac"
import { localDate } from "./learning-workspace"
import { sessionBlocks } from "./day-plan"
import { mergedStudyMilliseconds } from "./utils"
import { isPlanned, type CanonicalStudySession } from "./sync/sessionContract"
import type { SyncStatus } from "./sync"
import { getExamEnd, getExamStart, type Timetable } from "./timetable"

type Item = { id: string; title: string; subtitle: string; start: number; end: number; view: string; allDay?: boolean }
export const macDesktop = () => Boolean(import.meta.env.VITE_DESKTOP && isTauri() && navigator.platform.toLowerCase().includes("mac"))

/** "latest" = newest saved scenario, "live" = Focal estimates for your subjects, otherwise a pinned scenario id. */
export type WidgetAtarSettings = { source: string; target: boolean; change: boolean; subjects: boolean }
export type WidgetAtar = NonNullable<ReturnType<typeof atar>>
type WidgetState = { settings: WidgetAtarSettings; tick: number; atar?: WidgetAtar | null; sentAt?: number; error?: string; focus?: boolean }
// Device-local on purpose: the widget lives on this Mac, so synced account data stays unchanged.
const SETTINGS_KEY = "focal.widget.atar"
const defaults: WidgetAtarSettings = { source: "latest", target: true, change: true, subjects: true }
let state: WidgetState = { settings: (() => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") } } catch { return defaults } })(), tick: 0 }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function setWidgetState(patch: Partial<WidgetState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}
export const useWidgetState = () => useSyncExternalStore(subscribe, () => state)
export const widgetAtarSettings = () => state.settings
export function setWidgetAtarSettings(patch: Partial<WidgetAtarSettings>) {
  const settings = { ...state.settings, ...patch }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* Applies until restart without storage. */ }
  setWidgetState({ settings })
}
/** Republish now and ask WidgetKit to reload every timeline. */
export const refreshWidgets = () => setWidgetState({ tick: state.tick + 1 })
export const takeWidgetFocus = () => { if (state.focus) setWidgetState({ focus: false }); return Boolean(state.focus) }

let publishing = Promise.resolve()
function publish(snapshot: unknown) {
  // Serialize account switches/sign-out behind earlier writes so old data cannot win the race.
  const run = publishing.catch(() => undefined).then(() => invoke<void>("publish_widget_snapshot", { snapshot: JSON.stringify(snapshot) }))
  publishing = run
  void run.then(() => setWidgetState({ sentAt: Date.now(), error: undefined }), (error) => {
    setWidgetState({ error: String(error) })
    console.warn("Could not refresh Focal widgets:", error)
  })
}

// Recomputed live with the ATAR page's model from the chosen source; the page deep-links via view "atar".
function atar(data: AppData, references: AssessmentReference[], scaling: ScalingReference[], settings: WidgetAtarSettings) {
  const pinned = data.atarEstimates.find((item) => item.id === settings.source)
  // A deleted pin falls back to the newest scenario.
  const saved = settings.source === "live" ? undefined : pinned ?? latestSavedEstimate(data)
  const year = saved?.year ?? atarYears(scaling)[0]
  const rows = saved?.rows ?? subjectAtarRows(data.subjects, scaling)
  if (year === undefined || !rows.length) return null
  const model = buildAtarModel({ data, references, scaling, rows, year })
  const estimate = model.estimate
  // Missing live scores must not resurrect an old saved headline.
  if (!estimate) return null
  const trend = buildAtarHistory({ data, references, scaling, rows, year }).flatMap((point) => point.atar ?? [])
  const savedOn = saved && new Date(saved.savedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
  return {
    label: estimate.atarLabel, atar: estimate.atar, aggregate: estimate.aggregate, year,
    target: settings.target ? model.target : null, gap: settings.target ? model.gap : null,
    // Change since the previous point in the page's "Estimate over time" history.
    change: settings.change && estimate.atar !== null && trend.length > 1 ? Math.round((estimate.atar - trend.at(-2)!) * 100) / 100 : null,
    subjects: settings.subjects ? [...estimate.primaryFour, ...estimate.increments].map((item) => ({
      name: item.studyName.slice(0, 200), scaled: item.scaledScore, contribution: item.contribution, increment: item.role === "Increment",
    })) : [],
    source: saved ? `${pinned ? "Pinned" : "Newest"} scenario, saved ${savedOn}` : "Live Focal estimate",
    scenarioId: saved?.id ?? null,
  }
}

function snapshot(data: AppData, sessions: CanonicalStudySession[], timetable: Timetable | null, references: AssessmentReference[], scaling: ScalingReference[], settings: WidgetAtarSettings) {
  const atarEstimate = atar(data, references, scaling, settings)
  data = currentSubjectWork(data)
  const now = Date.now()
  const today = new Date()
  const agenda: Item[] = data.events.filter((event) => !event.deleted_at && !event.isFinished).map((event) => ({
    id: event.id, title: event.title, subtitle: [subjectNameFor(event.subjectId), event.location].filter(Boolean).join(" · "),
    start: Date.parse(event.startTime), end: Date.parse(event.endTime ?? event.startTime), view: "calendar",
  }))
  for (let offset = 0; offset < 14; offset++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
    const day = localDate(date)
    for (const period of data.classTimetable?.enabled ? classPeriodsOn(day, data.classTimetable) : []) {
      if (isTimetableBreakLabel(period.subject)) continue
      agenda.push({ id: `${day}:${period.period}`, title: periodSubjectName(period), subtitle: period.location ?? period.period,
        start: Date.parse(`${day}T${period.startTime}:00`), end: Date.parse(`${day}T${period.endTime}:00`), view: "timetable" })
    }
  }
  const tracked = new Set(data.trackedExamIds)
  const exams: Item[] = (timetable?.exams ?? []).filter((exam) => isCurrentSubject(data, exam.subject) && tracked.has(exam.id))
    .map((exam) => ({ id: exam.id, title: exam.subject, subtitle: exam.paper ?? "VCE exam", start: getExamStart(exam).getTime(), end: getExamEnd(exam).getTime(), view: "exams" }))
  for (const sac of data.sacRecords.filter((record) => !isCompletedSac(record))) {
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(sac.scheduledAt)
    const start = Date.parse(allDay ? `${sac.scheduledAt}T00:00:00` : sac.scheduledAt)
    const end = new Date(start)
    if (allDay) end.setDate(end.getDate() + 1)
    else end.setTime(start + sac.durationMinutes * 60_000)
    exams.push({ id: sac.id, title: sac.title, subtitle: `${sac.subject} · SAC`, start, end: end.getTime(), view: "sacs", allDay })
  }
  // Calendar exams also appear when the student does not use the official VCE picker.
  const assessmentIds = new Set(data.events.filter((event) => ["exam", "sac", "practice-sac"].includes(event.eventType)).map((event) => event.id))
  exams.push(...agenda.filter((item) => assessmentIds.has(item.id)))
  const upcoming = (items: Item[]) => [...new Map(items.filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= now)
    .sort((a, b) => a.start - b.start).map((item) => [`${item.start}:${item.title}`, { ...item, title: item.title.slice(0, 200), subtitle: item.subtitle.slice(0, 200) }])).values()].slice(0, 100)
  const blocks = sessions.filter((session) => !isPlanned(session) && (session.cancelled_at === null || session.started_at !== null)).flatMap((session) => sessionBlocks(session, now))
  const parsedBlocks = blocks.map((block) => ({ start: Date.parse(block.start), end: Date.parse(block.end) }))
  const days = Array.from({ length: 8 }, (_, index) => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index - 6)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime()
    // Union overlapping sessions; concurrent timers and imported overlaps must not double-count study.
    const dayStart = start.getTime(), dayEnd = Math.min(end, now)
    const ranges = parsedBlocks.map((block) => ({ start: Math.max(dayStart, block.start), end: Math.min(dayEnd, block.end) }))
    const milliseconds = mergedStudyMilliseconds(ranges)
    return { date: localDate(start), minutes: Math.round(milliseconds / 60_000), target: data.learning.preferences.studyDays.includes(start.getDay()) ? data.learning.preferences.dailyMinutes : 0 }
  })
  const attempts = new Map(data.attempts.map((attempt) => [attempt.id, attempt.subject]))
  const reviews = data.mistakes.filter((mistake) => !mistake.suspended).map((mistake) => ({
    subject: attempts.get(mistake.attemptId) ?? mistake.subject ?? "General", due: Date.parse(getMistakeSchedule(mistake).dueAt),
  })).filter((item) => Number.isFinite(item.due))
  return { version: 1, updatedAt: now, agenda: upcoming([...agenda, ...exams]), exams: upcoming(exams), days, reviews, atar: atarEstimate }
}

export function useDesktopWidgets(data: AppData, sessions: CanonicalStudySession[], timetable: Timetable | null,
  references: AssessmentReference[], scaling: ScalingReference[], accountId: string | undefined, status: SyncStatus, navigate: (view: AppView) => void) {
  const settings = useSyncExternalStore(subscribe, () => state.settings)
  const tick = useSyncExternalStore(subscribe, () => state.tick)
  const owner = useRef(accountId)
  const navigation = useRef(navigate)
  useEffect(() => { navigation.current = navigate }, [navigate])
  useEffect(() => {
    if (!import.meta.env.VITE_DESKTOP || !macDesktop()) return
    let disposed = false
    const open = (view: string) => {
      if (!["calendar", "timetable", "exams", "sacs", "focus", "mistakes", "settings", "atar"].includes(view)) return
      navigation.current(view as AppView)
      // Only the ATAR widget opens "atar"; land on the page's widget section.
      if (view === "atar") setWidgetState({ focus: true })
    }
    const listener = listen<string>("focal:widget-open", (event) => open(event.payload))
    void listener.then(() => invoke<string | null>("take_widget_navigation")).then((view) => { if (!disposed && view) open(view) }).catch(console.warn)
    return () => { disposed = true; void listener.then((unlisten) => unlisten()) }
  }, [])
  useEffect(() => {
    if (!import.meta.env.VITE_DESKTOP || !macDesktop()) return
    // Only clear on a real account change; the first render has no user yet while the session restores.
    if ((owner.current && owner.current !== accountId) || ["signed-out", "sign-in-required", "unconfigured"].includes(status)) {
      setWidgetState({ atar: undefined })
      publish(null)
    }
    owner.current = accountId
    // Local data is still the account's own while offline or with unpushed changes.
    if (!accountId || !["synced", "pending", "error"].includes(status)) return
    const update = () => {
      const value = snapshot(data, sessions, timetable, references, scaling, settings)
      setWidgetState({ atar: value.atar })
      publish(value)
    }
    const timer = window.setTimeout(update, 1200)
    const interval = window.setInterval(update, 60_000)
    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [data, sessions, timetable, references, scaling, accountId, status, settings, tick])
}
