import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Crosshair, Maximize2, Minus, Plus, RotateCcw, Timer, Trash2, X, ZoomIn } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { sessionBlocks } from "../lib/day-plan"
import { isPaused, isRunning } from "../lib/sync/sessionContract"
import { localDate } from "../lib/learning-workspace"
import { studySubjectOptions, subjectColor } from "../lib/studySubjects"
import { VCE_SUBJECTS, type CalendarEvent, type TimetablePeriod } from "../lib/types"
import { cn } from "../lib/utils"
import type { PastStudyLog } from "../lib/pastStudy"
import type { CanonicalStudySession } from "../lib/sync/sessionContract"

const SNAP = 5
const LAST_MINUTE = 24 * 60 - 1
const QUICK_LOGS = [25, 45, 60, 90]

type Tone = "class" | "event" | "done" | "todo" | "live"
interface Block {
  key: string; start: number; end: number; tone: Tone
  title: string; subject?: string; short: string; color?: string
  session?: CanonicalStudySession
}
type Range = { start: number; end: number }

const DAY = 24 * 60
const MIN_SPAN = 30
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 180, 360]

const TONE: Record<Tone, string> = {
  class: "border border-border bg-muted text-muted-foreground",
  event: "border border-chart-5/30 bg-chart-5/10 text-foreground",
  done: "border border-primary/35 bg-primary/20 text-foreground",
  live: "border border-primary bg-primary/25 text-foreground",
  todo: "border border-dashed border-primary/50 bg-primary/5 text-foreground",
}

function shiftDate(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number)
  return localDate(new Date(y, m - 1, d + days))
}

/** ponytail: minutes are wall-clock offsets from local midnight; a DST changeover day is out by an hour. */
function minuteOf(date: string, iso: string) {
  const [y, m, d] = date.split("-").map(Number)
  return (Date.parse(iso) - new Date(y, m - 1, d).getTime()) / 60_000
}

function isoAt(date: string, minute: number) {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(y, m - 1, d, 0, minute).toISOString()
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.round(minute % 60)).padStart(2, "0")}`
const parseHhmm = (value: string) => {
  const [h, m] = value.split(":").map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN
}
const clock = (minute: number) => {
  const h = Math.floor(minute / 60) % 24
  const m = Math.round(minute % 60)
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`
}
const duration = (minutes: number) => minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
const snap = (minute: number) => Math.round(minute / SNAP) * SNAP
const clamp = (minute: number) => Math.min(LAST_MINUTE, Math.max(0, minute))


/** Keep subject hues consistent, with theme-aware surfaces and readable text. */
function subjectStyle(block: Block, dim: boolean) {
  const { color } = block
  if (!color || dim) return undefined
  return {
    borderColor: `color-mix(in srgb, ${color} ${block.tone === "live" ? 80 : 45}%, var(--border))`,
    backgroundColor: `color-mix(in srgb, ${color} ${block.tone === "todo" ? 8 : 22}%, var(--card))`,
    color: `color-mix(in srgb, ${color} 15%, var(--foreground))`,
  }
}

/** A timer that is running or paused owns its own intervals; those cannot be edited or ticked off. */
const timing = (session: CanonicalStudySession) => isRunning(session) || isPaused(session)

/** Overlapping blocks go on separate rows, first free row wins, so nothing is drawn on top of anything else. */
function pack(items: Block[]): { row: Map<string, number>; rows: number } {
  const ends: number[] = []
  const row = new Map<string, number>()
  for (const block of items.toSorted((a, b) => a.start - b.start || a.end - b.end)) {
    let index = ends.findIndex((end) => end <= block.start)
    if (index < 0) index = ends.length
    ends[index] = block.end
    row.set(block.key, index)
  }
  return { row, rows: Math.max(1, ends.length) }
}

function clampWindow({ start, end }: Range): Range {
  const span = Math.min(DAY, Math.max(MIN_SPAN, end - start))
  const from = Math.min(DAY - span, Math.max(0, start))
  return { start: from, end: from + span }
}

/** Zooms so the minute under `center` stays where it is on screen. */
function zoomWindow(window: Range, factor: number, center: number): Range {
  const span = window.end - window.start
  const next = Math.min(DAY, Math.max(MIN_SPAN, span * factor))
  const start = center - (center - window.start) / span * next
  return clampWindow({ start, end: start + next })
}

/**
 * One day as a zoomable strip of hours: classes and events for context, study you did as
 * solid bars, study still to do as dashed ones (one kind of block, with a done flag). Drag across the track to log (past) or plan
 * (future) a block, then drag its edges or body to adjust it. Ctrl/pinch-scroll zooms, the
 * overview strip pans, and tiny blocks stay readable through chips and the detail row.
 */
