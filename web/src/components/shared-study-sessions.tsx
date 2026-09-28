import { useState } from "react"
import { Pause, Play, Check, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { CanonicalStudySession, StudySessionAction } from "../../../src/lib/sync/sessionContract"

type ControlAction = Extract<StudySessionAction, "pause" | "resume" | "complete" | "cancel">

export function SharedStudySessions({
  userId,
  sessions,
  onControl,
}: {
  userId: string | undefined
  sessions: CanonicalStudySession[]
  onControl: (session: CanonicalStudySession, action: ControlAction) => Promise<void>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const active = sessions.filter((session) => session.originating_app !== "examtrack" && (session.state === "running" || session.state === "paused"))

  async function control(session: CanonicalStudySession, action: ControlAction) {
    setBusyId(session.id)
    setMessage(null)
    try {
      await onControl(session, action)
      setMessage("Change queued on this device.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the session action locally.")
    } finally {
      setBusyId(null)
    }
  }

  if (!userId || active.length === 0) return null
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Shared study sessions</CardTitle>
        <CardDescription>Control sessions running in Focal or Folio. Actions are queued locally before they are sent.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.map((session) => (
          <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-48 flex-1">
              <p className="font-medium">{session.title}</p>
              <p className="text-sm text-muted-foreground">
                {[session.subject_id, session.state === "paused" ? "Paused" : session.phase === "reading" ? "Reading" : "In progress"].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {session.state === "paused"
                ? <Button size="sm" variant="outline" disabled={busyId === session.id} onClick={() => void control(session, "resume")}><Play />Resume</Button>
                : <Button size="sm" variant="outline" disabled={busyId === session.id} onClick={() => void control(session, "pause")}><Pause />Pause</Button>}
              <Button size="sm" variant="outline" disabled={busyId === session.id} onClick={() => void control(session, "complete")}><Check />Finish</Button>
              <Button size="sm" variant="destructive" disabled={busyId === session.id} onClick={() => void control(session, "cancel")}><Trash2 />Cancel</Button>
            </div>
          </div>
        ))}
        {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  )
}
