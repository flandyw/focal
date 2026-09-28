import { useMemo, useState } from "react"
import {
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Eye,
  FileQuestion,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { MarkdownPreview } from "@/components/markdown-preview"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MetricCard, MetricGrid, SectionHeading, WorkspacePage } from "@/components/workspace-layout"
import { useTickingNow } from "@/hooks/use-ticking-now"
import { formatTimer } from "@/lib/exam-timer"
import type { AppData } from "@/lib/exam-data"
import {
  createPracticeSession,
  deletePracticeSession,
  getPracticeSessionPlan,
  getPracticeSessionTimerState,
  pausePracticeSession,
  resumePracticeSession,
  type LearningWorkspace,
  type LearningWorkspaceUpdate,
  type PracticeQuestionRating,
  type PracticeSession,
  type PracticeSessionTimerState,
} from "@/lib/learning-workspace"
import { cn } from "@/lib/utils"

type HistoryTab = "current" | "completed" | "archived"

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

function formatFocusedTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function questionCountLabel(count: number) {
  return `${count} question${count === 1 ? "" : "s"}`
}

function SessionActionsMenu({ session, onArchive, onRestore, onDelete }: {
  session: PracticeSession
  onArchive: (id: string) => void
  onRestore: (id: string) => void
  onDelete: (session: PracticeSession) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <MoreHorizontal />
        <span className="sr-only">Actions for {session.title}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {session.archivedAt ? (
          <DropdownMenuItem onClick={() => onRestore(session.id)}>
            <RotateCcw />Restore session
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onArchive(session.id)}>
            <Archive />Archive session
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(session)}>
          <Trash2 />Delete session
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DeleteSessionDialog({ session, onOpenChange, onConfirm }: {
  session: PracticeSession | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={Boolean(session)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this practice session?</DialogTitle>
          <DialogDescription>
            {session
              ? `“${session.title}” and its ${questionCountLabel(session.questions.length)} will be permanently removed. Linked mistake review history is not changed.`
              : "This practice session will be permanently removed."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep session</Button>
          <Button variant="destructive" onClick={onConfirm}><Trash2 />Delete session</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TimerPanel({ session, timer, onToggle }: {
  session: PracticeSession
  timer: PracticeSessionTimerState
  onToggle: () => void
}) {
  const targetSeconds = session.durationMinutes * 60
  const timerLabel = session.completedAt ? "Final time" : timer.isPaused ? "Timer paused" : timer.overtimeSeconds ? "Over target" : "Elapsed time"

  return (
    <Card aria-label="Practice session timer">
      <CardHeader className="border-b">
        <CardDescription className="flex items-center gap-2">
          <Clock3 className="size-4" />
          {timerLabel}
          {timer.isRunning ? <span className="ml-auto inline-flex items-center gap-1.5 text-xs"><span className="size-1.5 rounded-full bg-foreground" />Running</span> : null}
        </CardDescription>
        <CardTitle
          role="timer"
          aria-label={`${timer.elapsedSeconds} seconds elapsed`}
          className={cn("mt-1 text-4xl font-semibold tracking-tight tabular-nums", timer.overtimeSeconds > 0 && "text-destructive")}
        >
          {formatTimer(timer.elapsedSeconds)}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{timer.overtimeSeconds ? `+${formatTimer(timer.overtimeSeconds)} overtime` : `${formatTimer(timer.remainingSeconds)} remaining`}</span>
            <span className="tabular-nums">{formatTimer(targetSeconds)} target</span>
          </div>
          <Progress value={timer.progress} aria-label="Session time progress" />
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="mt-0.5 font-medium tabular-nums">{session.durationMinutes} min</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pace</p>
            <p className="mt-0.5 font-medium tabular-nums">{Math.max(1, Math.round(session.durationMinutes / session.questions.length))} min / question</p>
          </div>
        </div>
      </CardContent>
      {!session.completedAt ? (
        <CardFooter>
          <Button className="w-full" variant="outline" onClick={onToggle}>
            {timer.isPaused ? <Play /> : <Pause />}
            {timer.isPaused ? "Resume timer" : "Pause timer"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function ProgressPanel({ session }: { session: PracticeSession }) {
  const rated = session.questions.filter((question) => question.rating !== "unattempted").length
  const correct = session.questions.filter((question) => question.rating === "correct").length
  const needsReview = session.questions.filter((question) => question.rating === "needs-review").length

  function jumpToQuestion(id: string) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    document.getElementById(`practice-question-${id}`)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>Session progress</CardDescription>
        <CardTitle>{rated} of {session.questions.length} checked</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Progress value={rated / session.questions.length * 100} aria-label="Question completion progress" />
        <div className="flex flex-wrap gap-1.5" aria-label="Jump to a question">
          {session.questions.map((question, index) => (
            <Button
              key={question.id}
              size="icon-sm"
              variant={question.rating === "correct" ? "secondary" : question.rating === "needs-review" ? "destructive" : "outline"}
              aria-label={`Question ${index + 1}: ${question.rating === "unattempted" ? "not checked" : question.rating === "correct" ? "correct" : "needs review"}`}
              onClick={() => jumpToQuestion(question.id)}
            >
              {index + 1}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border p-2">
            <p className="text-lg font-semibold tabular-nums">{correct}</p>
            <p className="text-[11px] text-muted-foreground">Correct</p>
          </div>
          <div className="rounded-lg border p-2">
            <p className="text-lg font-semibold tabular-nums">{needsReview}</p>
            <p className="text-[11px] text-muted-foreground">Review</p>
          </div>
          <div className="rounded-lg border p-2">
            <p className="text-lg font-semibold tabular-nums">{session.questions.length - rated}</p>
            <p className="text-[11px] text-muted-foreground">Remaining</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SessionHistoryCard({ session, now, onOpen, onArchive, onRestore, onDelete }: {
  session: PracticeSession
  now: Date
  onOpen: (session: PracticeSession) => void
  onArchive: (id: string) => void
  onRestore: (id: string) => void
  onDelete: (session: PracticeSession) => void
}) {
  const timer = getPracticeSessionTimerState(session, now)
  const rated = session.questions.filter((question) => question.rating !== "unattempted").length
  const correct = session.questions.filter((question) => question.rating === "correct").length
  const progress = rated / session.questions.length * 100
  const status = session.archivedAt
    ? "Archived"
    : session.completedAt
      ? `${correct}/${session.questions.length} correct`
      : timer.isPaused
        ? "Paused"
        : timer.isRunning
          ? "In progress"
          : "Ready"

  return (
    <Card className="min-w-0 justify-between">
      <CardHeader>
        <CardDescription className="truncate">{session.subject} · {dateFormatter.format(new Date(session.createdAt))}</CardDescription>
        <CardTitle className="line-clamp-2 pr-1">{session.title}</CardTitle>
        <CardAction className="flex items-center gap-1">
          <Badge variant={session.completedAt ? "secondary" : "outline"}>{status}</Badge>
          <SessionActionsMenu session={session} onArchive={onArchive} onRestore={onRestore} onDelete={onDelete} />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{rated}/{session.questions.length} checked</span>
          <span className="inline-flex items-center gap-1 tabular-nums"><Clock3 className="size-3.5" />{formatTimer(timer.elapsedSeconds)}</span>
        </div>
        <Progress value={progress} aria-label={`${rated} of ${session.questions.length} questions checked`} />
      </CardContent>
      <CardFooter>
        {session.archivedAt ? (
          <Button className="w-full" variant="outline" onClick={() => onRestore(session.id)}><RotateCcw />Restore session</Button>
        ) : (
          <Button className="w-full justify-between" variant={session.completedAt ? "outline" : "default"} onClick={() => onOpen(session)}>
            <span className="inline-flex items-center gap-1.5">{session.completedAt ? <Eye /> : timer.isPaused ? <Play /> : <RotateCcw />}{session.completedAt ? "Review session" : timer.isPaused ? "Continue session" : "Open session"}</span>
            <ChevronRight />
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

export function PracticeStudio({ data, initialSubject, onChange, onComplete, onOpenMistakes }: {
  data: AppData
  initialSubject?: string
  onChange: (learning: LearningWorkspaceUpdate) => void
  onComplete: (session: PracticeSession) => void
  onOpenMistakes: () => void
}) {
  const availableSubjects = useMemo(() => [...new Set(data.attempts.map((attempt) => attempt.subject))].toSorted(), [data.attempts])
  const sessions = data.learning.practiceSessions.filter((session) => !session.archivedAt)
  const archivedSessions = data.learning.practiceSessions.filter((session) => session.archivedAt)
  const unfinishedSessions = sessions.filter((session) => !session.completedAt)
  const completedSessions = sessions.filter((session) => session.completedAt)
  const [subject, setSubject] = useState(initialSubject ?? data.subjects.find((item) => availableSubjects.includes(item)) ?? availableSubjects[0] ?? "")
  const [area, setArea] = useState("all")
  const [questionCount, setQuestionCount] = useState(6)
  const [activeId, setActiveId] = useState(unfinishedSessions[0]?.id ?? "")
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [historyTab, setHistoryTab] = useState<HistoryTab>(unfinishedSessions.length ? "current" : "completed")
  const [deleteCandidate, setDeleteCandidate] = useState<PracticeSession | null>(null)
  const active = sessions.find((session) => session.id === activeId)
  const now = useTickingNow(active ? 1000 : 60_000)
  const attemptMap = useMemo(() => new Map(data.attempts.map((attempt) => [attempt.id, attempt])), [data.attempts])
  const availableAreas = useMemo(() => [...new Set(data.mistakes.flatMap((mistake) => {
    if (attemptMap.get(mistake.attemptId)?.subject.toLowerCase() !== subject.toLowerCase() || mistake.suspended) return []
    return [mistake.areaOfStudy ?? mistake.criterion ?? mistake.category]
  }))].toSorted(), [attemptMap, data.mistakes, subject])
  const plan = useMemo(() => getPracticeSessionPlan(subject, data, {
    limit: questionCount,
    area: area === "all" ? undefined : area,
  }), [area, data, questionCount, subject])
  const allCompletedSessions = data.learning.practiceSessions.filter((session) => session.completedAt)
  const averageRecall = allCompletedSessions.length
    ? allCompletedSessions.reduce((total, session) => total + session.questions.filter((question) => question.rating === "correct").length / session.questions.length * 100, 0) / allCompletedSessions.length
    : null
  const completedQuestionCount = allCompletedSessions.reduce((total, session) => total + session.questions.length, 0)
  const focusedSeconds = data.learning.practiceSessions.reduce((total, session) => total + getPracticeSessionTimerState(session, now).elapsedSeconds, 0)

  function commit(update: (current: LearningWorkspace) => LearningWorkspace) {
    const timestamp = new Date().toISOString()
    onChange((current) => {
      const next = update(current)
      return next === current ? current : { ...next, updatedAt: timestamp }
    })
  }

  function create() {
    if (!subject) return setError("Choose a subject.")
    const session = createPracticeSession(subject, data, { limit: questionCount, area: area === "all" ? undefined : area })
    if (!session) return setError(area === "all" ? "Log an active mistake for this subject before building a session." : "No active mistakes match that focus area.")
    commit((current) => ({ ...current, practiceSessions: [session, ...current.practiceSessions] }))
    setActiveId(session.id)
    setHistoryTab("current")
    setRevealed(new Set())
    setError(null)
  }

  function rate(questionId: string, rating: PracticeQuestionRating) {
    if (!active || active.completedAt) return
    const timestamp = new Date().toISOString()
    commit((current) => ({
      ...current,
      practiceSessions: current.practiceSessions.map((session) => session.id === active.id ? {
        ...session,
        questions: session.questions.map((question) => question.id === questionId ? { ...question, rating } : question),
        updatedAt: timestamp,
      } : session),
    }))
  }

  function toggleTimer(id: string) {
    const timestamp = new Date()
    commit((current) => ({
      ...current,
      practiceSessions: current.practiceSessions.map((session) => session.id === id
        ? session.timerPausedAt ? resumePracticeSession(session, timestamp) : pausePracticeSession(session, timestamp)
        : session),
    }))
  }

  function exitSession() {
    if (active && !active.completedAt && getPracticeSessionTimerState(active, new Date()).isRunning) toggleTimer(active.id)
    if (active?.completedAt) setHistoryTab("completed")
    setActiveId("")
    setRevealed(new Set())
  }

  function archiveSession(id: string) {
    const timestamp = new Date()
    commit((current) => ({
      ...current,
      practiceSessions: current.practiceSessions.map((session) => {
        if (session.id !== id) return session
        const stopped = session.completedAt ? session : pausePracticeSession(session, timestamp)
        return { ...stopped, archivedAt: timestamp.toISOString(), updatedAt: timestamp.toISOString() }
      }),
    }))
    if (activeId === id) setActiveId("")
    setHistoryTab("archived")
    toast("Practice session archived")
  }

  function restoreSession(id: string) {
    const timestamp = new Date().toISOString()
    const restored = data.learning.practiceSessions.find((session) => session.id === id)
    commit((current) => ({
      ...current,
      practiceSessions: current.practiceSessions.map((session) => session.id === id ? { ...session, archivedAt: undefined, updatedAt: timestamp } : session),
    }))
    setHistoryTab(restored?.completedAt ? "completed" : "current")
    toast.success("Practice session restored")
  }

  function confirmDelete() {
    if (!deleteCandidate) return
    const id = deleteCandidate.id
    onChange((current) => deletePracticeSession(current, id))
    if (activeId === id) setActiveId("")
    setDeleteCandidate(null)
    toast("Practice session deleted")
  }

  function openSession(session: PracticeSession) {
    setActiveId(session.id)
    setRevealed(new Set())
  }

  function renderHistory(items: PracticeSession[], tab: HistoryTab) {
    if (!items.length) {
      const copy = tab === "current"
        ? { title: "No unfinished sessions", description: "Build a focused set above when you are ready to practise." }
        : tab === "completed"
          ? { title: "No completed sessions yet", description: "Finish a set to build your recall history." }
          : { title: "No archived sessions", description: "Archived sessions stay here until you restore or delete them." }
      return (
        <Empty className="min-h-44 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileQuestion /></EmptyMedia>
            <EmptyTitle>{copy.title}</EmptyTitle>
            <EmptyDescription>{copy.description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.toSorted((first, second) => second.createdAt.localeCompare(first.createdAt)).map((session) => (
          <SessionHistoryCard
            key={session.id}
            session={session}
            now={now}
            onOpen={openSession}
            onArchive={archiveSession}
            onRestore={restoreSession}
            onDelete={setDeleteCandidate}
          />
        ))}
      </div>
    )
  }

  if (active) {
    const correct = active.questions.filter((question) => question.rating === "correct").length
    const needsReview = active.questions.filter((question) => question.rating === "needs-review").length
    const finished = active.questions.every((question) => question.rating !== "unattempted")
    const totalMarks = active.questions.reduce((total, question) => total + question.marks, 0)
    const timer = getPracticeSessionTimerState(active, now)

    return (
      <WorkspacePage className="gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={exitSession}>
            <ArrowLeft />{timer.isRunning && !active.completedAt ? "Pause & exit" : "All sessions"}
          </Button>
          <Badge variant="outline">{active.subject}</Badge>
          {active.completedAt ? <Badge variant="secondary"><CheckCircle2 />Completed</Badge> : timer.isPaused ? <Badge variant="outline"><Pause />Paused</Badge> : null}
        </div>

        <PageHeader
          title={active.title}
          description={`${questionCountLabel(active.questions.length)} · ${totalMarks} mark${totalMarks === 1 ? "" : "s"} · ${active.durationMinutes} minute target`}
        >
          <SessionActionsMenu session={active} onArchive={archiveSession} onRestore={restoreSession} onDelete={setDeleteCandidate} />
          {!active.completedAt ? <Button onClick={() => onComplete(active)} disabled={!finished}><Check />Complete session</Button> : null}
        </PageHeader>

        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="order-2 grid min-w-0 gap-5 xl:order-1">
            {active.completedAt ? (
              <Card>
                <CardHeader>
                  <CardDescription className="flex items-center gap-2"><CheckCircle2 className="size-4" />Completed practice</CardDescription>
                  <CardTitle className="text-xl">{correct}/{active.questions.length} recalled correctly</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Recall</p><p className="mt-1 text-2xl font-semibold tabular-nums">{Math.round(correct / active.questions.length * 100)}%</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Needs review</p><p className="mt-1 text-2xl font-semibold tabular-nums">{needsReview}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Focused time</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatTimer(timer.elapsedSeconds)}</p></div>
                </CardContent>
                <CardFooter className="flex-wrap gap-2">
                  <Button variant="outline" onClick={() => { setSubject(active.subject); setArea("all"); setActiveId("") }}><RotateCcw />Build follow-up session</Button>
                  <Button variant="ghost" onClick={() => archiveSession(active.id)}><Archive />Archive result</Button>
                </CardFooter>
              </Card>
            ) : null}

            {active.questions.map((question, index) => {
              const isRevealed = Boolean(active.completedAt) || revealed.has(question.id)
              return (
                <Card
                  id={`practice-question-${question.id}`}
                  key={question.id}
                  className={cn("scroll-mt-4", question.rating === "needs-review" && "ring-destructive/40")}
                >
                  <CardHeader className="border-b">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">{index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <CardDescription className="text-xs font-medium uppercase tracking-wide">
                          <MarkdownPreview inline>{question.skill}</MarkdownPreview>
                        </CardDescription>
                        <CardTitle className="mt-1">Question {index + 1}</CardTitle>
                      </div>
                      <Badge variant="outline">{question.marks} mark{question.marks === 1 ? "" : "s"}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-5">
                    <MarkdownPreview unframed className="text-base leading-relaxed sm:text-lg">{question.question}</MarkdownPreview>
                    {isRevealed ? (
                      <div id={`practice-answer-${question.id}`} className="rounded-lg border bg-muted/30 p-4 sm:p-5">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Worked answer</p>
                        <MarkdownPreview unframed className="text-sm sm:text-base">{question.answer}</MarkdownPreview>
                      </div>
                    ) : (
                      <Button
                        className="min-h-11 w-full"
                        variant="outline"
                        aria-expanded={false}
                        aria-controls={`practice-answer-${question.id}`}
                        onClick={() => setRevealed((current) => new Set([...current, question.id]))}
                      >
                        <Eye />Reveal answer when ready
                      </Button>
                    )}
                  </CardContent>
                  {isRevealed ? (
                    <CardFooter className="gap-2">
                      {active.completedAt ? (
                        <Badge variant={question.rating === "correct" ? "secondary" : "destructive"}>
                          {question.rating === "correct" ? <Check /> : <X />}
                          {question.rating === "correct" ? "Recalled correctly" : "Scheduled for review"}
                        </Badge>
                      ) : (
                        <div className="grid w-full gap-2 sm:grid-cols-2">
                          <Button variant={question.rating === "needs-review" ? "destructive" : "outline"} onClick={() => rate(question.id, "needs-review")}><X />Needs review</Button>
                          <Button variant={question.rating === "correct" ? "default" : "outline"} onClick={() => rate(question.id, "correct")}><Check />Recalled correctly</Button>
                        </div>
                      )}
                    </CardFooter>
                  ) : null}
                </Card>
              )
            })}

            {!active.completedAt && finished ? (
              <Card>
                <CardHeader>
                  <CardDescription>Every question is checked</CardDescription>
                  <CardTitle>Session ready to complete</CardTitle>
                  <CardDescription>{correct}/{active.questions.length} recalled correctly. Completing records Good or Again against each linked mistake card and stops the timer.</CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button className="w-full sm:w-auto" size="lg" onClick={() => onComplete(active)}><Check />Save result and update reviews</Button>
                </CardFooter>
              </Card>
            ) : null}
          </div>

          <aside className="order-1 grid gap-4 xl:sticky xl:top-4 xl:order-2">
            <TimerPanel session={active} timer={timer} onToggle={() => toggleTimer(active.id)} />
            <ProgressPanel session={active} />
          </aside>
        </div>

        <DeleteSessionDialog session={deleteCandidate} onOpenChange={(open) => { if (!open) setDeleteCandidate(null) }} onConfirm={confirmDelete} />
      </WorkspacePage>
    )
  }

  const historyGroups: Record<HistoryTab, PracticeSession[]> = {
    current: unfinishedSessions,
    completed: completedSessions,
    archived: archivedSessions,
  }

  return (
    <WorkspacePage className="gap-6">
      <PageHeader title="Practice studio" description="Turn your mistake bank into focused, timed recall sessions with evidence you can act on.">
        <Button variant="outline" onClick={onOpenMistakes}>Open mistake bank</Button>
      </PageHeader>

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.5fr)]">
        <Card className="justify-between">
          <CardHeader className="border-b">
            <CardDescription className="flex items-center gap-2"><Target className="size-4" />Targeted practice builder</CardDescription>
            <CardTitle className="text-xl">Build your next set</CardTitle>
            <CardDescription>Due cards and recurring errors are prioritised. Generated alternatives are used where available.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_auto] xl:items-end">
            <Field>
              <FieldLabel htmlFor="practice-subject">Subject</FieldLabel>
              <Select value={subject} onValueChange={(value) => { setSubject(value ?? ""); setArea("all"); setError(null) }}>
                <SelectTrigger id="practice-subject" className="w-full"><SelectValue>{subject || "Choose a subject"}</SelectValue></SelectTrigger>
                <SelectContent>{availableSubjects.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="practice-area">Focus area</FieldLabel>
              <Select value={area} onValueChange={(value) => { setArea(value ?? "all"); setError(null) }}>
                <SelectTrigger id="practice-area" className="w-full"><SelectValue>{area === "all" ? "All weak areas" : area}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All weak areas</SelectItem>
                  {availableAreas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="practice-count">Set size</FieldLabel>
              <Select value={String(questionCount)} onValueChange={(value) => setQuestionCount(Number(value ?? 6))}>
                <SelectTrigger id="practice-count" className="w-full"><SelectValue>{questionCount}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 questions</SelectItem>
                  <SelectItem value="6">6 questions</SelectItem>
                  <SelectItem value="10">10 questions</SelectItem>
                  <SelectItem value="12">12 questions</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button className="w-full" size="lg" onClick={create} disabled={!subject || plan.selectedQuestions === 0}><Plus />Build session</Button>
            <FieldError className="sm:col-span-2 xl:col-span-full">{error}</FieldError>
          </CardContent>
          <CardFooter className="gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-4 shrink-0" />The timer starts with the set and pauses when you exit. Reveal answers only after attempting each question.
          </CardFooter>
        </Card>

        <Card className="justify-between">
          <CardHeader>
            <CardDescription>Session preview</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{plan.selectedQuestions || "—"}</CardTitle>
            <CardDescription>{plan.selectedQuestions ? `${questionCountLabel(plan.selectedQuestions)} selected from ${plan.availableQuestions} available.` : "No matching active cards yet."}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3"><span className="text-muted-foreground">Target time</span><span className="font-medium tabular-nums">{plan.durationMinutes ? `${plan.durationMinutes} min` : "—"}</span></div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3"><span className="text-muted-foreground">Selected marks</span><span className="font-medium tabular-nums">{plan.totalMarks || "—"}</span></div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3"><span className="text-muted-foreground">Selection</span><span className="font-medium">Due first</span></div>
          </CardContent>
          {plan.selectedQuestions === 0 ? <CardFooter><Button className="w-full" variant="outline" onClick={onOpenMistakes}>Log a mistake first</Button></CardFooter> : null}
        </Card>
      </div>

      <MetricGrid className="grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Completed" value={allCompletedSessions.length}><span>Saved practice results</span></MetricCard>
        <MetricCard label="Average recall" value={averageRecall === null ? "—" : `${Math.round(averageRecall)}%`}><span>Across completed sessions</span></MetricCard>
        <MetricCard label="Questions reviewed" value={completedQuestionCount}><span>Completed practice questions</span></MetricCard>
        <MetricCard label="Focused time" value={formatFocusedTime(focusedSeconds)}><span>Across every practice session</span></MetricCard>
      </MetricGrid>

      <section className="grid gap-4" aria-labelledby="practice-history-title">
        <SectionHeading id="practice-history-title" title="Your sessions" description="Continue unfinished work, inspect evidence, or clean up old sets." />
        <Tabs value={historyTab} onValueChange={(value) => setHistoryTab(value as HistoryTab)}>
          <TabsList aria-label="Practice session history" className="max-w-full overflow-x-auto">
            <TabsTrigger value="current">Current ({unfinishedSessions.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedSessions.length})</TabsTrigger>
            <TabsTrigger value="archived">Archived ({archivedSessions.length})</TabsTrigger>
          </TabsList>
          {(Object.keys(historyGroups) as HistoryTab[]).map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-2">
              {renderHistory(historyGroups[tab], tab)}
            </TabsContent>
          ))}
        </Tabs>
      </section>

      <DeleteSessionDialog session={deleteCandidate} onOpenChange={(open) => { if (!open) setDeleteCandidate(null) }} onConfirm={confirmDelete} />
    </WorkspacePage>
  )
}
