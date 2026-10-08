import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react"
import { ChevronLeft, ChevronRight, Crosshair, Maximize2, Minus, Plus, Timer, Trash2, X, ZoomIn } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { sessionBlocks } from "../lib/day-plan"
import { localDate } from "../lib/learning-workspace"
import { studySubjectOptions } from "../lib/studySubjects"
import { VCE_SUBJECTS, type CalendarEvent, type TimetablePeriod } from "../lib/types"
import { cn } from "../lib/utils"
import type { PastStudyLog } from "../lib/pastStudy"
import type { CanonicalStudySession } from "../lib/sync/sessionContract"

const SNAP = 5
const LAST_MINUTE = 24 * 60 - 1
const QUICK_LOGS = [25, 45, 60, 90]

type Tone = "class" | "event" | "studied" | "planned" | "live"
interface Block {
  key: string; start: number; end: number; tone: Tone
  title: string; subject?: string; short: string
  session?: CanonicalStudySession
}
type Range = { start: number; end: number }

const DAY = 24 * 60
const MIN_SPAN = 30
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 180, 360]

const TONE: Record<Tone, string> = {
  class: "bg-muted-foreground/20",
  event: "bg-chart-5/70",
  studied: "bg-primary",
  live: "bg-primary animate-pulse",
  planned: "border border-dashed border-primary bg-primary/10",
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
 * solid bars, study you planned as dashed ones. Drag across the track to log (past) or plan
 * (future) a block, then drag its edges or body to adjust it. Ctrl/pinch-scroll zooms, the
 * overview strip pans, and tiny blocks stay readable through chips and the detail row.
 */
export function StudyTimeline({ date, onDateChange, sessions, classes, events, subjects, onLog, onPlan, onRemove, onStartFocus }: {
  date: string
  onDateChange: (date: string) => void
  sessions: CanonicalStudySession[]
  classes: TimetablePeriod[]
  events: CalendarEvent[]
  subjects: string[]
  onLog: (entry: PastStudyLog) => Promise<void>
  onPlan: (entry: { title: string; subjectId: string; start: string; end: string }) => Promise<void>
  /** Absent when signed out: there is no shared store to remove a session from. */
  onRemove?: (session: CanonicalStudySession) => Promise<void>
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
          tone: block.live ? "live" : block.planned ? "planned" : "studied",
          title: session.title, subject: subject?.name ?? session.subject_id ?? undefined,
          short: subject?.shortCode ?? session.title.slice(0, 3),
        })
      })
    }
    return out.map((block) => ({ ...block, start: Math.max(0, block.start), end: Math.min(DAY, block.end) }))
  }, [classes, events, sessions, date, nowMs])

  const context = blocks.filter((block) => block.tone === "class" || block.tone === "event")
  const study = blocks.filter((block) => block.tone !== "class" && block.tone !== "event")
  const studied = Math.round(study.filter((block) => block.tone !== "planned").reduce((sum, block) => sum + block.end - block.start, 0))
  const planned = Math.round(study.filter((block) => block.tone === "planned").reduce((sum, block) => sum + block.end - block.start, 0))
  const lastEnd = Math.max(-1, ...study.filter((block) => block.tone === "studied" && block.end <= now).map((block) => block.end))

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
    .filter((session) => session.state !== "planned" && options.some((option) => option.id === session.subject_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.subject_id ?? options[0]?.id ?? "", [sessions, options])

  const [draft, setDraft] = useState<Range | null>(null)
  const [drag, setDrag] = useState<{ anchor: number; current: number; moved: boolean } | null>(null)
  const [editing, setEditing] = useState<{ kind: "start" | "end" | "move"; offset: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [subjectId, setSubjectId] = useState("")
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const titleInput = useRef<HTMLInputElement>(null)

  function reveal(range: Range) {
    if (range.start >= from && range.end <= to) return
    const size = Math.max(span, (range.end - range.start) * 1.5)
    const center = (range.start + range.end) / 2
    setView(clampWindow({ start: center - size / 2, end: center + size / 2 }))
  }

  function open(range: Range) {
    // A block that runs past "now" can only be logged up to now.
    const fixed = range.start < now && range.end > now ? { start: range.start, end: Math.floor(now) } : range
    const next = { start: clamp(fixed.start), end: clamp(Math.max(fixed.end, fixed.start + 5)) }
    setDraft(next)
    reveal(next)
    setSelected(null)
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

  function minuteAt(clientX: number) {
    const rect = lane.current!.getBoundingClientRect()
    return clamp(snap(from + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * span))
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
      setEditing({ kind, offset: minuteAt(event.clientX) - draft.start })
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (!editing || !draft) return
      event.stopPropagation()
      const minute = minuteAt(event.clientX)
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

  const mode = draft ? (draft.end <= now ? "log" : draft.start >= now ? "plan" : "invalid") : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft || busy) return
    const subject = options.find((option) => option.id === subjectId)
    if (!subject) return setError("Choose a subject.")
    if (!(draft.end > draft.start)) return setError("End must be after start.")
    if (mode === "invalid") return setError("Logged study must have finished. Move the end back to now, or the start after now to plan it.")
    const entry = { title: title.trim() || `${subject.name} study`, subjectId: subject.id, start: isoAt(date, draft.start), end: isoAt(date, draft.end) }
    setBusy(true)
    try {
      if (mode === "log") await onLog({ subjectId: entry.subjectId, title: entry.title, blocks: [{ start: entry.start, end: entry.end }] })
      else await onPlan(entry)
      toast.success(`${mode === "log" ? "Logged" : "Planned"} ${duration(draft.end - draft.start)} of ${subject.name}`)
      setDraft(null)
      setTitle("")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save. Try again.")
    } finally {
      setBusy(false)
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
    setSelected((current) => current === block.key ? null : block.key)
    setConfirmRemove(false)
    setDraft(null)
  }

  const picked = blocks.find((block) => block.key === selected)
  const selection = drag ? { start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) || drag.anchor + 30 } : draft
  const bubble = drag?.moved || editing
    ? selection && { at: (selection.start + selection.end) / 2, text: `${clock(selection.start)}–${clock(selection.end)} · ${duration(selection.end - selection.start)}` }
    : hover !== null ? { at: hover, text: clock(hover) } : null
  // Blocks too narrow to carry any text still get a readable chip below the track.
  const cramped = study.filter((block) => shown(block) && pixels(block) < 60)
  const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })
  const relative = isToday ? "Today" : date === shiftDate(localDate(new Date(nowMs)), -1) ? "Yesterday" : date === shiftDate(localDate(new Date(nowMs)), 1) ? "Tomorrow" : null

  return (
    <Card size="sm">
      <CardHeader className="gap-1 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button aria-label="Previous day" onClick={() => onDateChange(shiftDate(date, -1))} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
            <CardTitle className="min-w-0 truncate" aria-live="polite">{relative ? `${relative} · ${dayLabel}` : dayLabel}</CardTitle>
            <Button aria-label="Next day" onClick={() => onDateChange(shiftDate(date, 1))} size="icon-sm" variant="ghost"><ChevronRight /></Button>
            {!isToday ? <Button onClick={() => onDateChange(localDate(new Date()))} size="xs" variant="outline">Today</Button> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {isToday ? (
              <>
                <span className="mr-1 text-xs text-muted-foreground">Just studied</span>
                {lastEnd > 0 && now - lastEnd >= 5 && now - lastEnd <= 6 * 60 ? (
                  <Button onClick={() => open({ start: lastEnd, end: Math.floor(now) })} size="xs" variant="outline">Since {clock(lastEnd)}</Button>
                ) : null}
                {QUICK_LOGS.map((minutes) => <Button key={minutes} onClick={() => quick(minutes)} size="xs" variant="outline">{duration(minutes)}</Button>)}
                <Button onClick={() => onStartFocus(undefined, "")} size="xs" variant="ghost"><Timer />Start timer</Button>
              </>
            ) : (
              <Button onClick={() => open({ start: 16 * 60, end: 17 * 60 })} size="xs" variant="outline">
                <Plus />{date < localDate(new Date(nowMs)) ? "Log study" : "Plan study"}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardDescription>
            {studied || planned ? [studied ? `${duration(studied)} studied` : null, planned ? `${duration(planned)} planned` : null].filter(Boolean).join(" · ") : "No study yet"}
            {" · "}Drag the track to {isToday ? "log or plan" : date < localDate(new Date(nowMs)) ? "log" : "plan"}
          </CardDescription>
          <div className="flex items-center gap-0.5" role="group" aria-label="Zoom">
            <Button aria-label="Zoom out" disabled={span >= DAY} onClick={() => zoomBy(2)} size="icon-xs" title="Zoom out (Ctrl + scroll)" variant="ghost"><Minus /></Button>
            <Button aria-label="Zoom in" disabled={span <= MIN_SPAN} onClick={() => zoomBy(0.5)} size="icon-xs" title="Zoom in (Ctrl + scroll)" variant="ghost"><Plus /></Button>
            <Button disabled={view === null} onClick={() => setView(null)} size="xs" title="Fit the day's study" variant="ghost"><ZoomIn />Fit</Button>
            <Button disabled={span >= DAY} onClick={() => setView({ start: 0, end: DAY })} size="xs" title="Show all 24 hours" variant="ghost"><Maximize2 />24h</Button>
            {isToday ? <Button onClick={() => setView(clampWindow({ start: now - span / 2, end: now + span / 2 }))} size="xs" title="Centre on the current time" variant="ghost"><Crosshair />Now</Button> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="relative select-none">
          {/* Context lane: what the day already holds. */}
          {context.some(shown) ? <div className="relative mb-1 h-4">
            {context.filter(shown).map((block) => (
              <button
                aria-label={`${block.title}, ${clock(block.start)} to ${clock(block.end)}`}
                aria-pressed={selected === block.key}
                className={cn("absolute inset-y-0 overflow-hidden rounded-sm px-1 text-left text-[0.625rem] leading-4 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring", TONE[block.tone], selected === block.key && "ring-2 ring-foreground/60")}
                key={block.key}
                onClick={() => select(block)}
                style={place(block.start, block.end)}
                title={`${block.title} · ${clock(block.start)}–${clock(block.end)}`}
                type="button"
              >
                {pixels(block) >= 60 ? block.title : null}
              </button>
            ))}
          </div> : null}
          {/* Study lane: the drag target. */}
          <div
            aria-label="Study timeline. Drag to select a time range."
            className="relative h-11 cursor-crosshair touch-none overflow-hidden rounded-md border bg-muted/30"
            onPointerCancel={() => setDrag(null)}
            onPointerDown={pointerDown}
            onPointerLeave={() => setHover(null)}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            ref={lane}
            role="group"
          >
            {ticks.map((minute) => <span aria-hidden className="absolute inset-y-0 w-px bg-border/60" key={minute} style={{ left: left(minute) }} />)}
            {study.filter(shown).map((block) => {
              const room = pixels(block)
              return (
                <button
                  aria-label={`${block.tone === "planned" ? "Planned" : "Studied"}: ${block.title}${block.subject ? `, ${block.subject}` : ""}, ${clock(block.start)} to ${clock(block.end)}`}
                  aria-pressed={selected === block.key}
                  className={cn("absolute inset-y-1.5 flex min-w-0 cursor-pointer flex-col justify-center overflow-hidden rounded-sm px-1 text-left text-[0.625rem] leading-3 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring", TONE[block.tone], block.tone === "planned" ? "text-primary" : "text-primary-foreground", selected === block.key && "ring-2 ring-foreground")}
                  key={block.key}
                  onClick={() => select(block)}
                  onDoubleClick={() => zoomTo(block)}
                  onPointerDown={(event) => event.stopPropagation()}
                  style={place(block.start, block.end)}
                  title={`${block.title}${block.subject ? ` · ${block.subject}` : ""} · ${clock(block.start)}–${clock(block.end)} (double-click to zoom)`}
                  type="button"
                >
                  {room >= 60 ? <span className="block truncate font-medium">{block.title}</span> : room >= 26 ? <span className="block truncate">{block.short}</span> : null}
                  {room >= 110 ? <span className="block truncate opacity-80">{clock(block.start)}–{clock(block.end)}</span> : null}
                </button>
              )
            })}
            {selection ? (
              <span
                className={cn("absolute inset-y-0.5 rounded-sm border-2 border-primary bg-primary/15", mode === "plan" && !drag && "border-dashed", drag ? "pointer-events-none" : "cursor-grab active:cursor-grabbing")}
                style={{ left: left(selection.start), width: `${(Math.min(to, selection.end) - Math.max(from, selection.start)) / span * 100}%` }}
                {...(drag ? {} : editProps("move"))}
              >
                {drag ? null : (["start", "end"] as const).map((kind) => (
                  <span aria-hidden className={cn("absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center", kind === "start" ? "-left-2" : "-right-2")} key={kind} {...editProps(kind)}>
                    <span className="h-5 w-1 rounded-full bg-primary" />
                  </span>
                ))}
              </span>
            ) : null}
            {hover !== null && !drag && !editing ? <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30" style={{ left: left(hover) }} /> : null}
            {isToday && now >= from && now <= to ? (
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-destructive" style={{ left: left(now) }} />
            ) : null}
          </div>
          <div aria-hidden className="relative mt-1 h-4 text-[0.625rem] text-muted-foreground tabular-nums">
            {ticks.map((minute) => {
              const at = (minute - from) / span * 100
              return <span className={cn("absolute", at < 3 ? "" : at > 97 ? "-translate-x-full" : "-translate-x-1/2")} key={minute} style={{ left: `${at}%` }}>{clock(minute)}</span>
            })}
            {bubble ? (
              <span className="absolute z-10 -translate-x-1/2 rounded bg-foreground px-1 whitespace-nowrap text-background" style={{ left: `${Math.min(88, Math.max(12, (bubble.at - from) / span * 100))}%` }}>{bubble.text}</span>
            ) : null}
          </div>
          {/* Where this window sits in the day: click or drag to pan. */}
          {span < DAY ? (
            <div
              aria-label="Day overview. Drag to pan the timeline."
              className="relative mt-1 h-3 cursor-ew-resize touch-none overflow-hidden rounded-sm bg-muted"
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pan(event) }}
              onPointerMove={(event) => { if (event.buttons) pan(event) }}
              role="group"
            >
              {blocks.map((block) => <span aria-hidden className={cn("absolute inset-y-0.5 rounded-[1px]", block.tone === "class" || block.tone === "event" ? "bg-muted-foreground/30" : "bg-primary/70")} key={block.key} style={{ left: `${block.start / DAY * 100}%`, width: `max(2px, ${(block.end - block.start) / DAY * 100}%)` }} />)}
              {isToday ? <span aria-hidden className="absolute inset-y-0 w-px bg-destructive" style={{ left: `${now / DAY * 100}%` }} /> : null}
              <span aria-hidden className="absolute inset-y-0 rounded-sm border border-primary bg-primary/10" style={{ left: `${from / DAY * 100}%`, width: `${span / DAY * 100}%` }} />
            </div>
          ) : null}
        </div>

        {cramped.length ? (
          <ul aria-label="Short blocks" className="flex flex-wrap gap-1">
            {cramped.map((block) => (
              <li key={block.key}>
                <button className={cn("rounded-full border px-2 py-0.5 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", selected === block.key && "border-primary bg-accent")} onClick={() => select(block)} type="button">
                  <span className="tabular-nums text-muted-foreground">{clock(block.start)}–{clock(block.end)}</span> {block.title}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {picked ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border p-2.5" role="region" aria-label="Selected block">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", picked.tone === "planned" ? "border border-dashed border-primary" : picked.tone === "class" ? "bg-muted-foreground/40" : picked.tone === "event" ? "bg-chart-5" : "bg-primary")} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{picked.title}</p>
              <p className="truncate text-xs text-muted-foreground tabular-nums">
                {[picked.subject, `${clock(picked.start)}–${clock(picked.end)}`, duration(Math.round(picked.end - picked.start)), { class: "Class", event: "Event", studied: "Studied", planned: "Planned", live: "Studying now" }[picked.tone]].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button onClick={() => zoomTo(picked)} size="xs" variant="outline"><ZoomIn />Zoom</Button>
              {picked.session ? <Button onClick={() => onStartFocus(picked.subject, picked.title)} size="xs" variant="outline"><Timer />{picked.tone === "planned" ? "Start" : "Study again"}</Button> : null}
              {picked.session && onRemove && picked.tone !== "live" ? (
                confirmRemove
                  ? <Button onClick={() => remove(picked.session!)} size="xs" variant="destructive"><Trash2 />Remove for good?</Button>
                  : <Button aria-label="Remove" onClick={() => setConfirmRemove(true)} size="xs" variant="outline"><Trash2 />Remove</Button>
              ) : null}
              <Button aria-label="Close details" onClick={() => setSelected(null)} size="icon-xs" variant="ghost"><X /></Button>
            </div>
          </div>
        ) : null}

        {draft ? (
          <form className="grid gap-2 rounded-md border p-2.5" onKeyDown={(event) => { if (event.key === "Escape") setDraft(null) }} onSubmit={submit}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{mode === "plan" ? "Plan" : "Log"}</span>
              <Input aria-label="Start time" className="h-7 w-28 px-1.5 text-xs" onChange={(event) => { const minute = parseHhmm(event.target.value); if (Number.isFinite(minute)) setDraft({ ...draft, start: minute }) }} type="time" value={hhmm(draft.start)} />
              <span aria-hidden className="text-muted-foreground">–</span>
              <Input aria-label="End time" className="h-7 w-28 px-1.5 text-xs" onChange={(event) => { const minute = parseHhmm(event.target.value); if (Number.isFinite(minute)) setDraft({ ...draft, end: minute }) }} type="time" value={hhmm(draft.end)} />
              <span className="text-xs text-muted-foreground tabular-nums">{draft.end > draft.start ? duration(draft.end - draft.start) : ""}</span>
              <Button aria-label="Cancel" className="ml-auto" onClick={() => setDraft(null)} size="icon-xs" type="button" variant="ghost"><X /></Button>
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
            <div className="flex gap-2">
              <Input className="h-8" onChange={(event) => setTitle(event.target.value)} placeholder={mode === "plan" ? "What will you study? (optional)" : "What did you study? (optional)"} ref={titleInput} value={title} />
              <Button disabled={busy} type="submit">{busy ? "Saving…" : `${mode === "plan" ? "Plan" : "Log"}${draft.end > draft.start ? ` ${duration(draft.end - draft.start)}` : ""}`}</Button>
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
