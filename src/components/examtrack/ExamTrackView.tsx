import { useCallback, useEffect, useMemo, useState } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  ExternalLink,
  GraduationCap,
  Loader2,
  RefreshCw,
  Target,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  fetchExamTrackSnapshot,
  getExamTrackUrl,
  matchFocalSubjectId,
  type ExamTrackSnapshot,
} from "@/lib/examtrack"
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client"
import type { StudySessionDraft, Subject } from "@/lib/types"

type LoadState =
  | { status: "idle" | "loading"; snapshot: null; error: null }
  | { status: "ready"; snapshot: ExamTrackSnapshot; error: null }
  | { status: "error"; snapshot: null; error: string }

function formatPercentage(value: number | null) {
  return value === null ? "—" : `${Math.round(value)}%`
}

export function ExamTrackView({
  subjects,
  userId,
  loading: authLoading,
  onCreateStudySessions,
  onOpenSettings,
}: {
  subjects: Subject[]
  userId: string | undefined
  loading: boolean
  onCreateStudySessions: (sessions: StudySessionDraft[]) => Promise<void>
  onOpenSettings: () => void
}) {
  const [state, setState] = useState<LoadState>({ status: "idle", snapshot: null, error: null })
  const [planning, setPlanning] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId || !supabase) return
    setState({ status: "loading", snapshot: null, error: null })
    try {
      const snapshot = await fetchExamTrackSnapshot(supabase, userId)
      setState({ status: "ready", snapshot, error: null })
    } catch (error) {
      console.error("ExamTrack integration failed:", error)
      setState({
        status: "error",
        snapshot: null,
        error: "ExamTrack data is unavailable. Check your connection and the row-level-security policies on attempts and mistakes.",
      })
    }
  }, [userId])

  useEffect(() => {
    if (!userId || !supabase) {
      setState({ status: "idle", snapshot: null, error: null })
      return
    }
    void refresh()
    const refreshOnFocus = () => void refresh()
    window.addEventListener("focus", refreshOnFocus)
    return () => window.removeEventListener("focus", refreshOnFocus)
  }, [refresh, userId])

  const snapshot = state.status === "ready" ? state.snapshot : null
  const weakest = snapshot?.subjects[0]
  const weakestSubjectId = useMemo(
    () => weakest ? matchFocalSubjectId(weakest.subject, subjects) : undefined,
    [subjects, weakest],
  )
  const examTrackUrl = getExamTrackUrl()

  const launch = useCallback(async (hash = "") => {
    const url = getExamTrackUrl(hash)
    if (!url) {
      toast.error("Set VITE_EXAMTRACK_URL to the HTTPS production URL first.")
      return
    }
    try {
      await openUrl(url)
    } catch (error) {
      toast.error(`Could not open ExamTrack: ${String(error)}`)
    }
  }, [])

  const planReview = useCallback(async () => {
    if (!weakest) return
    setPlanning(true)
    const start = new Date(Math.ceil(Date.now() / 900_000) * 900_000)
    const end = new Date(start.getTime() + 30 * 60_000)
    try {
      await onCreateStudySessions([{
        subjectIds: weakestSubjectId ? [weakestSubjectId] : [],
        title: `ExamTrack review · ${weakest.subject}`,
        description: "Review due mistakes and complete a targeted practice set in ExamTrack.",
        topics: ["Exam review", "Mistake correction"],
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      }])
    } finally {
      setPlanning(false)
    }
  }, [onCreateStudySessions, weakest, weakestSubjectId])

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 pb-8 min-[1200px]:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <GraduationCap className="size-5 text-primary" aria-hidden />
              <h1 className="text-xl font-semibold tracking-tight">ExamTrack</h1>
              <Badge variant="secondary">Web app</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Practice performance and planning, synced through your Focal account.
            </p>
          </div>
          <div className="flex gap-2">
            {userId && (
              <Button variant="outline" size="sm" disabled={state.status === "loading"} onClick={() => void refresh()}>
                <RefreshCw className={state.status === "loading" ? "animate-spin" : ""} />
                Refresh
              </Button>
            )}
            <Button size="sm" disabled={!examTrackUrl} onClick={() => void launch()}>
              <ExternalLink />
              Open ExamTrack
            </Button>
          </div>
        </header>

        {!isSupabaseConfigured ? (
          <Card>
            <CardContent className="py-6">
              <div>
                <p className="font-medium">Supabase is not configured</p>
                <p className="mt-1 text-sm text-muted-foreground">Set the Supabase URL and publishable key in the Focal build. ExamTrack data lives in the same project.</p>
              </div>
            </CardContent>
          </Card>
        ) : authLoading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Restoring your account…
          </div>
        ) : !userId ? (
          <Card>
            <CardHeader>
              <CardTitle>Sign in to see your ExamTrack data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                ExamTrack and Focal share one account and one database. Sign in under Settings, then come back here.
              </p>
              <div className="mt-3"><Button onClick={onOpenSettings}><ExternalLink />Open account settings</Button></div>
            </CardContent>
          </Card>
        ) : state.status === "loading" || state.status === "idle" ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Loading ExamTrack data…
          </div>
        ) : state.status === "error" ? (
          <Card className="border-destructive/30">
            <CardContent className="flex gap-3 py-6">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-medium">Connection needs setup</p>
                <p className="mt-1 text-sm text-muted-foreground">{state.error}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <section aria-label="ExamTrack summary" className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardHeader><CardTitle className="text-sm text-muted-foreground">Average practice score</CardTitle></CardHeader>
                <CardContent className="text-3xl font-semibold tabular-nums">{formatPercentage(snapshot!.averagePercentage)}</CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm text-muted-foreground">Practice exams</CardTitle></CardHeader>
                <CardContent className="text-3xl font-semibold tabular-nums">{snapshot!.attempts.length}</CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm text-muted-foreground">Mistakes due</CardTitle></CardHeader>
                <CardContent className="flex items-end justify-between gap-3">
                  <span className="text-3xl font-semibold tabular-nums">{snapshot!.dueMistakes}</span>
                  <span className="text-xs text-muted-foreground">of {snapshot!.totalMistakes}</span>
                </CardContent>
              </Card>
            </section>

            {weakest && (
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                  <div className="flex items-start gap-3">
                    <Target className="mt-0.5 size-5 text-primary" aria-hidden />
                    <div>
                      <p className="font-medium">Next review: {weakest.subject}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Lowest current subject average at {formatPercentage(weakest.averagePercentage)} across {weakest.attempts} attempt{weakest.attempts === 1 ? "" : "s"}.
                      </p>
                    </div>
                  </div>
                  <Button disabled={planning} onClick={() => void planReview()}>
                    {planning ? <Loader2 className="animate-spin" /> : <BookOpenCheck />}
                    Plan 30-minute review
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Subject performance</CardTitle></CardHeader>
                <CardContent>
                  {snapshot!.subjects.length ? (
                    <div className="divide-y">
                      {snapshot!.subjects.map((subject) => (
                        <div key={subject.subject} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{subject.subject}</p>
                            <p className="text-xs text-muted-foreground">{subject.attempts} attempt{subject.attempts === 1 ? "" : "s"}</p>
                          </div>
                          <span className="text-sm font-semibold tabular-nums">{formatPercentage(subject.averagePercentage)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">Complete a practice exam in ExamTrack to see subject performance.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Recent practice exams</CardTitle></CardHeader>
                <CardContent>
                  {snapshot!.attempts.length ? (
                    <div className="divide-y">
                      {snapshot!.attempts.slice(0, 5).map((attempt) => (
                        <button
                          key={attempt.id}
                          type="button"
                          className="flex w-full items-center gap-3 py-3 text-left outline-none first:pt-0 last:pb-0 focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => void launch(`exam-${encodeURIComponent(attempt.id)}`)}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{attempt.title}</p>
                            <p className="truncate text-xs text-muted-foreground">{attempt.provider} · {new Date(attempt.completedAt).toLocaleDateString("en-AU")}</p>
                          </div>
                          <span className="text-sm font-semibold tabular-nums">{formatPercentage(attempt.percentage)}</span>
                          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                        </button>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No practice exams yet.</p>}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  )
}
