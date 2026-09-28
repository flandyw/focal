import { useCallback, useEffect, useRef, useState } from "react"
import { Pause, Play, Check, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { focalSupabase } from "@/lib/focal-supabase"
import { useFocalAccount } from "@/hooks/use-focal-account"

type Change = {
  change_id: string
  row_id: string
  operation: "put" | "delete"
  payload: Record<string, unknown> | null
  revision: number
}

type SharedSession = {
  id: string
  title: string
  subject: string
  state: "running" | "paused"
  phase?: "reading" | "writing" | "paused"
  phaseBeforePause?: "reading" | "writing"
  intervals: Record<string, unknown>[]
  payload: Record<string, unknown>
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function decodeSessions(changes: Change[]): SharedSession[] {
  const latest = new Map<string, Change>()
  for (const change of changes) {
    const previous = latest.get(change.row_id)
    if (!previous || previous.revision < change.revision) latest.set(change.row_id, change)
  }
  return [...latest.values()].flatMap((change) => {
    const payload = change.payload
    const execution = object(payload?.execution)
    if (change.operation === "delete" || !payload || !execution || execution.state !== "in-progress") return []
    const integrations = object(payload.integrations)
    const examtrack = object(integrations?.examtrack) ?? object(integrations?.folio)
    const intervals = Array.isArray(execution.intervals) ? execution.intervals.flatMap((value) => {
      const interval = object(value)
      return interval && typeof interval.start === "string" ? [interval] : []
    }) : []
    const phase: SharedSession["phase"] = examtrack?.phase === "reading" || examtrack?.phase === "writing" || examtrack?.phase === "paused"
      ? examtrack.phase : undefined
    const phaseBeforePause: SharedSession["phaseBeforePause"] = examtrack?.phaseBeforePause === "reading" || examtrack?.phaseBeforePause === "writing"
      ? examtrack.phaseBeforePause : undefined
    const state: SharedSession["state"] = phase === "paused" || (!phase && Boolean(intervals.at(-1)?.end)) ? "paused" : "running"
    const subjectIds = Array.isArray(payload.subjectIds) ? payload.subjectIds.filter((item): item is string => typeof item === "string") : []
    return [{
      id: change.row_id,
      title: typeof payload.title === "string" ? payload.title : "Study session",
      subject: typeof examtrack?.subject === "string" ? examtrack.subject : subjectIds.join(", "),
      state,
      phase,
      phaseBeforePause,
      intervals,
      payload,
    }]
  }).sort((a, b) => String(b.payload.updated_at ?? "").localeCompare(String(a.payload.updated_at ?? "")))
}

function changedPayload(session: SharedSession, action: "pause" | "resume" | "finish", now: string): Record<string, unknown> {
  const execution = { ...(object(session.payload.execution) ?? {}) }
  const intervals = session.intervals.map((interval) => ({ ...interval }))
  const last = intervals.at(-1)
  const isOpen = last && typeof last.start === "string" && typeof last.end !== "string"
  const integrations = { ...(object(session.payload.integrations) ?? {}) }
  const examtrackKey = object(integrations.examtrack) ? "examtrack" : object(integrations.folio) ? "folio" : undefined
  const examtrack = examtrackKey ? object(integrations[examtrackKey]) : undefined
  if (action === "pause") {
    if (isOpen) last.end = now
    if (examtrack) {
      integrations[examtrackKey!] = {
        ...examtrack,
        phaseBeforePause: session.phase === "paused" ? session.phaseBeforePause : session.phase ?? "writing",
        phase: "paused",
      }
    }
    execution.state = "in-progress"
  } else if (action === "resume") {
    const phase = session.phase === "paused" ? session.phaseBeforePause ?? "writing" : undefined
    if (!isOpen && phase !== "reading") intervals.push({ start: now, source: "imported" })
    if (examtrack && examtrackKey) integrations[examtrackKey] = { ...examtrack, phase: phase ?? "writing", phaseBeforePause: undefined }
    execution.state = "in-progress"
  } else {
    if (isOpen) last.end = now
    execution.state = "completed"
    execution.completedAt = now
    if (examtrack && session.phase === "paused") {
      if (examtrackKey) integrations[examtrackKey] = { ...examtrack, phase: session.phaseBeforePause ?? "writing", phaseBeforePause: undefined }
    }
  }
  execution.intervals = intervals
  return { ...session.payload, execution, integrations, updated_at: now, deleted_at: null, last_modified_device_id: "examtrack-web" }
}

export function SharedStudySessions() {
  const { user } = useFocalAccount()
  const [sessions, setSessions] = useState<SharedSession[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latestChanges = useRef(new Map<string, Change>())
  const revisionCursor = useRef(0)
  const accountId = useRef<string | null>(null)
  const refreshing = useRef(false)

  const refresh = useCallback(async () => {
    if (!user || !focalSupabase) return
    if (accountId.current !== user.id) {
      accountId.current = user.id
      revisionCursor.current = 0
      latestChanges.current.clear()
    }
    if (refreshing.current) return
    refreshing.current = true
    try {
      const startRevision = revisionCursor.current
      let offset = 0
      let highestRevision = startRevision
      let changed = false
      for (;;) {
        const { data, error: queryError } = await focalSupabase.from("sync_changes")
          .select("change_id,row_id,operation,payload,revision")
          .eq("user_id", user.id).eq("entity", "study_sessions")
          .gt("revision", startRevision).order("revision", { ascending: true }).range(offset, offset + 499)
        if (queryError) throw queryError
        if (accountId.current !== user.id) return
        const page = (data ?? []) as Change[]
        for (const change of page) {
          const previous = latestChanges.current.get(change.row_id)
          if (!previous || previous.revision < change.revision) {
            latestChanges.current.set(change.row_id, change)
            changed = true
          }
          highestRevision = Math.max(highestRevision, change.revision)
        }
        offset += page.length
        if (page.length < 500) break
      }
      if (accountId.current !== user.id) return
      revisionCursor.current = highestRevision
      if (changed || startRevision === 0) setSessions(decodeSessions([...latestChanges.current.values()]))
      setError(null)
    } finally {
      refreshing.current = false
    }
  }, [user])

  useEffect(() => {
    if (!user || !focalSupabase) {
      accountId.current = null
      revisionCursor.current = 0
      latestChanges.current.clear()
      setSessions([])
      return
    }
    let cancelled = false
    const safeRefresh = () => void refresh().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load shared sessions")
    })
    safeRefresh()
    const channel = focalSupabase.channel(`examtrack-shared-study-${user.id}`)
      // Realtime replicates tables, not views: sync_changes is a view over the log since
      // protocol v3, so the subscription listens to sync_log and the poll below stays as
      // the backstop. The payload shape is the same.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sync_log", filter: `user_id=eq.${user.id}` }, (event) => {
        if ((event.new as { entity?: string }).entity === "study_sessions") safeRefresh()
      }).subscribe()
    const poll = window.setInterval(safeRefresh, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      void focalSupabase?.removeChannel(channel)
    }
  }, [refresh, user])

  async function control(session: SharedSession, action: "pause" | "resume" | "finish" | "discard") {
    if (!user || !focalSupabase) return
    setBusyId(session.id)
    setError(null)
    try {
      const now = new Date().toISOString()
      const { error: writeError } = await focalSupabase.from("sync_changes").insert({
        user_id: user.id,
        change_id: crypto.randomUUID(),
        device_id: "examtrack-web",
        entity: "study_sessions",
        row_id: session.id,
        operation: action === "discard" ? "delete" : "put",
        payload: action === "discard" ? null : changedPayload(session, action, now),
      })
      if (writeError) throw writeError
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the shared session")
    } finally {
      setBusyId(null)
    }
  }

  if (!user) return null
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Shared study sessions</CardTitle>
        <CardDescription>Control sessions running in Folio or Focal from ExamTrack.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.length === 0 ? <p className="text-sm text-muted-foreground">No active shared sessions.</p> : sessions.map((session) => (
          <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-48 flex-1">
              <p className="font-medium">{session.title}</p>
              <p className="text-sm text-muted-foreground">
                {[session.subject, session.state === "paused" ? "Paused" : session.phase === "reading" ? "Reading" : "In progress"].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {session.state === "paused"
                ? <Button size="sm" variant="outline" disabled={busyId === session.id} onClick={() => void control(session, "resume")}><Play />Resume</Button>
                : <Button size="sm" variant="outline" disabled={busyId === session.id} onClick={() => void control(session, "pause")}><Pause />Pause</Button>}
              <Button size="sm" variant="outline" disabled={busyId === session.id} onClick={() => void control(session, "finish")}><Check />Finish</Button>
              <Button size="sm" variant="destructive" disabled={busyId === session.id} onClick={() => void control(session, "discard")}><Trash2 />Discard</Button>
            </div>
          </div>
        ))}
        {error ? <p role="status" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
