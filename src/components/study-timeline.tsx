import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react"
import { ChevronLeft, ChevronRight, Plus, Timer, X } from "lucide-react"
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

const SNAP = 15
const LAST_MINUTE = 24 * 60 - 1
const QUICK_LOGS = [25, 45, 60, 90]

type Tone = "class" | "event" | "studied" | "planned" | "live"
interface Block { key: string; start: number; end: number; tone: Tone; label: string }
type Range = { start: number; end: number }

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

/**
 * One day as a strip of hours: classes and events for context, study you did as solid
 * bars, study you planned as dashed ones. Drag across the empty track to log (past) or
 * plan (future) a block; tap for a 30-minute one. The composer below is the keyboard path.
 */
export function StudyTimeline({ date, onDateChange, sessions, classes, events, subjects, onLog, onPlan, onStartFocus }: {
  date: string
  onDateChange: (date: string) => void
  sessions: CanonicalStudySession[]
  classes: TimetablePeriod[]
  events: CalendarEvent[]
  subjects: string[]
  onLog: (entry: PastStudyLog) => Promise<void>
  onPlan: (entry: { title: string; subjectId: string; start: string; end: string }) => Promise<void>
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
      if (end > start) out.push({ key: `class-${period.period}-${start}`, start, end, tone: "class", label: `${period.subject || period.period} (class)` })
    }
    for (const event of events) {
      if (event.deleted_at) continue
      const start = minuteOf(date, event.startTime)
      const end = event.endTime ? minuteOf(date, event.endTime) : start + 60
      if (end > 0 && start < 24 * 60) out.push({ key: `event-${event.id}`, start, end: Math.max(end, start + 15), tone: "event", label: event.title })
    }
    for (const session of sessions) {
      sessionBlocks(session, nowMs).forEach((block, index) => {
        const start = minuteOf(date, block.start)
        const end = minuteOf(date, block.end)
        if (end <= 0 || start >= 24 * 60) return
        out.push({
          key: `session-${session.id}-${index}`, start, end,
          tone: block.live ? "live" : block.planned ? "planned" : "studied",
          label: [session.title, VCE_SUBJECTS.find((subject) => subject.id === session.subject_id)?.name ?? session.subject_id].filter(Boolean).join(" · "),
        })
      })
    }
    return out.map((block) => ({ ...block, start: Math.max(0, block.start), end: Math.min(24 * 60, block.end) }))
  }, [classes, events, sessions, date, nowMs])

  const context = blocks.filter((block) => block.tone === "class" || block.tone === "event")
  const study = blocks.filter((block) => block.tone !== "class" && block.tone !== "event")
  const studied = Math.round(study.filter((block) => block.tone !== "planned").reduce((sum, block) => sum + block.end - block.start, 0))
  const planned = Math.round(study.filter((block) => block.tone === "planned").reduce((sum, block) => sum + block.end - block.start, 0))
  const lastEnd = Math.max(-1, ...study.filter((block) => block.tone === "studied" && block.end <= now).map((block) => block.end))

  // The window hugs the day's content but always shows a usual 7am-11pm study day.
  const from = Math.max(0, Math.floor(Math.min(7 * 60, ...blocks.map((block) => block.start)) / 60) * 60)
  const to = Math.min(24 * 60, Math.ceil(Math.max(23 * 60, ...blocks.map((block) => block.end)) / 60) * 60)
  const pct = (minute: number) => `${(Math.min(to, Math.max(from, minute)) - from) / (to - from) * 100}%`
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, index) => from + index * 60)

  // The subject you studied most recently is the one you most likely studied again.
  const recentSubject = useMemo(() => [...sessions]
    .filter((session) => session.state !== "planned" && options.some((option) => option.id === session.subject_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.subject_id ?? options[0]?.id ?? "", [sessions, options])

  const [draft, setDraft] = useState<Range | null>(null)
  const [drag, setDrag] = useState<{ anchor: number; current: number; moved: boolean } | null>(null)
  const [subjectId, setSubjectId] = useState("")
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const lane = useRef<HTMLDivElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)


  function open(range: Range) {
    // A block that runs past "now" can only be logged up to now.
    const fixed = range.start < now && range.end > now ? { start: range.start, end: Math.floor(now) } : range
    setDraft({ start: clamp(fixed.start), end: clamp(Math.max(fixed.end, fixed.start + 5)) })
    setSubjectId((current) => current || recentSubject)
    setError("")
    requestAnimationFrame(() => titleInput.current?.focus())
  }

  function quick(minutes: number) {
    open({ start: Math.max(0, Math.floor(now) - minutes), end: Math.floor(now) })
  }

  function minuteAt(clientX: number) {
    const rect = lane.current!.getBoundingClientRect()
    return clamp(snap(from + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * (to - from)))
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const minute = minuteAt(event.clientX)
    setDrag({ anchor: minute, current: minute, moved: false })
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return
    const current = minuteAt(event.clientX)
    if (current !== drag.current) setDrag({ ...drag, current, moved: true })
  }

  function pointerUp() {
    if (!drag) return
    setDrag(null)
    if (drag.moved && drag.current !== drag.anchor) return open({ start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) })
    // A tap just after you finished studying means "I just did this": end it now.
    if (isToday && drag.anchor <= now && drag.anchor + 30 > now) return quick(30)
    open({ start: drag.anchor, end: drag.anchor + 30 })
  }

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

  const selection = drag ? { start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) || drag.anchor + 30 } : draft
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
        <CardDescription>
          {studied || planned ? [studied ? `${duration(studied)} studied` : null, planned ? `${duration(planned)} planned` : null].filter(Boolean).join(" · ") : "No study yet"}
          {" · "}Drag across the track to {isToday ? "log or plan" : date < localDate(new Date(nowMs)) ? "log" : "plan"} a block
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="relative select-none">
          {/* Context lane: what the day already holds. */}
          {context.length ? <div className="relative mb-1 h-3">
            {context.map((block) => (
              <span className={cn("absolute inset-y-0 rounded-sm", TONE[block.tone])} key={block.key} style={{ left: pct(block.start), width: `calc(${pct(block.end)} - ${pct(block.start)})` }} title={`${block.label} · ${clock(block.start)}–${clock(block.end)}`} />
            ))}
          </div> : null}
          {/* Study lane: the drag target. */}
          <div
            aria-label="Study timeline. Drag to select a time range."
            className="relative h-11 cursor-crosshair touch-none overflow-hidden rounded-md border bg-muted/30"
            onPointerCancel={() => setDrag(null)}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            ref={lane}
            role="group"
          >
            {hours.slice(1, -1).map((hour) => <span aria-hidden className="absolute inset-y-0 w-px bg-border/60" key={hour} style={{ left: pct(hour) }} />)}
            {study.map((block) => (
              <span
                className={cn("pointer-events-none absolute inset-y-1.5 overflow-hidden rounded-sm px-1 text-[0.625rem] leading-8 whitespace-nowrap", TONE[block.tone], block.tone === "planned" ? "text-primary" : "text-primary-foreground")}
                key={block.key}
                style={{ left: pct(block.start), width: `calc(${pct(block.end)} - ${pct(block.start)})` }}
                title={`${block.label} · ${clock(block.start)}–${clock(block.end)}`}
              >
                {block.label}
              </span>
            ))}
            {selection ? (
              <span className="pointer-events-none absolute inset-y-0.5 rounded-sm border-2 border-primary bg-primary/15" style={{ left: pct(selection.start), width: `calc(${pct(selection.end)} - ${pct(selection.start)})` }} />
            ) : null}
            {isToday && now >= from && now <= to ? (
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-destructive" style={{ left: pct(now) }} />
            ) : null}
          </div>
          <div aria-hidden className="relative mt-1 h-4 text-[0.625rem] text-muted-foreground tabular-nums">
            {hours.map((hour, index) => (
              <span className={cn("absolute -translate-x-1/2", index % 2 === 1 && "max-sm:hidden", index === 0 && "translate-x-0", index === hours.length - 1 && "-translate-x-full")} key={hour} style={{ left: pct(hour) }}>
                {clock(hour)}
              </span>
            ))}
          </div>
          <ul className="sr-only">
            {blocks.map((block) => <li key={block.key}>{block.tone === "planned" ? "Planned: " : block.tone === "class" || block.tone === "event" ? "" : "Studied: "}{block.label}, {clock(block.start)} to {clock(block.end)}</li>)}
          </ul>
        </div>

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
}
