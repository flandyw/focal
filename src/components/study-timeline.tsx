import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { CalendarPlus, Check, CheckCheck, ChevronLeft, ChevronRight, Crosshair, Merge, MousePointer2, Minus, Play, Plus, RotateCcw, Scissors, Timer, Trash2, X, ZoomIn } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./ui/button"
import { Card, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { NativeSelect, NativeSelectOption } from "./ui/native-select"
import { continuableToday, sessionBlocks, sessionItem } from "../lib/day-plan"
import { isPaused, isRunning, studySessionSubjectSpans, type SubjectSwitch } from "../lib/sync/sessionContract"
import { subjectNameFor } from "../lib/class-timetable"
import { localDate } from "../lib/learning-workspace"
import { studySubjectId, studySubjectOptions, subjectColor } from "../lib/studySubjects"
import { VCE_SUBJECTS, type CalendarEvent, type TimetablePeriod } from "../lib/types"
import { cn } from "../lib/utils"
import type { PastStudyLog } from "../lib/pastStudy"
import type { CanonicalStudySession, StudySessionEdit } from "../lib/sync/sessionContract"
import { Checkbox } from "./ui/checkbox"
import { Label } from "./ui/label"

const SNAP = 1
const LAST_MINUTE = 24 * 60 - 1
const QUICK_LOGS = [25, 45, 60, 90]

type Tone = "class" | "event" | "done" | "todo" | "live"
interface Block {
  key: string; start: number; end: number; tone: Tone
  title: string; subject?: string; short: string; color?: string
  /** Where the subject switched inside this block, in minutes of the day. */
  bands?: { start: number; end: number; color?: string }[]
  session?: CanonicalStudySession
  interval?: number
  event?: CalendarEvent
  period?: TimetablePeriod
}
type Range = { start: number; end: number }

const DAY = 24 * 60
const MIN_SPAN = 30
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360]

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
const duration = (minutes: number) => {
  if (minutes > 0 && minutes < 1) return minutes < 1 / 60 ? "<1s" : `${Math.round(minutes * 60)}s`
  const rounded = Math.round(minutes)
  return rounded < 60 ? `${rounded}m` : `${Math.floor(rounded / 60)}h${rounded % 60 ? ` ${rounded % 60}m` : ""}`
}
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
export function StudyTimeline({ date, nowMs, onDateChange, sessions, classes, events, subjects, onLog, onPlan, onRemove, onEdit, onEditEvent, onEditClass, onOpenEvent, onOpenClass, onMerge, onOpenSession, onStartFocus }: {
  date: string
  nowMs: number
  onDateChange: (date: string) => void
  sessions: CanonicalStudySession[]
  classes: TimetablePeriod[]
  events: CalendarEvent[]
  subjects: string[]
  onLog: (entry: PastStudyLog) => Promise<void>
  onPlan: (entry: { title: string; subjectId: string; subjectSwitches?: SubjectSwitch[]; start: string; end: string }) => Promise<void>
  /** Deletes a session, done or not. */
  onRemove?: (session: CanonicalStudySession) => Promise<void>
  /** Moves or resizes a session's block, or marks it done or not done. */
  onEdit: (session: CanonicalStudySession, patch: StudySessionEdit) => Promise<void>
  /** Omit the event and class handlers (and `onOpenSession`) for a timeline that only edits study. */
  onEditEvent?: (event: CalendarEvent, patch: { startTime: string; endTime: string }) => void
  onEditClass?: (period: TimetablePeriod, patch: { startTime: string; endTime: string }) => void
  onOpenEvent?: (event: CalendarEvent) => void
  onOpenClass?: () => void
  onMerge: (sessions: CanonicalStudySession[]) => Promise<void>
  onOpenSession?: (session: CanonicalStudySession) => void
  onStartFocus: (subject: string | undefined, intent: string, sessionId?: string) => void
}) {
  const isToday = date === localDate(new Date(nowMs))
  const now = minuteOf(date, new Date(nowMs).toISOString())

  const options = useMemo(() => {
    const own = studySubjectOptions(subjects)
    return own.length ? own : VCE_SUBJECTS.map(({ id, name }) => ({ id, name }))
  }, [subjects])

  const blocks = useMemo(() => {
    const out: Block[] = []
    for (const [index, period] of classes.entries()) {
      const start = parseHhmm(period.startTime)
      const end = parseHhmm(period.endTime)
      const title = period.subject || period.period
      if (end > start) out.push({ key: `class-${index}`, start, end, period, tone: "class", title: `${title} (class)`, short: title.slice(0, 3) })
    }
    for (const event of events) {
      if (event.deleted_at) continue
      const start = minuteOf(date, event.startTime)
      const end = event.endTime ? minuteOf(date, event.endTime) : start + 60
      if (end > 0 && start < DAY) out.push({ key: `event-${event.id}`, start, end: end > start ? end : start + 15, event, tone: "event", title: event.title, short: event.title.slice(0, 3) })
    }
    for (const session of sessions) {
      sessionBlocks(session, nowMs).forEach((block, index) => {
        const start = minuteOf(date, block.start)
        const end = minuteOf(date, block.end)
        if (end <= 0 || start >= DAY) return
        // One subject at a time: a block the subject switched in shows each subject's stretch.
        const pieces = studySessionSubjectSpans(session, [block])
        const ids = [...new Set(pieces.flatMap((piece) => piece.subjectId ? [piece.subjectId] : []))]
        const codes = ids.map((id) => VCE_SUBJECTS.find((item) => item.id === studySubjectId(id))?.shortCode ?? subjectNameFor(id).slice(0, 3))
        out.push({
          key: `session-${session.id}-${index}`, start, end, session, interval: index,
          tone: block.live ? "live" : session.completed || session.started_at !== null ? "done" : "todo",
          title: session.title, subject: ids.map(subjectNameFor).join(" · ") || undefined,
          short: codes.join("→") || session.title.slice(0, 3), color: subjectColor(ids[0] ?? null),
          bands: pieces.length > 1 ? pieces.map((piece) => ({ start: minuteOf(date, piece.start), end: minuteOf(date, piece.end), color: subjectColor(piece.subjectId) })) : undefined,
        })
      })
    }
    return out.map((block) => ({ ...block, start: Math.max(0, block.start), end: Math.min(DAY, block.end) }))
  }, [classes, events, sessions, date, nowMs])

  const context = blocks.filter((block) => block.tone === "class" || block.tone === "event")
  const study = blocks.filter((block) => block.tone !== "class" && block.tone !== "event")
  const contextRows = pack(context.filter((block) => block.end > 0))
  const studyRows = pack(study)
  const studied = Math.round(sessions.reduce((sum, session) => {
    const projected = sessionItem(session, date, nowMs)
    return sum + (projected?.item.kind === "session" && projected.item.done ? projected.item.minutes : 0)
  }, 0))
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
  const track = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = lane.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    const surface = track.current!
    // Ctrl/⌘ + wheel (and trackpad pinch) zooms about the pointer; shift or sideways scroll pans.
    const onWheel = (event: WheelEvent) => {
      const window = winRef.current
      const rect = el.getBoundingClientRect()
      const size = window.end - window.start
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? rect.width : 1
      let next: Range | undefined
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        next = zoomWindow(window, Math.min(2, Math.max(0.5, Math.exp(event.deltaY * unit * 0.01))), window.start + Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * size)
      } else if ((event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) && size < DAY) {
        const delta = (event.deltaX || event.deltaY) * unit / rect.width * size
        next = clampWindow({ start: window.start + delta, end: window.end + delta })
      }
      if (next && (next.start !== window.start || next.end !== window.end)) {
        event.preventDefault()
        winRef.current = next
        setView(next)
      }
    }
    surface.addEventListener("wheel", onWheel, { passive: false })
    return () => { observer.disconnect(); surface.removeEventListener("wheel", onWheel) }
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
  const [razor, setRazor] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selectedSessions, setSelectedSessions] = useState<string[]>([])
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
    if (busy) return
    setSelecting(false)
    setSelectedSessions([])
    const next = { start: clamp(range.start), end: clamp(Math.max(range.end, range.start + SNAP)) }
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
    if (event.button !== 0 || busy || razor || selecting) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const minute = minuteAt(event.clientX)
    setSelected(null)
    setDrag({ anchor: minute, current: minute, moved: false })
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = minuteAt(event.clientX, !razor)
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

  /** Timers own their intervals until stopped; all other blocks can be adjusted. */
  const movable = (block: Block) => Boolean((block.event && onEditEvent) || (block.period && onEditClass) || (block.session && !timing(block.session)))
  const adjustProps = (block: Block, kind: "start" | "end" | "move") => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.stopPropagation()
      if (event.button !== 0 || adjust || busy) return
      // Keep capture on the block while its handles and labels re-render.
      event.currentTarget.closest("button")!.setPointerCapture(event.pointerId)
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
          const start = Math.max(0, Math.min(snap(minute - adjust.offset), (block.period ? LAST_MINUTE : DAY) - length))
          return { start, end: start + length }
        })()
      if (next.start !== range.start || next.end !== range.end) setAdjust({ ...adjust, range: next, moved: true })
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      event.stopPropagation()
      if (!adjust || adjust.key !== block.key || adjust.saving) return
      if (!adjust.moved) return setAdjust(null)
      // The drag ended on this element, so the click that follows must not also select it.
      event.preventDefault()
      suppressClick.current = true
      setTimeout(() => { suppressClick.current = false }, 100)
      persist(block, adjust.range, adjust.kind)
    },
    onPointerCancel: () => setAdjust(null),
  })

  async function persist(block: Block, range: Range, kind: "start" | "end" | "move" = "move") {
    setAdjust({ key: block.key, kind, offset: 0, range, moved: true, saving: true })
    // Keep the portions outside this day, and every other interval, when editing a clipped block.
    const shift = (start: string, end: string) => ({
      start: kind === "end" ? start : kind === "start" ? isoAt(date, range.start) : new Date(Date.parse(start) + (range.start - block.start) * 60_000).toISOString(),
      end: kind === "start" ? end : kind === "end" ? isoAt(date, range.end) : new Date(Date.parse(end) + (range.end - block.end) * 60_000).toISOString(),
    })
    try {
      if (block.session) {
        const intervals = sessionBlocks(block.session, nowMs).map(({ start, end }, index) => index === block.interval ? shift(start, end) : { start, end })
        await onEdit(block.session, { blocks: intervals })
      } else if (block.event) {
        const { start, end } = shift(block.event.startTime, block.event.endTime ?? new Date(Date.parse(block.event.startTime) + 60 * 60_000).toISOString())
        onEditEvent?.(block.event, { startTime: start, endTime: end })
      } else if (block.period) {
        onEditClass?.(block.period, { startTime: hhmm(range.start), endTime: hhmm(range.end) })
      }
      toast.success(`Updated to ${clock(range.start)}–${clock(range.end)}`)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not update that block.")
    } finally {
      setAdjust(null)
    }
  }

  /** Arrow keys move a focused block by 1 minute (15 with Shift); Alt resizes its end instead. */
  function nudge(event: ReactKeyboardEvent<HTMLElement>, block: Block) {
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
    if (!direction || adjust || busy || selecting || !movable(block)) return
    event.preventDefault()
    const delta = direction * (event.shiftKey ? 15 : SNAP)
    const range = event.altKey
      ? { start: block.start, end: Math.max(block.start + SNAP, Math.min(block.period ? LAST_MINUTE : DAY, block.end + delta)) }
      : { start: Math.max(0, Math.min(block.start + delta, (block.period ? LAST_MINUTE : DAY) - (block.end - block.start))), end: 0 }
    if (!event.altKey) range.end = range.start + block.end - block.start
    if (range.start === block.start && range.end === block.end) return
    reveal(range)
    persist(block, range, event.altKey ? "end" : "move")
  }

  /** Delete arms the remove confirmation for a focused session block; arrows nudge it. */
  function blockKey(event: ReactKeyboardEvent<HTMLElement>, block: Block) {
    if (busy || selecting) return
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

  /** A copy of the block's subjects for the same stretch moved by `shift` ms: its last subject and, if it switched, where. */
  function copiedSubjects(block: Block, from: string, to: string, shift = 0) {
    const pieces = studySessionSubjectSpans(block.session!, [{ start: from, end: to }])
    const switches = pieces.flatMap((piece) => piece.subjectId ? [{ at: new Date(Date.parse(piece.start) + shift).toISOString(), subjectId: piece.subjectId }] : [])
    return { subjectId: switches.at(-1)?.subjectId ?? block.session!.subject_id!, subjectSwitches: switches.length > 1 ? switches : undefined }
  }

  async function repeatTomorrow(block: Block) {
    const session = block.session
    if (!session?.subject_id) return
    const next = shiftDate(date, 1)
    try {
      const shift = Date.parse(isoAt(next, block.start)) - Date.parse(isoAt(date, block.start))
      await onPlan({ title: session.title, ...copiedSubjects(block, isoAt(date, block.start), isoAt(date, block.end), shift), start: isoAt(next, block.start), end: isoAt(next, block.end) })
      toast.success(`Planned again for ${clock(block.start)} tomorrow`)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not plan that again.")
    }
  }

  /** A block the razor can cut: one that may be edited, whose session has a subject for the new half. */
  const splittable = (block: Block) => movable(block) && Boolean(block.session?.subject_id) && sessionBlocks(block.session!, nowMs).length === 1 && block.start > 0 && block.end < DAY
  /** Where a click without a pointer cuts: the current time if it is inside the block, else the middle. */
  const splitPoint = (block: Block) => snap(isToday && now - block.start >= SNAP && block.end - now >= SNAP ? now : (block.start + block.end) / 2)

  /** Razor: the session keeps the first part and a new session takes the rest (notes stay with the first). The new part is made first so a failure cannot lose study. */
  async function split(block: Block, cut: number) {
    const session = block.session
    if (!session?.subject_id || !splittable(block) || busy) return
    if (cut - block.start < SNAP || block.end - cut < SNAP) return void toast.error(`Cut at least ${SNAP} minute from either end.`)
    const rest = { title: session.title, ...copiedSubjects(block, isoAt(date, cut), isoAt(date, block.end)), start: isoAt(date, cut), end: isoAt(date, block.end) }
    let created = false
    setBusy(true)
    try {
      if (block.tone === "done") await onLog({ subjectId: rest.subjectId, subjectSwitches: rest.subjectSwitches, title: rest.title, blocks: [{ start: rest.start, end: rest.end }] })
      else await onPlan(rest)
      created = true
      await onEdit(session, { blocks: [{ start: isoAt(date, block.start), end: isoAt(date, cut) }] })
      toast.success(`Split at ${clock(cut)}`)
      setSelected(null)
    } catch (failure) {
      toast.error(`${created ? "The second part was added, but the first could not be shortened. " : ""}${failure instanceof Error ? failure.message : "Could not split that block."}`)
    } finally {
      setBusy(false)
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
    if (busy) return
    if (suppressClick.current) { suppressClick.current = false; return }
    if (selecting) {
      const session = block.session
      if (!session || session.kind !== "focus" || timing(session)) return
      setSelectedSessions((current) => current.includes(session.id) ? current.filter((id) => id !== session.id) : [...current, session.id])
      return
    }
    setSelected((current) => current === block.key ? null : block.key)
    if (pixels(block) < 36) zoomTo(block)
    setConfirmRemove(false)
    setDraft(null)
  }

  const picked = blocks.find((block) => block.key === selected)
  // The earliest session is kept, whatever order they were picked in, matching Folio.
  const startOf = (session: CanonicalStudySession) => Math.min(...sessionBlocks(session, nowMs).map((block) => Date.parse(block.start)))
  const mergeSessions = selectedSessions.flatMap((id) => sessions.find((session) => session.id === id) ?? []).toSorted((a, b) => startOf(a) - startOf(b))
  const mergeError = mergeSessions.length !== selectedSessions.length || mergeSessions.some((session) => session.cancelled_at !== null || timing(session) || session.kind !== "focus")
    ? "A selected session changed. Select your sessions again."
    : mergeSessions.some((session) => session.subject_id !== mergeSessions[0].subject_id || session.completed !== mergeSessions[0].completed)
    ? "Select sessions with the same subject and done/planned status."
    : null
  const blockSelected = (block: Block) => selecting ? Boolean(block.session && selectedSessions.includes(block.session.id)) : selected === block.key

  function selectionMode(enabled: boolean) {
    setSelecting(enabled)
    setSelectedSessions([])
    setRazor(false)
    setSelected(null)
    setDraft(null)
    setDrag(null)
  }

  async function merge() {
    if (busy || adjust || mergeError || mergeSessions.length < 2) return
    setBusy(true)
    try {
      await onMerge(mergeSessions)
      toast.success(`Merged ${mergeSessions.length} sessions`)
      selectionMode(false)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not merge those sessions.")
    } finally {
      setBusy(false)
    }
  }
  const selection = drag ? { start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) || drag.anchor + 30 } : draft
  const bubble = adjust?.moved
    ? { at: (adjust.range.start + adjust.range.end) / 2, text: `${clock(adjust.range.start)}–${clock(adjust.range.end)} · ${duration(adjust.range.end - adjust.range.start)}` }
    : drag?.moved || editing
    ? selection && { at: (selection.start + selection.end) / 2, text: `${clock(selection.start)}–${clock(selection.end)} · ${duration(selection.end - selection.start)}` }
    : hover !== null ? { at: hover, text: clock(hover) } : null
  // Blocks without room for their time range get a readable summary below the track.
  const cramped = blocks.filter((block) => shown(block) && pixels(block) < 150)
  const crampedKeys = new Set(cramped.map((block) => block.session?.id ?? block.key))
  const crampedBySession = new Map<string, Block[]>()
  for (const block of blocks) {
    const key = block.session?.id ?? block.key
    if (!crampedKeys.has(key)) continue
    const group = crampedBySession.get(key) ?? []
    group.push(block)
    crampedBySession.set(key, group)
  }
  const crampedGroups = [...crampedBySession.values()]
  const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })
  const relative = isToday ? "Today" : date === shiftDate(localDate(new Date(nowMs)), -1) ? "Yesterday" : date === shiftDate(localDate(new Date(nowMs)), 1) ? "Tomorrow" : null

  const pastDay = date < localDate(new Date(nowMs))
  const hint = selecting ? "Click study sessions to select them, then merge" : razor ? "Click a study block where you want to cut it" : `Drag across the track to ${isToday ? "log or plan study" : pastDay ? "log study" : "plan study"}`
  const siblings = picked?.session ? blocks.filter((block) => block.session === picked.session) : []
  const swatch = (block: Block, className?: string) => (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", block.tone === "todo" ? "border border-dashed border-primary" : block.tone === "class" ? "bg-muted-foreground/40" : block.tone === "event" ? "bg-chart-5" : "bg-primary", missed(block) && "border-destructive", className)}
      style={block.tone === "todo" ? { borderColor: missed(block) ? undefined : block.color } : block.color ? { backgroundColor: block.color } : undefined}
    />
  )

  return (
    <Card className="gap-0 py-0">
      {/* Header: the day and how to change it, then what you would do with it. */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="flex min-w-0 items-end gap-2">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Timeline</p>
            <CardTitle aria-live="polite" className="mt-0.5 truncate text-lg">{relative ? `${relative} · ${dayLabel}` : dayLabel}</CardTitle>
          </div>
          <div aria-label="Change day" className="flex shrink-0 items-center" role="group">
            <Button aria-label="Previous day" onClick={() => onDateChange(shiftDate(date, -1))} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
            <Button aria-label="Next day" onClick={() => onDateChange(shiftDate(date, 1))} size="icon-sm" variant="ghost"><ChevronRight /></Button>
          </div>
          {!isToday ? <Button onClick={() => onDateChange(localDate(new Date()))} size="xs" variant="outline">Today</Button> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isToday ? (
            <>
              <Button onClick={() => { const next = Math.ceil(now / 30) * 30; open({ start: next, end: next + 60 }) }} size="sm" variant="outline"><Plus />Plan study</Button>
              <Button onClick={() => onStartFocus(undefined, "")} size="sm"><Timer />Start timer</Button>
            </>
          ) : (
            <Button onClick={() => open({ start: 16 * 60, end: 17 * 60 })} size="sm" variant="outline"><Plus />{pastDay ? "Log study" : "Add study"}</Button>
          )}
        </div>
      </div>

      {/* Totals double as the legend: each figure wears the swatch of the blocks it counts. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
        <div aria-live="polite" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-xs border border-primary/35 bg-primary/20" /><span className="font-medium text-foreground">{duration(studied)}</span>studied</span>
          {planned ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-xs border border-dashed border-primary/50 bg-primary/5" /><span className="font-medium text-foreground">{duration(planned)}</span>planned</span> : null}
          {notDone ? <span className="inline-flex items-center gap-1.5 text-destructive"><span aria-hidden className="h-2.5 w-4 rounded-xs border border-destructive/50 bg-destructive/10" /><span className="font-medium">{duration(notDone)}</span>missed</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div aria-label="Tool" className="flex items-center gap-0.5 rounded-md border p-0.5" role="group">
            <Button aria-pressed={!razor && !selecting} disabled={busy || adjust !== null} onClick={() => selectionMode(false)} size="icon-xs" title="Select (V)" variant={razor || selecting ? "ghost" : "secondary"}><MousePointer2 /><span className="sr-only">Select tool</span></Button>
            <Button aria-pressed={razor} disabled={busy || adjust !== null} onClick={() => { selectionMode(false); setRazor(true) }} size="icon-xs" title="Razor: split a study block (C)" variant={razor ? "secondary" : "ghost"}><Scissors /><span className="sr-only">Razor tool</span></Button>
            <Button aria-pressed={selecting} disabled={busy || adjust !== null} onClick={() => selectionMode(!selecting)} size="xs" title="Select sessions to merge" variant={selecting ? "secondary" : "ghost"}><CheckCheck />Merge</Button>
          </div>
          <div aria-label="Zoom" className="flex items-center gap-0.5 rounded-md border p-0.5" role="group">
            <Button aria-label="Zoom out" disabled={span >= DAY} onClick={() => zoomBy(2)} size="icon-xs" title="Zoom out (Ctrl + scroll)" variant="ghost"><Minus /></Button>
            <Button aria-label="Zoom in" disabled={span <= MIN_SPAN} onClick={() => zoomBy(0.5)} size="icon-xs" title="Zoom in (Ctrl + scroll)" variant="ghost"><Plus /></Button>
            <span aria-hidden className="mx-0.5 h-3.5 w-px bg-border" />
            <Button disabled={view === null} onClick={() => setView(null)} size="xs" title="Fit the day's study (0)" variant="ghost">Fit</Button>
            <Button disabled={span >= DAY} onClick={() => setView({ start: 0, end: DAY })} size="xs" title="Show all 24 hours" variant="ghost">24h</Button>
            {isToday ? <Button onClick={() => setView(clampWindow({ start: now - span / 2, end: now + span / 2 }))} size="xs" title="Centre on the current time" variant="ghost"><Crosshair />Now</Button> : null}
          </div>
        </div>
      </div>

      {/* The track runs edge to edge: a ruler, the day's fixed points, then the study lane,
          all on one set of hour lines so a class and the study beside it line up by eye. */}
      <div className="border-y border-border" ref={track}>
        <div className="relative select-none bg-muted/15">
          <div aria-hidden className="relative h-7 border-b border-border text-[0.6875rem] text-muted-foreground tabular-nums">
            {ticks.map((minute) => {
              const at = (minute - from) / span * 100
              // An hour label under the "now" pill or the drag readout would only be overprinted.
              const covered = (bubble ? [bubble.at] : isToday && now >= from && now <= to ? [now] : []).some((mark) => Math.abs(mark - minute) / span * width < (bubble ? 70 : 40))
              if (covered) return null
              return <span className={cn("absolute top-1.5", at < 3 ? "pl-1.5" : at > 97 ? "-translate-x-full pr-1.5" : "-translate-x-1/2")} key={minute} style={{ left: `${at}%` }}>{clock(minute)}</span>
            })}
            {isToday && now >= from && now <= to && !bubble ? (
              <span className="absolute top-1 z-10 -translate-x-1/2 rounded-full bg-destructive px-1.5 py-px font-medium text-white" style={{ left: `${Math.min(96, Math.max(4, (now - from) / span * 100))}%` }}>{clock(now)}</span>
            ) : null}
            {bubble ? (
              <span className="absolute top-1 z-10 -translate-x-1/2 rounded-full bg-foreground px-2 py-px whitespace-nowrap text-background" style={{ left: `${Math.min(88, Math.max(12, (bubble.at - from) / span * 100))}%` }}>{bubble.text}</span>
            ) : null}
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-7 bottom-0">
            {ticks.map((minute) => <span className={cn("absolute inset-y-0 w-px", minute % 60 === 0 ? "bg-border/80" : "bg-border/40")} key={minute} style={{ left: left(minute) }} />)}
            {isToday && now > from ? <span className="absolute inset-y-0 left-0 bg-muted-foreground/[0.06]" style={{ width: left(Math.min(now, to)) }} /> : null}
          </div>

          {/* Context lane: what the day already holds. */}
          {context.length ? (
            <div className="relative border-b border-dashed border-border" style={{ height: contextRows.rows * 24 + 8 }}>
              {context.filter(shown).map((live) => {
                const block = adjust?.key === live.key ? { ...live, ...adjust.range } : live
                const grab = movable(block) && !selecting && !busy && !razor
                return (
                  <Button
                    variant="ghost"
                    aria-label={`${block.title}, ${clock(block.start)} to ${clock(block.end)}`}
                    aria-pressed={blockSelected(block)}
                    className={cn("group/block absolute block h-5 min-w-0 touch-pan-y rounded-sm border-0 text-left font-normal text-[0.6875rem] leading-[1.125rem] outline-none focus-visible:ring-2 focus-visible:ring-ring", TONE[block.tone], pixels(block) >= 60 ? "px-3" : "px-0", selected === block.key && "z-10 min-w-6 ring-2 ring-foreground/60", grab && "cursor-grab active:cursor-grabbing")}
                    key={block.key}
                    onClick={() => select(block)}
                    onDoubleClick={() => zoomTo(block)}
                    onKeyDown={(event) => blockKey(event, live)}
                    style={{ ...place(block.start, block.end), top: 4 + (contextRows.row.get(live.key) ?? 0) * 24 }}
                    {...(grab ? adjustProps(live, "move") : {})}
                    title={`${block.title} · ${clock(block.start)}–${clock(block.end)}`}
                  >
                    {pixels(block) >= 60 ? <span className="block truncate">{block.title}</span> : null}
                    {grab ? (["start", "end"] as const).map((kind) => (
                      <span aria-hidden className={cn("absolute inset-y-0 flex cursor-ew-resize items-center justify-center", kind === "start" ? "left-0" : "right-0")} key={kind} style={{ width: "min(0.625rem, 34%)" }} {...adjustProps(live, kind)}>
                        <span className="h-3 w-0.5 rounded-full bg-current opacity-50 transition-opacity group-hover/block:opacity-100 group-focus-visible/block:opacity-100" />
                      </span>
                    )) : null}
                  </Button>
                )
              })}
            </div>
          ) : null}

          {/* Study lane: the drag target. */}
          <div
            aria-keyshortcuts="+ - 0 C V ArrowLeft ArrowRight PageUp PageDown" aria-label="Study timeline. Drag to select a time range."
            style={{ height: studyRows.rows * 56 + 16 }}
            className="relative cursor-crosshair touch-pan-y overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            tabIndex={0}
            onKeyDown={(event) => {
              if (busy || adjust) return
              if (event.key === "Escape") selectionMode(false)
              else if (event.key === "c" || event.key === "v") { selectionMode(false); setRazor(event.key === "c") }
              else if (event.key === "+" || event.key === "=") zoomBy(0.5)
              else if (event.key === "-") zoomBy(2)
              else if (event.key === "0") setView(null)
              else if (event.target === event.currentTarget && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                event.preventDefault()
                const delta = span * (event.key === "ArrowLeft" ? -0.2 : 0.2)
                setView(clampWindow({ start: from + delta, end: to + delta }))
              }
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
            {study.filter(shown).map((live) => {
              const block = adjust?.key === live.key ? { ...live, ...adjust.range } : live
              const room = pixels(block)
              const grab = movable(block) && !selecting && !busy
              return (
                <Button
                  variant="ghost"
                  aria-label={`${block.tone === "todo" ? missed(block) ? "Missed" : "Planned" : block.tone === "live" ? "Studying now" : "Done"}: ${block.title}${block.subject ? `, ${block.subject}` : ""}, ${clock(block.start)} to ${clock(block.end)}`}
                  aria-pressed={blockSelected(block)}
                  disabled={selecting && (block.session?.kind !== "focus" || timing(block.session))}
                  className={cn("group/block absolute flex h-12 min-w-0 flex-col items-stretch justify-center overflow-hidden rounded-md border-0 text-left font-normal text-xs leading-4 whitespace-nowrap shadow-xs transition-[filter,box-shadow] hover:brightness-105 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", TONE[block.tone], room >= 36 ? "px-3" : "px-0", missed(block) && "border-destructive/50 bg-destructive/10 text-destructive", blockSelected(block) && "z-10 min-w-6 ring-2 ring-ring ring-offset-1 ring-offset-card", razor ? splittable(block) ? "cursor-crosshair" : "cursor-not-allowed" : grab ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")}
                  key={block.key}
                  onClick={(event) => razor ? split(block, event.detail ? minuteAt(event.clientX, false) : splitPoint(block)) : select(block)}
                  onDoubleClick={() => { if (!razor && !selecting) zoomTo(block) }}
                  onKeyDown={(event) => blockKey(event, live)}
                  style={{ ...place(block.start, block.end), top: 8 + (studyRows.row.get(live.key) ?? 0) * 56, ...subjectStyle(block, missed(block)) }}
                  {...(grab && !razor ? adjustProps(live, "move") : { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation() })}
                  title={`${block.title}${block.subject ? ` · ${block.subject}` : ""} · ${clock(block.start)}–${clock(block.end)} · ${duration(block.end - block.start)} (double-click to zoom)`}
                >
                  {block.bands ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-1">{block.bands.map((band) => (
                    <span className="absolute inset-y-0" key={band.start} style={{ left: `${(band.start - block.start) / (block.end - block.start) * 100}%`, width: `${(band.end - band.start) / (block.end - block.start) * 100}%`, backgroundColor: band.color ?? "var(--primary)" }} />
                  ))}</span> : null}
                  {room >= 150 ? <span className="block truncate font-medium">{block.title}</span> : room >= 36 ? <span className="block truncate">{block.short}</span> : null}
                  {room >= 150 ? <span className="block truncate text-[0.625rem] opacity-75 tabular-nums">{block.tone === "live" ? "Studying now" : `${clock(block.start)}–${clock(block.end)} · ${duration(block.end - block.start)}`}</span> : null}
                  {grab && !razor ? (["start", "end"] as const).map((kind) => (
                    <span aria-hidden className={cn("absolute inset-y-0 flex cursor-ew-resize items-center justify-center", kind === "start" ? "left-0" : "right-0")} key={kind} style={{ width: "min(0.625rem, 34%)" }} {...adjustProps(live, kind)}>
                      <span className="h-4 w-0.5 rounded-full bg-current opacity-50 transition-opacity group-hover/block:opacity-100 group-focus-visible/block:opacity-100" />
                    </span>
                  )) : null}
                </Button>
              )
            })}
            {selection ? (
              <span
                className={cn("absolute inset-y-1 rounded-md border-2 border-primary bg-primary/15", mode === "plan" && !drag && "border-dashed", drag ? "pointer-events-none" : "cursor-grab active:cursor-grabbing")}
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
            {hover !== null && !drag && !editing ? <span aria-hidden className={cn("pointer-events-none absolute inset-y-0", razor ? "w-0.5 bg-foreground/70" : "w-px bg-foreground/30")} style={{ left: left(hover) }} /> : null}
          </div>

          {/* "Now" crosses every lane, drawn last so it sits over the blocks. */}
          {isToday && now >= from && now <= to ? (
            <span aria-hidden className="pointer-events-none absolute top-7 bottom-0 w-0.5 -translate-x-1/2 bg-destructive" style={{ left: left(now) }} />
          ) : null}
        </div>

        {/* Where this window sits in the day: click or drag to pan. */}
        {span < DAY ? (
          <div
            aria-label="Day overview. Drag to pan the timeline."
            className="relative h-8 cursor-ew-resize touch-pan-y overflow-hidden sm:h-4 border-t border-border bg-muted/40"
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); if (event.pointerType !== "touch") pan(event) }}
            onPointerMove={(event) => { if (event.buttons) pan(event) }}
            onPointerUp={(event) => { if (event.pointerType === "touch") pan(event) }}
            role="group"
          >
            {blocks.map((block) => <span aria-hidden className={cn("absolute inset-y-1 rounded-xs opacity-60", block.tone === "class" || block.tone === "event" ? "bg-muted-foreground/30" : "bg-primary/70")} key={block.key} style={{ backgroundColor: block.color, left: `${block.start / DAY * 100}%`, width: `max(2px, ${(block.end - block.start) / DAY * 100}%)` }} />)}
            {isToday ? <span aria-hidden className="absolute inset-y-0 w-px bg-destructive" style={{ left: `${now / DAY * 100}%` }} /> : null}
            <span aria-hidden className="absolute inset-y-0 border-x-2 border-primary/60 bg-primary/10" style={{ left: `${from / DAY * 100}%`, width: `${span / DAY * 100}%` }} />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 px-4 py-3 sm:px-5 sm:pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{hint}</p>
          {isToday ? (
            <div aria-label="Quick log study" className="flex flex-wrap items-center gap-1" role="group">
              <span className="mr-1 text-xs text-muted-foreground">Just studied?</span>
              {lastEnd > 0 && now - lastEnd >= 5 && now - lastEnd <= 6 * 60 ? (
                <Button onClick={() => open({ start: lastEnd, end: Math.floor(now) })} size="xs" variant="outline">Since {clock(lastEnd)}</Button>
              ) : null}
              {QUICK_LOGS.map((minutes) => <Button className="tabular-nums" key={minutes} onClick={() => quick(minutes)} size="xs" variant="secondary">{duration(minutes)}</Button>)}
            </div>
          ) : null}
        </div>

        {/* Blocks too narrow to label on the track, as one line of chips rather than a card each. */}
        {blocks.length ? (
          <ul aria-label="Short blocks" className="flex h-8 items-center gap-1.5 overflow-x-auto" tabIndex={cramped.length ? 0 : undefined}>
            {crampedGroups.map((group) => {
              const block = group[0]
              const start = Math.min(...group.map((item) => item.start))
              const end = Math.max(...group.map((item) => item.end))
              const minutes = group.reduce((sum, item) => sum + item.end - item.start, 0)
              const active = group.some(blockSelected)
              return (
                <li className="shrink-0" key={block.key}>
                  <Button
                    variant="ghost"
                    aria-pressed={active}
                    disabled={selecting && (!block.session || block.session.kind !== "focus" || timing(block.session))}
                    className={cn("h-7 max-w-full min-w-0 justify-start gap-2 rounded-md border-border bg-card px-2 text-left text-xs font-normal hover:bg-muted/60", active && "border-primary/60 bg-primary/5")}
                    onClick={() => select(block)}
                  >
                    {swatch(block)}
                    <span className="max-w-48 truncate font-medium">{block.title}</span>
                    <span className={cn("shrink-0 text-muted-foreground tabular-nums", missed(block) && "text-destructive")}>
                      {clock(start)}–{clock(end)} · {duration(minutes)}{group.length > 1 ? ` · ${group.length} intervals` : ""}{block.tone === "todo" ? missed(block) ? " · Missed" : " · Planned" : block.tone === "live" ? " · Now" : ""}
                    </span>
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : null}

        {selecting ? (
          <div aria-label="Selected sessions" className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3" role="region">
            <div aria-live="polite" className="min-w-0 flex-1">
              <p className="text-sm font-medium tabular-nums">{selectedSessions.length} session{selectedSessions.length === 1 ? "" : "s"} selected</p>
              <p className={cn("text-xs", mergeError ? "text-destructive" : "text-muted-foreground")}>{mergeError ?? "Merge whole sessions, keeping the earliest session's title and every break and note. Overlapping time counts once."}</p>
            </div>
            <Button disabled={busy} onClick={() => selectionMode(false)} size="sm" variant="ghost">Cancel</Button>
            <Button disabled={busy || adjust !== null || selectedSessions.length < 2 || Boolean(mergeError)} onClick={merge} size="sm"><Merge />{busy ? "Merging…" : "Merge"}</Button>
          </div>
        ) : null}

        {picked && !selecting ? (
          <div aria-label="Selected block" className="grid gap-2.5 rounded-lg border bg-card p-3" role="region">
            <div className="flex items-start gap-2.5">
              {swatch(picked, "mt-1.5")}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{picked.title}</p>
                <p className="truncate text-xs text-muted-foreground tabular-nums">
                  {[picked.subject, `${clock(picked.start)}–${clock(picked.end)}`, duration(picked.end - picked.start), { class: "Class", event: "Event", done: "Done", todo: missed(picked) ? "Missed" : "Planned", live: "Studying now" }[picked.tone]].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button aria-label="Close details" onClick={() => setSelected(null)} size="icon-xs" variant="ghost"><X /></Button>
            </div>
            {siblings.length > 1 ? (
              <div aria-label="Intervals" className="flex flex-wrap items-center gap-1 pl-4.5" role="group">
                {siblings.map((item, index) => (
                  <Button aria-pressed={item.key === picked.key} className="tabular-nums" key={item.key} onClick={() => setSelected(item.key)} size="xs" variant={item.key === picked.key ? "secondary" : "ghost"}>
                    {index + 1}. {clock(item.start)}–{clock(item.end)}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1 pl-4.5">
              {picked.session ? <Button onClick={() => onStartFocus(picked.session?.subject_id ?? undefined, picked.title, picked.session?.completed ? undefined : picked.session?.id)} size="xs"><Timer />{isPaused(picked.session) ? "Resume" : isRunning(picked.session) ? "Open timer" : picked.tone === "todo" ? "Start" : "Study again"}</Button> : null}
              {picked.session && continuableToday(picked.session, nowMs) ? <Button onClick={() => onStartFocus(picked.session?.subject_id ?? undefined, picked.title, picked.session?.id)} size="xs" title="Keep going in this session; its time so far is kept" variant="outline"><Play />Continue</Button> : null}
              {picked.session && !timing(picked.session) ? (
                <Button disabled={!picked.session.completed && picked.end > now} onClick={() => toggleDone(picked.session!)} size="xs" title={!picked.session.completed && picked.end > now ? "It hasn't finished yet" : undefined} variant="outline">
                  {picked.session.completed ? <><RotateCcw />Not done</> : <><Check />Mark done</>}
                </Button>
              ) : null}
              {picked.session && onOpenSession && !timing(picked.session) ? <Button onClick={() => onOpenSession(picked.session!)} size="xs" variant="outline">Edit</Button> : null}
              {picked.event && onOpenEvent ? <Button onClick={() => onOpenEvent(picked.event!)} size="xs" variant="outline">Edit</Button> : null}
              {picked.period && onOpenClass ? <Button onClick={onOpenClass} size="xs" variant="outline">Edit timetable</Button> : null}
              {picked.session && missed(picked) && movable(picked) ? <Button disabled={adjust !== null} onClick={() => restart(picked)} size="xs" variant="outline"><RotateCcw />Move to now</Button> : null}
              {splittable(picked) ? <Button disabled={busy} onClick={() => split(picked, splitPoint(picked))} size="xs" title={isToday && now > picked.start && now < picked.end ? "Split at the current time" : "Split in half"} variant="ghost"><Scissors />Split</Button> : null}
              {picked.session?.subject_id ? <Button onClick={() => repeatTomorrow(picked)} size="xs" variant="ghost"><CalendarPlus />Repeat tomorrow</Button> : null}
              <Button onClick={() => zoomTo(picked)} size="xs" variant="ghost"><ZoomIn />Zoom</Button>
              {picked.session && picked.tone !== "live" ? (
                confirmRemove
                  ? <Button className="ml-auto" onClick={() => remove(picked.session!)} size="xs" variant="destructive"><Trash2 />Remove for good?</Button>
                  : <Button aria-label="Remove" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setConfirmRemove(true)} size="xs" variant="ghost"><Trash2 />Remove</Button>
              ) : null}
            </div>
            {picked.period ? <p className="pl-4.5 text-xs text-muted-foreground">Changes apply to this period throughout the timetable cycle.</p> : null}
            {picked.session && timing(picked.session) ? <p className="pl-4.5 text-xs text-muted-foreground">Stop the timer to move or resize this session's intervals.</p> : null}
          </div>
        ) : null}

        {draft ? (
          <form className="grid gap-3 rounded-lg border bg-card p-3" onKeyDown={(event) => { if (event.key === "Escape") setDraft(null) }} onSubmit={submit}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{mode === "plan" ? "Schedule study" : "Log study"}</span>
              <Input aria-label="Start time" className="h-7 w-28 px-1.5 text-xs" onChange={(event) => { const minute = parseHhmm(event.target.value); if (Number.isFinite(minute)) setDraft({ ...draft, start: minute }) }} type="time" value={hhmm(draft.start)} />
              <span aria-hidden className="text-muted-foreground">–</span>
              <Input aria-label="End time" className="h-7 w-28 px-1.5 text-xs" onChange={(event) => { const minute = parseHhmm(event.target.value); if (Number.isFinite(minute)) setDraft({ ...draft, end: minute }) }} type="time" value={hhmm(draft.end)} />
              <span className="text-xs text-muted-foreground tabular-nums">{draft.end > draft.start ? duration(draft.end - draft.start) : ""}</span>
              <Button aria-label="Cancel" className="ml-auto" onClick={() => setDraft(null)} size="icon-xs" type="button" variant="ghost"><X /></Button>
            </div>
            {options.length > 12 ? (
              <NativeSelect size="sm" aria-label="Subject" onChange={(event) => setSubjectId(event.target.value)} value={subjectId}>
                {options.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.name}</NativeSelectOption>)}
              </NativeSelect>
            ) : (
              <div aria-label="Subject" className="flex flex-wrap gap-1" role="radiogroup">
                {options.map((option) => {
                  const color = subjectColor(option.id)
                  return (
                    <Button aria-checked={subjectId === option.id} key={option.id} onClick={() => setSubjectId(option.id)} role="radio" size="xs" type="button" variant={subjectId === option.id ? "secondary" : "outline"} className={cn(subjectId === option.id && "ring-1 ring-foreground/20")}>
                      <span aria-hidden className="size-1.5 rounded-full bg-primary" style={color ? { backgroundColor: color } : undefined} />{option.name}
                    </Button>
                  )
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div aria-label="Length" className="flex flex-wrap items-center gap-1" role="group">
                {[15, 30, 45, 60, 90].map((minutes) => (
                  <Button className="tabular-nums" key={minutes} onClick={() => setDraft({ ...draft, end: Math.min(LAST_MINUTE, draft.start + minutes) })} size="xs" type="button" variant={draft.end - draft.start === minutes ? "secondary" : "ghost"}>{duration(minutes)}</Button>
                ))}
                {clash.length ? <span className="ml-1 text-xs text-muted-foreground">Overlaps {clash.slice(0, 2).map((block) => block.title).join(", ")}{clash.length > 2 ? ` +${clash.length - 2}` : ""}</span> : null}
              </div>
              <Label className={cn("flex w-fit items-center gap-2 text-xs", draft.end > now && "text-muted-foreground")}>
                <Checkbox checked={done} disabled={draft.end > now} onCheckedChange={(checked) => setDoneOverride(checked)} />
                Done{draft.end > now ? " (it hasn't finished yet)" : ""}
              </Label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input aria-label="Study title" className="h-8 min-w-0 flex-1 basis-40" onChange={(event) => setTitle(event.target.value)} placeholder={`${options.find((option) => option.id === subjectId)?.name ?? "Study"} study`} ref={titleInput} value={title} />
              <Button disabled={busy || !(draft.end > draft.start)} type="submit">{busy ? "Saving…" : `${mode === "plan" ? "Schedule" : "Log"}${draft.end > draft.start ? ` ${duration(draft.end - draft.start)}` : ""}`}</Button>
            </div>
            {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
          </form>
        ) : null}
      </div>
    </Card>
  )

  function pan(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const center = (event.clientX - rect.left) / rect.width * DAY
    setView(clampWindow({ start: center - span / 2, end: center + span / 2 }))
  }
}