export function StudyTimeline({ date, onDateChange, sessions, classes, events, subjects, onLog, onPlan, onRemove, onEdit, onStartFocus }: {
  date: string
  onDateChange: (date: string) => void
  sessions: CanonicalStudySession[]
  classes: TimetablePeriod[]
  events: CalendarEvent[]
  subjects: string[]
  onLog: (entry: PastStudyLog) => Promise<void>
  onPlan: (entry: { title: string; subjectId: string; start: string; end: string }) => Promise<void>
  /** Deletes a session, done or not. */
  onRemove?: (session: CanonicalStudySession) => Promise<void>
  /** Moves or resizes a session's block, or marks it done or not done. */
  onEdit: (session: CanonicalStudySession, patch: { blocks?: { start: string; end: string }[]; completed?: boolean }) => Promise<void>
  onStartFocus: (subject: string | undefined, intent: string) => void
}) {
  const [nowMs, setNowMs] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const isToday = date === localDate(new Date(nowMs))
  const now = minuteOf(date, new Date(nowMs).toISOString())

  const options = useMemo(() => {
    const own = studySubjectOptions(subjects)
    return own.length ? own : VCE_SUBJECTS.map(({ id, name }) => ({ id, name }))
  }, [subjects])

  const blocks = useMemo(() => {
    const out: Block[] = []
    for (const period of classes) {
      const start = parseHhmm(period.startTime)
      const end = parseHhmm(period.endTime)
      const title = period.subject || period.period
      if (end > start) out.push({ key: `class-${period.period}-${start}`, start, end, tone: "class", title: `${title} (class)`, short: title.slice(0, 3) })
    }
    for (const event of events) {
      if (event.deleted_at) continue
      const start = minuteOf(date, event.startTime)
      const end = event.endTime ? minuteOf(date, event.endTime) : start + 60
      if (end > 0 && start < DAY) out.push({ key: `event-${event.id}`, start, end: Math.max(end, start + 15), tone: "event", title: event.title, short: event.title.slice(0, 3) })
    }
    for (const session of sessions) {
      const subject = VCE_SUBJECTS.find((item) => item.id === session.subject_id)
      sessionBlocks(session, nowMs).forEach((block, index) => {
        const start = minuteOf(date, block.start)
        const end = minuteOf(date, block.end)
        if (end <= 0 || start >= DAY) return
        out.push({
          key: `session-${session.id}-${index}`, start, end, session,
          tone: block.live ? "live" : session.completed || session.started_at !== null ? "done" : "todo",
          title: session.title, subject: subject?.name ?? session.subject_id ?? undefined,
          short: subject?.shortCode ?? session.title.slice(0, 3), color: subjectColor(session.subject_id),
        })
      })
    }
    return out.map((block) => ({ ...block, start: Math.max(0, block.start), end: Math.min(DAY, block.end) }))
  }, [classes, events, sessions, date, nowMs])

  const context = blocks.filter((block) => block.tone === "class" || block.tone === "event")
  const study = blocks.filter((block) => block.tone !== "class" && block.tone !== "event")
  const contextRows = pack(context.filter((block) => block.end > 0))
  const studyRows = pack(study)
  const studied = Math.round(study.filter((block) => block.tone !== "todo").reduce((sum, block) => sum + block.end - block.start, 0))
  // A planned block whose time has gone by without being ticked off.
  const missed = (block: Block) => block.tone === "todo" && block.end <= now
  const minutesOf = (items: Block[]) => Math.round(items.reduce((sum, block) => sum + block.end - block.start, 0))
  const planned = minutesOf(study.filter((block) => block.tone === "todo" && !missed(block)))
  const notDone = minutesOf(study.filter(missed))
  const lastEnd = Math.max(-1, ...study.filter((block) => block.tone === "done" && block.end <= now).map((block) => block.end))

  // Auto-fit hugs everything on the day (and "now"), padded and never tighter than six hours;
  // an empty day shows the usual 7am-11pm so there is room to plan. Zooming overrides it.
  const fit = useMemo<Range>(() => {
    const marks = blocks.flatMap((block) => [block.start, block.end])
    if (!marks.length) return { start: 7 * 60, end: 23 * 60 }
    if (isToday) marks.push(now)
    const start = Math.floor((Math.min(...marks) - 30) / 60) * 60
    const end = Math.ceil((Math.max(...marks) + 30) / 60) * 60
    const grow = Math.max(0, 6 * 60 - (end - start)) / 2
    return clampWindow({ start: start - grow, end: end + grow })
  }, [blocks, isToday, now])
  const [view, setView] = useState<Range | null>(null)
  const { start: from, end: to } = view ?? fit
  const span = to - from
  const winRef = useRef<Range>({ start: from, end: to })
  useEffect(() => { winRef.current = { start: from, end: to } })

  const [width, setWidth] = useState(800)
  const lane = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = lane.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    // Ctrl/⌘ + wheel (and trackpad pinch) zooms about the pointer; shift or sideways scroll pans.
    const onWheel = (event: WheelEvent) => {
      const window = winRef.current
      const rect = el.getBoundingClientRect()
      const size = window.end - window.start
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        setView(zoomWindow(window, Math.min(2, Math.max(0.5, Math.exp(event.deltaY * 0.01))), window.start + (event.clientX - rect.left) / rect.width * size))
      } else if ((event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) && size < DAY) {
        event.preventDefault()
        const delta = (event.deltaX || event.deltaY) / rect.width * size
        setView(clampWindow({ start: window.start + delta, end: window.end + delta }))
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => { observer.disconnect(); el.removeEventListener("wheel", onWheel) }
  }, [])

  const left = (minute: number) => `${(Math.min(to, Math.max(from, minute)) - from) / span * 100}%`
  const place = (start: number, end: number) => ({ left: left(start), width: `max(3px, ${(Math.min(to, end) - Math.max(from, start)) / span * 100}%)` })
  const shown = (block: Block) => block.end > from && block.start < to
  const pixels = (block: Block) => (Math.min(to, block.end) - Math.max(from, block.start)) / span * width
  // Ticks thin out as the window widens so labels never collide.
  const step = TICK_STEPS.find((candidate) => candidate / span * width >= 64) ?? 360
  const ticks = Array.from({ length: Math.floor((to - from) / step) + 2 }, (_, index) => Math.ceil(from / step) * step + index * step).filter((minute) => minute <= to)

  // The subject you studied most recently is the one you most likely studied again.
  const recentSubject = useMemo(() => [...sessions]
    .filter((session) => session.completed && options.some((option) => option.id === session.subject_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.subject_id ?? options[0]?.id ?? "", [sessions, options])

  const [draft, setDraft] = useState<Range | null>(null)
  const [drag, setDrag] = useState<{ anchor: number; current: number; moved: boolean } | null>(null)
  const [editing, setEditing] = useState<{ kind: "start" | "end" | "move"; offset: number } | null>(null)
  const [adjust, setAdjust] = useState<{ key: string; kind: "start" | "end" | "move"; offset: number; range: Range; moved: boolean; saving: boolean } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [doneOverride, setDoneOverride] = useState<boolean | null>(null)
  const [subjectId, setSubjectId] = useState("")
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const titleInput = useRef<HTMLInputElement>(null)
  const suppressClick = useRef(false)

  function reveal(range: Range) {
    if (range.start >= from && range.end <= to) return
    const size = Math.max(span, (range.end - range.start) * 1.5)
    const center = (range.start + range.end) / 2
    setView(clampWindow({ start: center - size / 2, end: center + size / 2 }))
  }

  function open(range: Range) {
    const next = { start: clamp(range.start), end: clamp(Math.max(range.end, range.start + 5)) }
    setDraft(next)
    reveal(next)
    setSelected(null)
    setDoneOverride(null)
    setSubjectId((current) => current || recentSubject)
    setError("")
    requestAnimationFrame(() => titleInput.current?.focus())
  }

  function quick(minutes: number) {
    open({ start: Math.max(0, Math.floor(now) - minutes), end: Math.floor(now) })
  }

  function zoomBy(factor: number) {
    const center = draft ? (draft.start + draft.end) / 2 : isToday && now >= from && now <= to ? now : (from + to) / 2
    setView(zoomWindow({ start: from, end: to }, factor, center))
  }

  function zoomTo(block: Block) {
    const size = Math.max(60, (block.end - block.start) * 2.5)
    const center = (block.start + block.end) / 2
    setView(clampWindow({ start: center - size / 2, end: center + size / 2 }))
  }

  /** Pulls a minute onto a nearby block edge or "now" (within ~8px) so blocks can sit flush. */
  function magnet(minute: number) {
    const reach = 8 / width * span
    const edges = [...blocks.flatMap((block) => [block.start, block.end]), ...(isToday ? [now] : [])]
    const near = edges.filter((edge) => Math.abs(edge - minute) <= reach).sort((a, b) => Math.abs(a - minute) - Math.abs(b - minute))[0]
    return near === undefined ? minute : Math.round(near)
  }

  function minuteAt(clientX: number, magnetic = true) {
    const rect = lane.current!.getBoundingClientRect()
    const minute = snap(from + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * span)
    return clamp(magnetic ? magnet(minute) : minute)
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const minute = minuteAt(event.clientX)
    setSelected(null)
    setDrag({ anchor: minute, current: minute, moved: false })
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = minuteAt(event.clientX)
    if (!drag) return setHover(event.pointerType === "mouse" ? current : null)
    if (current !== drag.current) setDrag({ ...drag, current, moved: true })
    // Dragging against either end of the track scrolls the window along.
    const rect = lane.current!.getBoundingClientRect()
    const edge = event.clientX < rect.left + 24 ? -1 : event.clientX > rect.right - 24 ? 1 : 0
    if (edge && span < DAY) setView(clampWindow({ start: from + edge * span * 0.03, end: to + edge * span * 0.03 }))
  }

  function pointerUp() {
    if (!drag) return
    setDrag(null)
    if (drag.moved && drag.current !== drag.anchor) return open({ start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) })
    // A tap just after you finished studying means "I just did this": end it now.
    if (isToday && drag.anchor <= now && drag.anchor + 30 > now) return quick(30)
    // A tap makes a block sized for the zoom: ten minutes when zoomed right in, half an hour otherwise.
    open({ start: drag.anchor, end: drag.anchor + (span <= 60 ? 10 : span <= 120 ? 15 : 30) })
  }

  /** Drag a draft's edges to resize it, or its body to move it, without reopening the form. */
  const editProps = (kind: "start" | "end" | "move") => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!draft || event.button !== 0) return
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      setEditing({ kind, offset: minuteAt(event.clientX, kind !== "move") - draft.start })
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (!editing || !draft) return
      event.stopPropagation()
      const minute = minuteAt(event.clientX, editing.kind !== "move")
      if (editing.kind === "start") setDraft({ start: Math.min(minute, draft.end - SNAP), end: draft.end })
      else if (editing.kind === "end") setDraft({ start: draft.start, end: Math.max(minute, draft.start + SNAP) })
      else {
        const length = draft.end - draft.start
        const start = Math.max(0, Math.min(snap(minute - editing.offset), LAST_MINUTE - length))
        setDraft({ start, end: start + length })
      }
    },
    onPointerUp: () => setEditing(null),
    onPointerCancel: () => setEditing(null),
  })

  /** Any block of a session that is not being timed, with one block, fully inside the day, can be dragged or resized. */
  const movable = (block: Block) => Boolean(block.session && block.tone !== "live" && !timing(block.session) && block.start > 0 && block.end < DAY && blocks.filter((other) => other.session === block.session).length === 1)
  const adjustProps = (block: Block, kind: "start" | "end" | "move") => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || adjust?.saving) return
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      setAdjust({ key: block.key, kind, offset: minuteAt(event.clientX, kind !== "move") - block.start, range: { start: block.start, end: block.end }, moved: false, saving: false })
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (!adjust || adjust.key !== block.key || adjust.saving) return
      event.stopPropagation()
      const minute = minuteAt(event.clientX, adjust.kind !== "move")
      const { range } = adjust
      const next = adjust.kind === "start" ? { start: Math.min(minute, range.end - SNAP), end: range.end }
        : adjust.kind === "end" ? { start: range.start, end: Math.max(minute, range.start + SNAP) }
        : (() => {
          const length = range.end - range.start
          const start = Math.max(SNAP, Math.min(snap(minute - adjust.offset), DAY - SNAP - length))
          return { start, end: start + length }
        })()
      if (next.start !== range.start || next.end !== range.end) setAdjust({ ...adjust, range: next, moved: true })
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      if (!adjust || adjust.key !== block.key || adjust.saving) return
      if (!adjust.moved || !block.session) return setAdjust(null)
      // The drag ended on this element, so the click that follows must not also select it.
      event.preventDefault()
      suppressClick.current = true
      setTimeout(() => { suppressClick.current = false }, 100)
      persist(block, adjust.range, adjust.kind)
    },
    onPointerCancel: () => setAdjust(null),
  })

  function persist(block: Block, range: Range, kind: "start" | "end" | "move" = "move") {
    if (!block.session) return
    setAdjust({ key: block.key, kind, offset: 0, range, moved: true, saving: true })
    onEdit(block.session, { blocks: [{ start: isoAt(date, range.start), end: isoAt(date, range.end) }] })
      .then(() => toast.success(`Moved to ${clock(range.start)}–${clock(range.end)}`))
      .catch((failure) => toast.error(failure instanceof Error ? failure.message : "Could not move that block."))
      .finally(() => setAdjust(null))
  }

  /** Arrow keys move a focused block by 5 minutes (15 with Shift); Alt resizes its end instead. */
  function nudge(event: ReactKeyboardEvent<HTMLElement>, block: Block) {
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
    if (!direction || adjust || !movable(block)) return
    event.preventDefault()
    const delta = direction * (event.shiftKey ? 15 : SNAP)
    const range = event.altKey
      ? { start: block.start, end: Math.max(block.start + SNAP, Math.min(DAY - SNAP, block.end + delta)) }
      : { start: Math.max(SNAP, Math.min(block.start + delta, DAY - SNAP - (block.end - block.start))), end: 0 }
    if (!event.altKey) range.end = range.start + block.end - block.start
    if (range.start === block.start && range.end === block.end) return
    reveal(range)
    persist(block, range, event.altKey ? "end" : "move")
  }

  /** Delete arms the remove confirmation for a focused session block; arrows nudge it. */
  function blockKey(event: ReactKeyboardEvent<HTMLElement>, block: Block) {
    if ((event.key === "Delete" || event.key === "Backspace") && block.session && block.tone !== "live") {
      event.preventDefault()
      setSelected(block.key)
      setConfirmRemove(true)
      setDraft(null)
    } else nudge(event, block)
  }

  /** Puts a missed block at the next free five minutes from now, keeping its length. */
  function restart(block: Block) {
    const length = block.end - block.start
    const start = Math.min(DAY - SNAP - length, Math.ceil(now / SNAP) * SNAP)
    persist(block, { start, end: start + length })
  }

  async function repeatTomorrow(block: Block) {
    const session = block.session
    if (!session?.subject_id) return
    const next = shiftDate(date, 1)
    try {
      await onPlan({ title: session.title, subjectId: session.subject_id, start: isoAt(next, block.start), end: isoAt(next, block.end) })
      toast.success(`Planned again for ${clock(block.start)} tomorrow`)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not plan that again.")
    }
  }

  // Study that has not finished cannot be done; otherwise a past block defaults to done and may be left undone.
  const done = draft ? draft.end <= now && (doneOverride ?? true) : false
  const draftColor = subjectColor(subjectId)
  const clash = draft ? blocks.filter((block) => block.start < draft.end && block.end > draft.start) : []
  const mode = draft ? (done ? "log" : "plan") : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft || busy) return
    const subject = options.find((option) => option.id === subjectId)
    if (!subject) return setError("Choose a subject.")
    if (!(draft.end > draft.start)) return setError("End must be after start.")
    const entry = { title: title.trim() || `${subject.name} study`, subjectId: subject.id, start: isoAt(date, draft.start), end: isoAt(date, draft.end) }
    setBusy(true)
    try {
      if (mode === "log") await onLog({ subjectId: entry.subjectId, title: entry.title, blocks: [{ start: entry.start, end: entry.end }] })
      else await onPlan(entry)
      toast.success(`${mode === "log" ? "Logged" : "Scheduled"} ${duration(draft.end - draft.start)} of ${subject.name}`)
      setDraft(null)
      setTitle("")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function toggleDone(session: CanonicalStudySession) {
    try {
      await onEdit(session, { completed: !session.completed })
      toast.success(session.completed ? "Marked not done" : "Marked done")
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not update that study.")
    }
  }

  async function remove(session: CanonicalStudySession) {
    try {
      await onRemove?.(session)
      toast("Study removed")
      setSelected(null)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not remove that study.")
    } finally {
      setConfirmRemove(false)
    }
  }

  function select(block: Block) {
    if (suppressClick.current) { suppressClick.current = false; return }
    setSelected((current) => current === block.key ? null : block.key)
    setConfirmRemove(false)
    setDraft(null)
  }

  const picked = blocks.find((block) => block.key === selected)
  const selection = drag ? { start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) || drag.anchor + 30 } : draft
  const bubble = adjust?.moved
    ? { at: (adjust.range.start + adjust.range.end) / 2, text: `${clock(adjust.range.start)}–${clock(adjust.range.end)} · ${duration(adjust.range.end - adjust.range.start)}` }
    : drag?.moved || editing
    ? selection && { at: (selection.start + selection.end) / 2, text: `${clock(selection.start)}–${clock(selection.end)} · ${duration(selection.end - selection.start)}` }
    : hover !== null ? { at: hover, text: clock(hover) } : null
  // Blocks without room for their time range get a readable summary below the track.
  const cramped = blocks.filter((block) => shown(block) && pixels(block) < 150)
  const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })
  const relative = isToday ? "Today" : date === shiftDate(localDate(new Date(nowMs)), -1) ? "Yesterday" : date === shiftDate(localDate(new Date(nowMs)), 1) ? "Tomorrow" : null

  return (
    <Card className="gap-4 [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(5)]">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Study timeline</p>
            <div className="flex min-w-0 items-center gap-2">
              <CardTitle className="min-w-0 text-base font-semibold sm:text-lg" aria-live="polite">{relative ? `${relative} · ${dayLabel}` : dayLabel}</CardTitle>
              <div className="flex shrink-0 items-center rounded-lg border" role="group" aria-label="Change day">
                <Button aria-label="Previous day" onClick={() => onDateChange(shiftDate(date, -1))} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
                <Button aria-label="Next day" onClick={() => onDateChange(shiftDate(date, 1))} size="icon-sm" variant="ghost"><ChevronRight /></Button>
              </div>
              {!isToday ? <Button onClick={() => onDateChange(localDate(new Date()))} size="sm" variant="outline">Today</Button> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isToday ? (
              <>
                <Button onClick={() => { const next = Math.ceil(now / 30) * 30; open({ start: next, end: next + 60 }) }} size="sm" variant="outline"><Plus />Plan study</Button>
                <Button onClick={() => onStartFocus(undefined, "")} size="sm"><Timer />Start timer</Button>
              </>
            ) : (
              <Button onClick={() => open({ start: 16 * 60, end: 17 * 60 })} size="sm" variant="outline">
                <Plus />{date < localDate(new Date(nowMs)) ? "Log study" : "Add study"}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums" aria-live="polite">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 font-medium text-primary"><Check className="size-3.5" />{duration(studied)} studied</span>
            {planned ? <span className="rounded-md border border-dashed px-2.5 py-1.5 text-muted-foreground">{duration(planned)} planned</span> : null}
            {notDone ? <span className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-destructive">{duration(notDone)} missed</span> : null}
          </div>
          {isToday ? (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Quick log study">
              <span className="mr-2 text-xs text-muted-foreground">Just studied?</span>
              {lastEnd > 0 && now - lastEnd >= 5 && now - lastEnd <= 6 * 60 ? (
                <Button onClick={() => open({ start: lastEnd, end: Math.floor(now) })} size="sm" variant="outline">Since {clock(lastEnd)}</Button>
              ) : null}
              {QUICK_LOGS.map((minutes) => <Button className="tabular-nums" key={minutes} onClick={() => quick(minutes)} size="sm" variant="secondary">{duration(minutes)}</Button>)}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardDescription className="text-xs">Drag the track to {isToday ? "log or plan study" : date < localDate(new Date(nowMs)) ? "log study" : "plan study"}</CardDescription>
          <div className="flex items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5" role="group" aria-label="Zoom">
            <Button aria-label="Zoom out" disabled={span >= DAY} onClick={() => zoomBy(2)} size="icon-sm" title="Zoom out (Ctrl + scroll)" variant="ghost"><Minus /></Button>
            <Button aria-label="Zoom in" disabled={span <= MIN_SPAN} onClick={() => zoomBy(0.5)} size="icon-sm" title="Zoom in (Ctrl + scroll)" variant="ghost"><Plus /></Button>
            <span aria-hidden className="mx-1 h-3.5 w-px bg-border" />
            <Button disabled={view === null} onClick={() => setView(null)} size="sm" title="Fit the day's study" variant="ghost"><ZoomIn />Fit</Button>
            <Button disabled={span >= DAY} onClick={() => setView({ start: 0, end: DAY })} size="sm" title="Show all 24 hours" variant="ghost"><Maximize2 />24h</Button>
            {isToday ? <Button onClick={() => setView(clampWindow({ start: now - span / 2, end: now + span / 2 }))} size="sm" title="Centre on the current time" variant="ghost"><Crosshair />Now</Button> : null}
          </div>
        </div>
        <div className="relative select-none">
          {/* Context lane: what the day already holds. */}
          {context.some(shown) ? <div className="relative mb-3" style={{ height: contextRows.rows * 26 - 4 }}>
            {context.filter(shown).map((block) => (
              <button
                aria-label={`${block.title}, ${clock(block.start)} to ${clock(block.end)}`}
                aria-pressed={selected === block.key}
                className={cn("absolute h-[22px] min-w-0 truncate rounded-md text-left text-[0.6875rem] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring", TONE[block.tone], pixels(block) >= 60 ? "px-2" : "px-0", selected === block.key && "ring-2 ring-foreground/60")}
                key={block.key}
                onClick={() => select(block)}
                style={{ ...place(block.start, block.end), top: (contextRows.row.get(block.key) ?? 0) * 26 }}
                title={`${block.title} · ${clock(block.start)}–${clock(block.end)}`}
                type="button"
              >
                {pixels(block) >= 60 ? block.title : null}
              </button>
            ))}
          </div> : null}
          {/* Study lane: the drag target. */}
          <div
            aria-keyshortcuts="+ - 0 PageUp PageDown" aria-label="Study timeline. Drag to select a time range."
            style={{ height: studyRows.rows * 56 + 20 }}
            className="relative cursor-crosshair touch-none overflow-hidden rounded-xl border bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setDrag(null); setSelected(null) }
              else if (event.key === "+" || event.key === "=") zoomBy(0.5)
              else if (event.key === "-") zoomBy(2)
              else if (event.key === "0") setView(null)
              else if (event.key === "PageUp" || event.key === "PageDown") onDateChange(shiftDate(date, event.key === "PageUp" ? -1 : 1))
            }}
            onPointerCancel={() => setDrag(null)}
            onPointerDown={pointerDown}
            onPointerLeave={() => setHover(null)}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            ref={lane}
            role="group"
          >
            {ticks.map((minute) => <span aria-hidden className={cn("absolute inset-y-0 w-px", minute % 60 === 0 ? "bg-border/70" : "bg-border/35")} key={minute} style={{ left: left(minute) }} />)}
            {isToday && now > from ? <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 bg-background/25" style={{ width: left(Math.min(now, to)) }} /> : null}
            {study.filter(shown).map((live) => {
              const block = adjust?.key === live.key ? { ...live, ...adjust.range } : live
              const room = pixels(block)
              const grab = movable(block)
              return (
                <button
                  aria-label={`${block.tone === "todo" ? missed(block) ? "Missed" : "Planned" : block.tone === "live" ? "Studying now" : "Done"}: ${block.title}${block.subject ? `, ${block.subject}` : ""}, ${clock(block.start)} to ${clock(block.end)}`}
                  aria-pressed={selected === block.key}
                  className={cn("group/block absolute flex h-12 min-w-0 flex-col justify-center overflow-hidden rounded-lg text-left text-xs leading-4 whitespace-nowrap transition-[filter,box-shadow] hover:brightness-110 outline-none focus-visible:ring-2 focus-visible:ring-ring", TONE[block.tone], room >= 36 ? "px-2" : "px-0", missed(block) && "border-destructive/50 bg-destructive/10 text-destructive", selected === block.key && "ring-2 ring-ring ring-offset-2 ring-offset-card", grab ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")}
                  key={block.key}
                  onClick={() => select(block)}
                  onDoubleClick={() => zoomTo(block)}
                  onKeyDown={(event) => blockKey(event, block)}
                  style={{ ...place(block.start, block.end), top: 10 + (studyRows.row.get(live.key) ?? 0) * 56, ...subjectStyle(block, missed(block)) }}
                  {...(grab ? adjustProps(block, "move") : { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation() })}
                  title={`${block.title}${block.subject ? ` · ${block.subject}` : ""} · ${clock(block.start)}–${clock(block.end)} · ${duration(Math.round(block.end - block.start))} (double-click to zoom)`}
                  type="button"
                >
                  {room >= 150 ? <span className="block truncate font-medium">{block.title}</span> : room >= 36 ? <span className="block truncate">{block.short}</span> : null}
                  {room >= 150 ? <span className="block truncate text-[0.625rem] opacity-75">{block.tone === "live" ? "Studying now" : `${clock(block.start)}–${clock(block.end)}`}</span> : null}
                  {grab && room >= 36 ? (["start", "end"] as const).map((kind) => (
                    <span aria-hidden className={cn("absolute inset-y-0 flex w-2.5 cursor-ew-resize items-center justify-center", kind === "start" ? "left-0" : "right-0")} key={kind} {...adjustProps(block, kind)}>
                      <span className="h-4 w-0.5 rounded-full bg-current opacity-20 group-hover/block:opacity-60" />
                    </span>
                  )) : null}
                </button>
              )
            })}
            {selection ? (
              <span
                className={cn("absolute inset-y-1 rounded-lg border-2 border-primary bg-primary/15", mode === "plan" && !drag && "border-dashed", drag ? "pointer-events-none" : "cursor-grab active:cursor-grabbing")}
                style={{ left: left(selection.start), width: `${(Math.min(to, selection.end) - Math.max(from, selection.start)) / span * 100}%`, ...(draft && draftColor ? { borderColor: draftColor, backgroundColor: `color-mix(in srgb, ${draftColor} 15%, transparent)` } : {}) }}
                {...(drag ? {} : editProps("move"))}
              >
                {drag ? null : (["start", "end"] as const).map((kind) => (
                  <span aria-hidden className={cn("absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center", kind === "start" ? "-left-2" : "-right-2")} key={kind} {...editProps(kind)}>
                    <span className="h-5 w-1 rounded-full bg-primary" style={draftColor ? { backgroundColor: draftColor } : undefined} />
                  </span>
                ))}
              </span>
            ) : null}
            {hover !== null && !drag && !editing ? <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30" style={{ left: left(hover) }} /> : null}
            {isToday && now >= from && now <= to ? (
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-destructive" style={{ left: left(now) }}><span className="absolute -top-0 left-1/2 size-2 -translate-x-1/2 rounded-full bg-destructive" /></span>
            ) : null}
          </div>
          <div aria-hidden className="relative mt-2 h-5 text-[0.6875rem] text-muted-foreground tabular-nums">
            {ticks.map((minute) => {
              const at = (minute - from) / span * 100
              return <span className={cn("absolute", at < 3 ? "" : at > 97 ? "-translate-x-full" : "-translate-x-1/2")} key={minute} style={{ left: `${at}%` }}>{clock(minute)}</span>
            })}
            {bubble ? (
              <span className="absolute z-10 -translate-x-1/2 rounded-md bg-foreground px-2 py-0.5 whitespace-nowrap text-background shadow-sm" style={{ left: `${Math.min(88, Math.max(12, (bubble.at - from) / span * 100))}%` }}>{bubble.text}</span>
            ) : null}
          </div>
          {/* Where this window sits in the day: click or drag to pan. */}
          {span < DAY ? (
            <div
              aria-label="Day overview. Drag to pan the timeline."
              className="relative mt-2 h-5 cursor-ew-resize touch-none overflow-hidden rounded-md border bg-muted/50"
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pan(event) }}
              onPointerMove={(event) => { if (event.buttons) pan(event) }}
              role="group"
            >
              {blocks.map((block) => <span aria-hidden className={cn("absolute inset-y-1.5 rounded-sm opacity-60", block.tone === "class" || block.tone === "event" ? "bg-muted-foreground/30" : "bg-primary/70")} key={block.key} style={{ backgroundColor: block.color, left: `${block.start / DAY * 100}%`, width: `max(2px, ${(block.end - block.start) / DAY * 100}%)` }} />)}
              {isToday ? <span aria-hidden className="absolute inset-y-0 w-px bg-destructive" style={{ left: `${now / DAY * 100}%` }} /> : null}
              <span aria-hidden className="absolute inset-y-0 rounded border border-primary/50 bg-primary/5" style={{ left: `${from / DAY * 100}%`, width: `${span / DAY * 100}%` }} />
            </div>
          ) : null}
        </div>

        {cramped.length ? (
          <ul aria-label="Short blocks" className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {cramped.map((block) => (
              <li className="min-w-0" key={block.key}>
                <button
                  aria-pressed={selected === block.key}
                  className={cn("flex w-full min-w-0 items-center gap-2.5 rounded-lg border bg-muted/15 px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring", selected === block.key && "border-primary/50 bg-primary/5")}
                  onClick={() => select(block)}
                  type="button"
                >
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", block.tone === "todo" ? "border border-dashed border-primary" : "bg-muted-foreground/40")} style={{ backgroundColor: block.tone === "todo" ? undefined : block.color, borderColor: block.color }} />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-xs font-medium">{block.title}</span>
                    <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{clock(block.start)}–{clock(block.end)}{block.tone === "todo" ? missed(block) ? " · Missed" : " · Planned" : block.tone === "live" ? " · Studying now" : ""}</span>
                  </span>
                  <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">{duration(Math.round(block.end - block.start))}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {picked ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-muted/20 p-3 sm:p-4" role="region" aria-label="Selected block">
            <span aria-hidden style={{ backgroundColor: picked.tone === "todo" ? undefined : picked.color, borderColor: picked.color }} className={cn("size-2 shrink-0 rounded-full", picked.tone === "todo" ? "border border-dashed border-primary" : picked.tone === "class" ? "bg-muted-foreground/40" : picked.tone === "event" ? "bg-chart-5" : "bg-primary")} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{picked.title}</p>
              <p className="truncate text-xs text-muted-foreground tabular-nums">
                {[picked.subject, `${clock(picked.start)}–${clock(picked.end)}`, duration(Math.round(picked.end - picked.start)), { class: "Class", event: "Event", done: "Done", todo: missed(picked) ? "Missed" : "Planned", live: "Studying now" }[picked.tone]].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button onClick={() => zoomTo(picked)} size="xs" variant="outline"><ZoomIn />Zoom</Button>
              {picked.session && !timing(picked.session) ? (
                <Button disabled={!picked.session.completed && picked.end > now} onClick={() => toggleDone(picked.session!)} size="xs" title={!picked.session.completed && picked.end > now ? "It hasn't finished yet" : undefined} variant="outline">
                  {picked.session.completed ? <><RotateCcw />Not done</> : <><Check />Mark done</>}
                </Button>
              ) : null}
              {picked.session && missed(picked) && movable(picked) ? <Button disabled={adjust !== null} onClick={() => restart(picked)} size="xs" variant="outline"><RotateCcw />Move to now</Button> : null}
              {picked.session?.subject_id ? <Button onClick={() => repeatTomorrow(picked)} size="xs" variant="outline"><CalendarPlus />Repeat tomorrow</Button> : null}
              {picked.session ? <Button onClick={() => onStartFocus(picked.subject, picked.title)} size="xs" variant="outline"><Timer />{picked.tone === "todo" ? "Start" : "Study again"}</Button> : null}
              {picked.session && picked.tone !== "live" ? (
                confirmRemove
                  ? <Button onClick={() => remove(picked.session!)} size="xs" variant="destructive"><Trash2 />Remove for good?</Button>
                  : <Button aria-label="Remove" onClick={() => setConfirmRemove(true)} size="xs" variant="outline"><Trash2 />Remove</Button>
              ) : null}
              <Button aria-label="Close details" onClick={() => setSelected(null)} size="icon-xs" variant="ghost"><X /></Button>
            </div>
          </div>
        ) : null}

        {draft ? (
          <form className="grid gap-2 rounded-xl border bg-muted/20 p-3 sm:p-4" onKeyDown={(event) => { if (event.key === "Escape") setDraft(null) }} onSubmit={submit}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{mode === "plan" ? "Schedule" : "Log"}</span>
              <Input aria-label="Start time" className="h-7 w-28 px-1.5 text-xs" onChange={(event) => { const minute = parseHhmm(event.target.value); if (Number.isFinite(minute)) setDraft({ ...draft, start: minute }) }} type="time" value={hhmm(draft.start)} />
              <span aria-hidden className="text-muted-foreground">–</span>
              <Input aria-label="End time" className="h-7 w-28 px-1.5 text-xs" onChange={(event) => { const minute = parseHhmm(event.target.value); if (Number.isFinite(minute)) setDraft({ ...draft, end: minute }) }} type="time" value={hhmm(draft.end)} />
              <span className="text-xs text-muted-foreground tabular-nums">{draft.end > draft.start ? duration(draft.end - draft.start) : ""}</span>
              <Button aria-label="Cancel" className="ml-auto" onClick={() => setDraft(null)} size="icon-xs" type="button" variant="ghost"><X /></Button>
            </div>
            <div aria-label="Length" className="flex flex-wrap items-center gap-1" role="group">
              {[15, 30, 45, 60, 90].map((minutes) => (
                <Button key={minutes} onClick={() => setDraft({ ...draft, end: Math.min(LAST_MINUTE, draft.start + minutes) })} size="xs" type="button" variant={draft.end - draft.start === minutes ? "default" : "outline"}>{duration(minutes)}</Button>
              ))}
              {clash.length ? <span className="ml-1 text-xs text-muted-foreground">Overlaps {clash.slice(0, 2).map((block) => block.title).join(", ")}{clash.length > 2 ? ` +${clash.length - 2}` : ""}</span> : null}
            </div>
            {options.length > 12 ? (
              <select aria-label="Subject" className="h-7 w-fit rounded-md border bg-background px-1.5 text-xs" onChange={(event) => setSubjectId(event.target.value)} value={subjectId}>
                {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            ) : (
              <div aria-label="Subject" className="flex flex-wrap gap-1" role="radiogroup">
                {options.map((option) => (
                  <Button aria-checked={subjectId === option.id} key={option.id} onClick={() => setSubjectId(option.id)} role="radio" size="xs" type="button" variant={subjectId === option.id ? "default" : "outline"}>{option.name}</Button>
                ))}
              </div>
            )}
            <label className={cn("flex w-fit items-center gap-2 text-xs", draft.end > now && "text-muted-foreground")}>
              <input checked={done} className="size-3.5 accent-primary" disabled={draft.end > now} onChange={(event) => setDoneOverride(event.target.checked)} type="checkbox" />
              Done{draft.end > now ? " (it hasn't finished yet)" : ""}
            </label>
            <div className="flex flex-wrap gap-2">
              <Input aria-label="Study title" className="h-8 min-w-0 flex-1 basis-40" onChange={(event) => setTitle(event.target.value)} placeholder={`${options.find((option) => option.id === subjectId)?.name ?? "Study"} study`} ref={titleInput} value={title} />
              <Button disabled={busy || !(draft.end > draft.start)} type="submit">{busy ? "Saving…" : `${mode === "plan" ? "Schedule" : "Log"}${draft.end > draft.start ? ` ${duration(draft.end - draft.start)}` : ""}`}</Button>
            </div>
            {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  )

  function pan(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const center = (event.clientX - rect.left) / rect.width * DAY
    setView(clampWindow({ start: center - span / 2, end: center + span / 2 }))
  }
}
