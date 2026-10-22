import { WorkspaceSplit } from "./workspace-layout"
import { sameStudySubject } from "../lib/studySubjects"
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowRight, BookOpenCheck, FileDown, FileJson, FileUp, Merge, MoreHorizontal, NotebookPen, Pencil, Play, Plus, Search, Shuffle, SkipForward, SlidersHorizontal, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import { useMinWidth } from "../hooks/use-mobile"
import { AI_ENABLED } from "../lib/host"
import { filterMistakeLibrary, type BrowserFilter, type LibrarySort } from "../lib/mistake-library"
import { MistakePractice } from "./mistake-practice"
import { MistakePracticeHub, PracticeCelebration } from "./mistake-practice-hub"
import { getPracticeProgress, isRematch, playPracticeSound, practiceFeedback, recallStrength } from "../lib/mistake-practice"
import { MarkdownPreview } from "./markdown-preview"
import { MistakeAttachments } from "./mistake-attachments"
import { MistakeAlternativeDeck } from "./mistake-alternative-deck"
import { MistakeJsonImportDialog } from "./mistake-json-import"
import { MistakeInsights } from "./mistake-insights"
import { PageHeader } from "./page-header"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger, ComboboxValue } from "./ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Progress } from "./ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import {
  getDueMistakes,
  getMistakeSchedule,
  localDayDifference,
  previewMistakeReview,
  normalizeMistakeReviewPreferences,
  reduceMistakeReviews,
  type MistakeReviewPreferences,
  type AppData,
  type ExamAttempt,
  type Mistake,
  type MistakeReviewState,
  type ReviewRating,
  type PracticeContext,
  type QuestionConfidence,
} from "../lib/exam-data"
import { MistakeBulkEditDialog } from "./mistake-bulk-edit-dialog"
import { MistakeExportDialog } from "./mistake-export-dialog"
import { exportMistakes, type ExportFormat } from "../lib/mistake-export"
import { MistakeRoundTripDialog } from "./mistake-roundtrip-dialog"
import { isTechSplitMathsSubject, matchesMathsExamFilter, type MathsExamFilter } from "../lib/mistake-filters"
import { buildRevisionPriorities, formatReviewInterval, getMistakeProgress, getMistakeQueueCounts } from "../lib/mistake-review"
import {
  getMistakeFieldValues,
  hasEmptyMistakeFields,
  countMistakeFieldMergePlan,
  summarizeMistakeAutofills,
  type MistakeAutofill,
  type MistakeEdit,
  type MistakeFieldMergePlan,
  type MistakeMergeField,
} from "../lib/mistake-autofill"
import { formatChatGPTProgress, type ChatGPTProgress } from "../lib/mistake-ai-core"
import { findCachedVcaaExamForAttempt, type VcaaStudyResources } from "../lib/vcaa-resources"
import { useTickingNow } from "../hooks/use-ticking-now"


type PageTab = "study" | "schedule" | "alternative" | "browse" | "insights"

type MistakesPageProps = {
  workspaceSubject?: string
  onSaveReviewPreferences: (preferences: MistakeReviewPreferences) => void
  onReduceReviews: (days: number, target: number) => void
  data: AppData
  studies: VcaaStudyResources[]
  onLog: () => void
  onEdit: (mistake: Mistake) => void
  onReview: (mistake: Mistake, rating: ReviewRating, context?: PracticeContext) => void
  onToggleSuspend: (mistake: Mistake) => void
  onSetSuspended: (ids: string[], suspended: boolean) => void
  onDelete: (mistake: Mistake) => void
  onImportMistakes: (mistakes: Mistake[]) => void
  onApplyAutofills: (autofills: MistakeAutofill[]) => void
  onApplyMergePlan: (plan: MistakeFieldMergePlan) => void
  onApplyEdits: (edits: MistakeEdit[]) => void
  onSaveInsights: (insights: NonNullable<AppData["mistakeInsights"]>) => void
  onSaveAlternativeDeck: (deck: NonNullable<AppData["alternativeMistakeDeck"]>) => void
}

const RATING_OPTIONS: { rating: ReviewRating; label: string; shortcut: string; variant: "destructive" | "outline" | "secondary" | "default" }[] = [
  { rating: "again", label: "Again", shortcut: "1", variant: "destructive" },
  { rating: "hard", label: "Hard", shortcut: "2", variant: "outline" },
  { rating: "good", label: "Good", shortcut: "3", variant: "secondary" },
  { rating: "easy", label: "Easy", shortcut: "4", variant: "default" },
]

// Two columns start at the same 1024px the workspace grid does, so the reading
// pane and the list never disagree about which layout is on screen.
const WORKSPACE_MIN_WIDTH = 1024
const REVIEW_FILTER_LABELS: Record<BrowserFilter, string> = { all: "All cards", due: "Due now", new: "New", learning: "Learning", review: "Review", mature: "Mature", suspended: "Reviews paused" }

type ReviewRecord = NonNullable<Mistake["reviewHistory"]>[number]

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</p>
}

function ProseField({ label, value }: { label: string; value?: string }) {
  return (
    <section className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      {value?.trim() ? <MarkdownPreview unframed>{value}</MarkdownPreview> : <p className="text-sm text-muted-foreground">Not recorded yet.</p>}
    </section>
  )
}

function reviewLine(review: ReviewRecord) {
  return [
    new Date(review.completedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }),
    review.result,
    review.intervalDays === undefined ? null : `${review.intervalDays}d interval`,
  ].filter(Boolean).join(" · ")
}

function stateLabel(state: MistakeReviewState, mature: boolean) {
  if (mature) return "Mature"
  if (state === "new") return "New"
  if (state === "learning") return "Learning"
  if (state === "relearning") return "Relearning"
  return "Review"
}

function formatDueDate(dueAt: string) {
  return new Date(dueAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
}

function canUseReviewShortcut(target: EventTarget | null) {
  return !(target instanceof HTMLElement) || !target.closest("input, textarea, select, a, [contenteditable]:not([contenteditable='false']), [role='textbox']")
}

function ExamContext({ mistake, attempt, studies }: { preferences?: MistakeReviewPreferences; mistake: Mistake; attempt?: ExamAttempt; studies: VcaaStudyResources[] }) {
  const exam = attempt ? findCachedVcaaExamForAttempt(attempt, studies) : undefined
  return (
    <CardDescription>
      {attempt ? <>{attempt.title} · {attempt.paper}{exam ? <> · <a className="font-medium text-foreground underline underline-offset-4" href={exam.url} target="_blank" rel="noreferrer">Exam PDF</a></> : null}</> : mistake.attemptId ? "Deleted exam" : "Uncategorised"}
      {mistake.totalMarks !== undefined && mistake.marksLost !== undefined ? <> · {mistake.marksLost}/{mistake.totalMarks} marks lost</> : null}
    </CardDescription>
  )
}

function AnswerPanel({ label, value, tone }: { label: string; value?: string; tone: "problem" | "fix" }) {
  const border = tone === "problem" ? "border-l-destructive/60" : "border-l-primary"
  return (
    <section className={"min-w-0 rounded-lg border border-l-4 bg-muted/20 p-4 " + border}>
      <SectionLabel>{label}</SectionLabel>
      {value?.trim() ? <MarkdownPreview unframed>{value}</MarkdownPreview> : <p className="text-sm text-muted-foreground">Not recorded yet.</p>}
    </section>
  )
}

function StudyQueue({ allMistakes, preferences, mistakes, attempts, studies, onReview, onBrowse, onEdit, onReimport, onToggleSuspend, onSavePreferences }: { allMistakes: Mistake[]; preferences?: MistakeReviewPreferences; onSavePreferences: (preferences: MistakeReviewPreferences) => void; onEdit: (mistake: Mistake) => void; onReimport: (mistake: Mistake) => void; onToggleSuspend: (mistake: Mistake) => void; mistakes: Mistake[]; attempts: ExamAttempt[]; studies: VcaaStudyResources[]; onReview: (mistake: Mistake, rating: ReviewRating, context?: PracticeContext) => void; onBrowse: () => void }) {
  const tick = useTickingNow(30_000)
  const [latestReviewAt, setLatestReviewAt] = useState(0)
  const now = new Date(Math.max(tick.getTime(), latestReviewAt))
  const settings = normalizeMistakeReviewPreferences(preferences)
  const progress = getPracticeProgress(allMistakes, now)
  const [session, setSession] = useState<{ ids: string[]; ratings: ReviewRating[]; weekly: boolean; week: string; size: number; initialXP: number } | null>(null)
  const [feedback, setFeedback] = useState("")
  const [celebration, setCelebration] = useState(0)
  const due = getDueMistakes(mistakes, now)
  const mistakeMap = new Map(allMistakes.map((mistake) => [mistake.id, mistake]))
  const remaining = session?.ids.filter((id) => mistakeMap.has(id) && !mistakeMap.get(id)!.suspended) ?? []
  const current = remaining.length ? mistakeMap.get(remaining[0]) : undefined
  const completed = session?.ratings.length ?? 0
  const nextDue = mistakes.filter((mistake) => !mistake.suspended).map((mistake) => getMistakeSchedule(mistake).dueAt).toSorted()[0]

  function start(cards = due.slice(0, settings.practiceTarget), weekly = false) {
    if (!cards.length) return
    setSession({ ids: cards.map((mistake) => mistake.id), ratings: [], weekly, week: progress.week, size: weekly ? progress.weeklyTarget : cards.length, initialXP: progress.xp })
    setFeedback("")
  }
  function rate(rating: ReviewRating, context: PracticeContext = {}) {
    if (!current || !session) return
    const reviewContext = { ...context, ...(session.weekly ? { challengeWeek: session.week, challengeSize: session.size } : {}) }
    onReview(current, rating, reviewContext)
    setLatestReviewAt(Date.now())
    setFeedback(practiceFeedback(current, rating, context))
    if (settings.practiceSound) playPracticeSound()
    if (remaining.length === 1 || isRematch(current) && ["good", "easy"].includes(rating)) setCelebration((value) => value + 1)
    setSession((previous) => previous && ({ ...previous, ids: previous.ids.filter((id) => id !== current.id), ratings: [...previous.ratings, rating] }))
  }
  function shuffle() {
    const ids = [...remaining]
    for (let index = ids.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1))
      ;[ids[index], ids[swap]] = [ids[swap], ids[index]]
    }
    setSession((previous) => previous && ({ ...previous, ids }))
  }

  if (!session || !current) return <div className="relative mx-auto grid w-full max-w-3xl gap-5">
    <PracticeCelebration event={celebration} enabled={settings.practiceEffects!} finish={settings.practiceFinish} />
    <section className="grid gap-5 rounded-xl border bg-card p-6 sm:p-8">
      <div className="grid gap-2"><BookOpenCheck className="size-7 text-primary" /><h2 className="text-2xl font-semibold">{session ? "Session complete" : "Make the next attempt count"}</h2><p className="text-muted-foreground">{session ? `${completed} ${completed === 1 ? "mistake" : "mistakes"} reviewed · +${Math.max(0, progress.xp - session.initialXP)} XP` : "Recall your approach, compare it with the correction, then rate your recall."}</p></div>
      {feedback && <p role="status" className="text-sm text-primary">{feedback}</p>}
      {session && <dl className="grid grid-cols-4 gap-3 border-y py-4">{RATING_OPTIONS.map(({ rating, label }) => <div key={rating}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{session.ratings.filter((value) => value === rating).length}</dd></div>)}</dl>}
      <div className="flex flex-wrap gap-2"><Button onClick={() => start()} disabled={!due.length}><Play />{session ? "Another round" : `Start ${Math.min(due.length, settings.practiceTarget!)} cards`}</Button>{!session && <Button variant="outline" disabled={!due.length} onClick={() => start(due.slice(0, 1))}>Just one</Button>}<Button variant="ghost" onClick={onBrowse}>{session ? "Finish" : "Library"}</Button></div>
      {!session && <p className="text-xs text-muted-foreground">{due.length ? `${due.length} due in your library. Choose one round at a time.` : nextDue ? `Next card in ${formatReviewInterval(nextDue, now)}. Missions are available for early practice.` : "Add a mistake to start practising."}</p>}
    </section>
    <MistakePracticeHub key={preferences?.updatedAt ?? "default"} allMistakes={allMistakes} mistakes={mistakes} preferences={preferences} now={now} onSave={onSavePreferences} onStart={start} />
  </div>

  return <div className="relative mx-auto grid w-full max-w-4xl gap-5">
    <PracticeCelebration event={celebration} enabled={settings.practiceEffects!} finish={settings.practiceFinish} />
    <header className="grid gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm tabular-nums" role="status">{session.weekly ? "Weekly challenge · " : ""}{completed} reviewed · {remaining.length} remaining</p><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={shuffle} disabled={remaining.length < 2}><Shuffle />Shuffle</Button><Button size="sm" variant="ghost" disabled={remaining.length < 2} onClick={() => setSession({ ...session, ids: [...remaining.slice(1), remaining[0]] })}><SkipForward />Skip</Button><Button size="sm" variant="outline" onClick={() => setSession({ ...session, ids: [] })}>End session</Button></div></div><Progress value={completed / (completed + remaining.length) * 100} aria-label="Session progress" />{feedback && <p key={completed} role="status" className={settings.practiceEffects ? "practice-feedback text-sm text-primary" : "text-sm text-primary"}>{feedback} <span className="text-muted-foreground">+{Math.max(0, progress.xp - session.initialXP)} XP this session</span></p>}</header>
    <ReviewCard mistakes={allMistakes} preferences={preferences} key={current.id + current.updatedAt} mistake={current} attempt={attempts.find((attempt) => attempt.id === current.attemptId)} studies={studies} onRate={rate} onEdit={onEdit} onReimport={onReimport} onToggleSuspend={onToggleSuspend} />
  </div>
}

function ReviewCard({ preferences, mistakes, mistake, attempt, studies, onRate, onEdit, onReimport, onToggleSuspend }: { preferences?: MistakeReviewPreferences; mistakes: Mistake[]; mistake: Mistake; attempt?: ExamAttempt; studies: VcaaStudyResources[]; onRate: (rating: ReviewRating, context?: PracticeContext) => void; onEdit: (mistake: Mistake) => void; onReimport: (mistake: Mistake) => void; onToggleSuspend: (mistake: Mistake) => void }) {
  const [revealed, setRevealed] = useState(false)
  const [draft, setDraft] = useState("")
  const [confidence, setConfidence] = useState<QuestionConfidence>()
  const submitting = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const [reviewTime] = useState(() => new Date())
  const previews = RATING_OPTIONS.map((option) => ({ ...option, dueAt: previewMistakeReview(mistake, option.rating, reviewTime.toISOString(), preferences, mistakes).dueAt }))
  useEffect(() => { heading.current?.focus() }, [])

  function rate(rating: ReviewRating) {
    if (!revealed || submitting.current) return
    submitting.current = true
    try { onRate(rating, { confidence }) } catch (error) {
      submitting.current = false
      toast.error(error instanceof Error ? error.message : "Could not save your review. Try again.")
    }
  }
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') || !canUseReviewShortcut(event.target)) return
      if (!revealed && event.key === " " && !(event.target instanceof HTMLElement && event.target.closest("button"))) { event.preventDefault(); setRevealed(true) }
      const option = RATING_OPTIONS.find((item) => item.shortcut === event.key)
      if (revealed && option) { event.preventDefault(); rate(option.rating) }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  return (
    <article className="grid min-w-0 gap-5">
      <div className="overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
          <div className="flex flex-wrap gap-2"><Badge variant="secondary">{mistake.category}</Badge>{mistake.areaOfStudy ? <Badge variant="outline">{mistake.areaOfStudy}</Badge> : null}</div>
          <DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Review card actions" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onEdit(mistake)}><Pencil />Edit mistake</DropdownMenuItem><DropdownMenuItem onClick={() => onReimport(mistake)}><FileUp />Reimport with changes</DropdownMenuItem><DropdownMenuItem onClick={() => onToggleSuspend(mistake)}>Pause reviews</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </header>
        <div className="grid gap-5 p-5 sm:p-8">
          <div className="grid gap-2"><h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none"><MarkdownPreview inline>{mistake.question}</MarkdownPreview></h2><ExamContext mistake={mistake} attempt={attempt} studies={studies} /></div>
          {mistake.questionText?.trim() ? <MarkdownPreview unframed>{mistake.questionText}</MarkdownPreview> : null}
          <MistakeAttachments attachments={mistake.attachments} />
          <div className="grid gap-2"><p className="text-xs text-muted-foreground">Recall strength · {recallStrength(mistake)}/3 spaced recalls{isRematch(mistake) ? " · Rematch" : ""}</p><Progress value={recallStrength(mistake) / 3 * 100} aria-label="Recall strength across different days" /><fieldset disabled={revealed}><legend className="mb-2 text-sm font-medium">Before you reveal: how confident are you?</legend><div className="flex flex-wrap gap-2">{([['low', 'Guessing'], ['medium', 'Unsure'], ['high', 'Confident']] as const).map(([value, label]) => <Button key={value} size="sm" variant={confidence === value ? "secondary" : "outline"} aria-pressed={confidence === value} onClick={() => setConfidence(value)}>{label}</Button>)}</div></fieldset><p className="text-xs text-muted-foreground">Optional. Your prediction stays locked after revealing; every honest attempt earns the same XP.</p></div>
          <div className="grid gap-2"><label htmlFor="review-recall" className="text-sm font-medium">Your approach <span className="font-normal text-muted-foreground">(optional)</span></label><textarea id="review-recall" value={draft} onChange={(event) => setDraft(event.target.value)} readOnly={revealed} rows={3} placeholder="Try to recall the method before revealing the answer…" className="w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /><p className="text-xs text-muted-foreground">Scratch notes are cleared when you move to another card.</p></div>
        </div>
      </div>
      {revealed ? <div id="review-answer" className={preferences?.practiceEffects === false ? "grid gap-4" : "practice-reveal grid gap-4"}><AnswerPanel label="What went wrong" value={mistake.explanation} tone="problem" /><AnswerPanel label="Improved response or method" value={mistake.correction} tone="fix" /></div> : null}
      <footer className="sticky bottom-0 z-10 grid gap-2 rounded-xl border bg-background/95 p-3 backdrop-blur">
        {revealed ? <><p className="text-center text-xs text-muted-foreground">How well did you recall the answer?</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{previews.map((option) => <Button key={option.rating} aria-keyshortcuts={option.shortcut} variant={option.variant} className="h-auto flex-col py-3" onClick={() => rate(option.rating)}><span>{option.label} <kbd className="ml-1 text-xs opacity-60">{option.shortcut}</kbd></span><span className="text-xs font-normal">{formatReviewInterval(option.dueAt, reviewTime)}</span></Button>)}</div></> : <Button size="lg" aria-keyshortcuts="Space" aria-expanded={false} onClick={() => setRevealed(true)}>Reveal answer <kbd className="ml-2 text-xs opacity-70">Space</kbd></Button>}
      </footer>
    </article>
  )
}

type MistakeActions = {
  mistake: Mistake
  attempt?: ExamAttempt
  studies: VcaaStudyResources[]
  onEdit: (mistake: Mistake) => void
  onToggleSuspend: (mistake: Mistake) => void
  onDelete: (mistake: Mistake) => void
  onPractice: (mistake: Mistake) => void
  onReimport: (mistake: Mistake) => void
}

function MistakeDetail({ mistake, attempt, studies, onEdit, onReimport, onToggleSuspend, onDelete, onPractice }: MistakeActions) {
  const schedule = getMistakeSchedule(mistake)
  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 sm:p-6">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant="secondary">{mistake.suspended ? "Reviews paused" : stateLabel(schedule.state, schedule.resolved)}</Badge>
          <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => onEdit(mistake)}><Pencil />Edit</Button><DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`More actions for ${mistake.question}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onReimport(mistake)}><FileUp />Reimport with changes</DropdownMenuItem><DropdownMenuItem onClick={() => onToggleSuspend(mistake)}>{mistake.suspended ? "Resume reviews" : "Pause reviews"}</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => onDelete(mistake)}>Delete mistake</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
        </div>
        <h2 className="text-xl leading-snug font-semibold"><MarkdownPreview inline>{mistake.question}</MarkdownPreview></h2>
        <ExamContext mistake={mistake} attempt={attempt} studies={studies} />
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{mistake.category}</Badge>{mistake.areaOfStudy ? <Badge variant="outline">{mistake.areaOfStudy}</Badge> : null}</div>
      </header>
      {mistake.questionText?.trim() ? <ProseField label="Question" value={mistake.questionText} /> : null}
      <MistakeAttachments attachments={mistake.attachments} />
      <div className="grid gap-4 border-t pt-5"><AnswerPanel label="What went wrong" value={mistake.explanation} tone="problem" /><AnswerPanel label="Improved response or method" value={mistake.correction} tone="fix" /></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><p className="text-xs text-muted-foreground">{mistake.suspended ? "Resume reviews to add this card to your queue." : `Next review · ${formatDueDate(schedule.dueAt)}`}</p><Button size="sm" onClick={() => onPractice(mistake)}><Play />Practise this mistake</Button></div>
      {mistake.reviewHistory?.length ? <details className="border-t pt-4"><summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Review history ({mistake.reviewHistory.length})</summary><ul className="mt-3 grid max-h-60 gap-2 overflow-y-auto text-xs text-muted-foreground">{mistake.reviewHistory.toSorted((first, second) => Date.parse(second.completedAt) - Date.parse(first.completedAt)).map((review) => <li key={review.id}>{reviewLine(review)}</li>)}</ul></details> : null}
    </article>
  )
}

function BrowseRow({ mistake, active, selected, now, onOpen, onSelect, onReimport }: {
  mistake: Mistake
  active: boolean
  selected: boolean
  now: Date
  onOpen: () => void
  onSelect: () => void
  onReimport: () => void
}) {
  const schedule = getMistakeSchedule(mistake)
  const isDue = !mistake.suspended && new Date(schedule.dueAt).getTime() <= now.getTime()
  return (
    <li className={"group grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 p-4 " + (active ? "bg-accent" : "hover:bg-muted/50")}>
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label={"Select " + mistake.question} className="mt-1 size-4 accent-primary" />
      <button type="button" onClick={onOpen} aria-current={active ? "true" : undefined} className="grid min-w-0 gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="line-clamp-2 break-words text-sm font-semibold"><MarkdownPreview inline>{mistake.question}</MarkdownPreview></span>
        <span className="text-xs text-muted-foreground">{[mistake.category, mistake.areaOfStudy].filter(Boolean).join(" · ")}</span>
        <span className={"text-xs tabular-nums " + (isDue ? "font-medium text-primary" : "text-muted-foreground")}>{mistake.suspended ? "Reviews paused" : isDue ? "Due now" : `Due ${formatDueDate(schedule.dueAt)}`}{mistake.marksLost !== undefined ? ` · ${mistake.marksLost} marks lost` : ""}</span>
      </button>
      <Button size="icon-sm" variant="ghost" onClick={onReimport} aria-label={`Reimport with changes for ${mistake.question}`} title="Reimport with changes"><FileUp /></Button>
    </li>
  )
}


const MERGE_FIELD_LABELS: Record<MistakeMergeField, string> = {
  areaOfStudy: "Topic / Area of Study",
}

function MistakeFieldMergeDialog({
  mistakes,
  onOpenChange,
  onApply,
}: {
  mistakes: Mistake[]
  onOpenChange: (open: boolean) => void
  onApply: (plan: MistakeFieldMergePlan) => void
}) {
  const [field, setField] = useState<MistakeMergeField>("areaOfStudy")
  const [analysing, setAnalysing] = useState(false)
  const [progress, setProgress] = useState<ChatGPTProgress | null>(null)
  const [plan, setPlan] = useState<MistakeFieldMergePlan | null>(null)
  const values = useMemo(() => getMistakeFieldValues(mistakes, field), [field, mistakes])
  const counts = useMemo(() => new Map(values.map(({ value, count }) => [value, count])), [values])
  const affectedCount = plan ? countMistakeFieldMergePlan(mistakes, plan) : 0

  function changeField(next: MistakeMergeField) {
    setField(next)
    setPlan(null)
    setProgress(null)
  }

  async function analyse() {
    setAnalysing(true)
    setPlan(null)
    setProgress(null)
    try {
      const { generateMistakeFieldMergePlan } = await import("../lib/mistake-ai")
      setPlan(await generateMistakeFieldMergePlan(field, values, setProgress))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not analyse these labels.")
    } finally {
      setAnalysing(false)
    }
  }

  function apply() {
    if (!plan?.merges.length || !affectedCount) return
    onApply(plan)
    toast.success(`Merged ${affectedCount} ${affectedCount === 1 ? "mistake" : "mistakes"} using the reviewed AI plan`)
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge fields with ChatGPT</DialogTitle>
          <DialogDescription>
            ChatGPT finds duplicate or overlapping labels and proposes a consolidation plan. Review the plan before applying it.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="mistake-merge-field">Field to analyse</FieldLabel>
            <Select disabled={analysing} value={field} onValueChange={(value) => changeField((value ?? "areaOfStudy") as MistakeMergeField)}>
              <SelectTrigger id="mistake-merge-field" className="w-full">
                <SelectValue>{MERGE_FIELD_LABELS[field]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="areaOfStudy">Topic / Area of Study</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>{values.length} distinct label{values.length === 1 ? "" : "s"} available for analysis.</FieldDescription>
          </Field>
          {analysing && progress ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground tabular-nums">{formatChatGPTProgress(progress)}</p> : null}
          {plan ? (
            <div className="grid gap-2" aria-live="polite">
              <p className="text-sm font-medium">Suggested merge plan</p>
              {plan.merges.length ? (
                <div className="max-h-72 overflow-y-auto rounded-lg border">
                  {plan.merges.map(({ source, target }) => (
                    <div key={source} className="grid gap-1 border-b px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-3">
                      <span className="min-w-0 break-words">{source} <span className="text-muted-foreground">({counts.get(source) ?? 0})</span></span>
                      <span className="text-muted-foreground" aria-hidden="true">→</span>
                      <span className="min-w-0 break-words font-medium">{target}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">ChatGPT found no duplicate or overlapping labels that should be merged.</p>}
              {plan.merges.length ? <FieldDescription>{affectedCount} mistake{affectedCount === 1 ? "" : "s"} will change. All other fields remain unchanged.</FieldDescription> : null}
            </div>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {plan ? (
            <>
              <Button type="button" variant="outline" onClick={() => void analyse()} disabled={analysing || values.length < 2}><Sparkles />Analyse again</Button>
              {plan.merges.length ? <Button type="button" onClick={apply} disabled={!affectedCount}><Merge />Merge {affectedCount} mistake{affectedCount === 1 ? "" : "s"}</Button> : null}
            </>
          ) : <Button type="button" onClick={() => void analyse()} disabled={analysing || values.length < 2}><Sparkles />{analysing ? "Analysing…" : "Generate merge plan"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MistakesPage({ workspaceSubject, onSaveReviewPreferences, onReduceReviews, data, studies, onLog, onEdit, onReview, onToggleSuspend, onSetSuspended, onDelete, onImportMistakes, onApplyAutofills, onApplyMergePlan, onApplyEdits, onSaveInsights, onSaveAlternativeDeck }: MistakesPageProps) {
  const now = useTickingNow(30_000)
  const [subject, setSubject] = useState(workspaceSubject ?? "all")
  const [mathsExamFilter, setMathsExamFilter] = useState<MathsExamFilter>("all")
  const [tab, setTab] = useState<PageTab>("browse")
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [browserFilter, setBrowserFilter] = useState<BrowserFilter>("all")
  const [category, setCategory] = useState("all")
  const [topic, setTopic] = useState("all")
  const [sort, setSort] = useState<LibrarySort>("due")
  const [examId, setExamId] = useState("all")
  const [provider, setProvider] = useState("all")
  const [resolution, setResolution] = useState<"all" | "unresolved" | "resolved">("all")
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const isWorkspace = useMinWidth(WORKSPACE_MIN_WIDTH)
  const [practice, setPractice] = useState<Mistake[] | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf")
  const [importOpen, setImportOpen] = useState(false)
  const [roundTripTarget, setRoundTripTarget] = useState<{ mistakeId?: string } | null>(null)
  const roundTripMistakes = roundTripTarget?.mistakeId === undefined ? data.mistakes : data.mistakes.filter((mistake) => mistake.id === roundTripTarget.mistakeId)
  const reimportMistake = (mistake: Mistake) => setRoundTripTarget({ mistakeId: mistake.id })
  const [mergeOpen, setMergeOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [autofilling, setAutofilling] = useState(false)
  const [autofillProgress, setAutofillProgress] = useState<ChatGPTProgress | null>(null)
  const attemptMap = useMemo(() => new Map(data.attempts.map((attempt) => [attempt.id, attempt])), [data.attempts])
  const subjects = useMemo(() => [...new Set([...data.subjects, ...data.attempts.map((attempt) => attempt.subject), ...data.mistakes.flatMap((mistake) => mistake.subject ? [mistake.subject] : [])])].toSorted(), [data.attempts, data.mistakes, data.subjects])
  const activeSubject = subject === "all" || subject === "unlinked" || subjects.includes(subject) ? subject : "all"
  const mathsSubject = activeSubject !== "all" ? activeSubject : subjects.length === 1 ? subjects[0] : null
  const showMathsExamFilter = mathsSubject !== null && isTechSplitMathsSubject(mathsSubject)
  const activeMathsExamFilter = showMathsExamFilter ? mathsExamFilter : "all"
  const visibleMistakes = useMemo(() => data.mistakes.filter((mistake) => {
    const attempt = attemptMap.get(mistake.attemptId)
    const matchesSubject = activeSubject === "all" || (activeSubject === "unlinked" ? !attempt : sameStudySubject(attempt?.subject ?? mistake.subject, activeSubject))
    return matchesSubject && matchesMathsExamFilter(attempt, activeMathsExamFilter)
  }), [data.mistakes, attemptMap, activeSubject, activeMathsExamFilter])
  const dueIds = useMemo(() => new Set(getDueMistakes(visibleMistakes, now).map((mistake) => mistake.id)), [visibleMistakes, now])
  const counts = useMemo(() => getMistakeQueueCounts(visibleMistakes, now), [visibleMistakes, now])
  const progress = useMemo(() => getMistakeProgress(visibleMistakes, now), [visibleMistakes, now])
  // The summary counts the whole collection, the way the Exams page, the sidebar badge
  // and the folio app do. The subject, paper and exam filters only narrow the library,
  // the tabs and the review queue below the summary.
  const summaryCounts = useMemo(() => getMistakeQueueCounts(data.mistakes, now), [data.mistakes, now])
  const summaryProgress = useMemo(() => getMistakeProgress(data.mistakes, now), [data.mistakes, now])
  const topPriority = useMemo(() => buildRevisionPriorities(visibleMistakes).find((item) => item.unresolved > 0), [visibleMistakes])
  const alternativeCount = useMemo(() => data.alternativeMistakeDeck?.cards.filter((card) => visibleMistakes.some((mistake) => mistake.id === card.sourceMistakeId)).length ?? 0, [data.alternativeMistakeDeck, visibleMistakes])
  const autofillCandidates = useMemo(() => data.mistakes.filter(hasEmptyMistakeFields), [data.mistakes])
  const hasMergeableFields = useMemo(() => data.mistakes.some((mistake) => Boolean(mistake.areaOfStudy?.trim())), [data.mistakes])
  const browsedMistakes = useMemo(() => {
    return filterMistakeLibrary(visibleMistakes, attemptMap, dueIds, { search: deferredSearch, browserFilter, category, topic, sort, examId, provider, resolution })
  }, [visibleMistakes, attemptMap, dueIds, deferredSearch, browserFilter, category, topic, sort, examId, provider, resolution])
  const selectedMistakes = browsedMistakes.filter((mistake) => selected.has(mistake.id))
  // ponytail: pagination bounds DOM work; use virtualisation if continuous scrolling is needed.
  const pageSize = 24
  const pageCount = Math.max(1, Math.ceil(browsedMistakes.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const shownMistakes = browsedMistakes.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const activeMistake = browsedMistakes.find((mistake) => mistake.id === activeId) ?? null
  const worksheetMistakes = selectedMistakes.length ? selectedMistakes : browsedMistakes
  const categories = [...new Set(visibleMistakes.map((mistake) => mistake.category))].sort()
  const topics = [...new Set(visibleMistakes.flatMap((mistake) => mistake.areaOfStudy ? [mistake.areaOfStudy] : []))].sort()
  const visibleAttemptIds = new Set(visibleMistakes.map((mistake) => mistake.attemptId))
  const exams = data.attempts.filter((attempt) => visibleAttemptIds.has(attempt.id))
  const providers = [...new Set(exams.map((attempt) => attempt.provider))].filter(Boolean).sort()
  const examOptions = [
    { value: "all", label: "All exams", detail: "Any linked exam or no linked exam" },
    ...(provider === "all" ? [{ value: "unlinked", label: "No linked exam", detail: "Mistakes saved without an exam" }] : []),
    ...exams.filter((exam) => provider === "all" || exam.provider === provider).map((exam) => ({ value: exam.id, label: `${exam.title} · ${exam.paper}`, detail: [exam.subject, exam.provider, exam.examYear, new Date(`${exam.completedAt}T00:00:00`).toLocaleDateString("en-AU")].filter(Boolean).join(" · ") })),
  ]
  const topicOptions = [{ value: "all", label: "All topics" }, ...topics.map((item) => ({ value: item, label: item }))]
  const activeFilters = [
    ...(activeSubject !== "all" ? [{ key: "subject", label: `Subject: ${activeSubject === "unlinked" ? "No linked exam" : activeSubject}`, clear: () => { setSubject("all"); setMathsExamFilter("all") } }] : []),
    ...(activeMathsExamFilter !== "all" ? [{ key: "paper", label: activeMathsExamFilter === "exam-1" ? "Exam 1 · Tech-free" : "Exam 2 · Tech-active", clear: () => setMathsExamFilter("all") }] : []),
    ...(search.trim() ? [{ key: "search", label: `Search: ${search.trim()}`, clear: () => setSearch("") }] : []),
    ...(examId !== "all" ? [{ key: "exam", label: `Exam: ${examOptions.find((item) => item.value === examId)?.label ?? "Deleted exam"}`, clear: () => setExamId("all") }] : []),
    ...(provider !== "all" ? [{ key: "provider", label: `Provider: ${provider}`, clear: () => setProvider("all") }] : []),
    ...(category !== "all" ? [{ key: "category", label: `Category: ${category}`, clear: () => setCategory("all") }] : []),
    ...(topic !== "all" ? [{ key: "topic", label: `Topic: ${topic}`, clear: () => setTopic("all") }] : []),
    ...(browserFilter !== "all" ? [{ key: "schedule", label: `Review: ${REVIEW_FILTER_LABELS[browserFilter]}`, clear: () => setBrowserFilter("all") }] : []),
    ...(resolution !== "all" ? [{ key: "resolution", label: `Progress: ${resolution === "resolved" ? "Resolved" : "Unresolved"}`, clear: () => setResolution("all") }] : []),
  ]
  function clearSelection() { setSelected(new Set()); setActiveId(null); setPage(0) }
  function resetFilters() { setSearch(""); setCategory("all"); setTopic("all"); setBrowserFilter("all"); setExamId("all"); setProvider("all"); setResolution("all"); clearSelection() }
  function clearAllFilters() { setSubject("all"); setMathsExamFilter("all"); resetFilters() }
  function toggleSelected(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  const scheduleGroups = useMemo(() => {
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const upcoming = visibleMistakes
      .filter((mistake) => !mistake.suspended)
      .map((mistake) => ({ mistake, schedule: getMistakeSchedule(mistake) }))
      .toSorted((first, second) => first.schedule.dueAt.localeCompare(second.schedule.dueAt))
    const groups = new Map<string, { key: string; label: string; overdue: boolean; items: typeof upcoming }>()
    for (const entry of upcoming) {
      const dueDate = new Date(entry.schedule.dueAt)
      // Calendar days, not 24-hour chunks, so daylight saving cannot mislabel a day.
      const dayIndex = localDayDifference(dueDate, startOfToday)
      const key = dayIndex <= -1 ? "overdue" : dayIndex === 0 ? "today" : dayIndex === 1 ? "tomorrow" : `day-${dayIndex}`
      let group = groups.get(key)
      if (!group) {
        const label = dayIndex <= -1
          ? "Overdue"
          : dayIndex === 0
            ? "Today"
            : dayIndex === 1
              ? "Tomorrow"
              : dueDate.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
        group = { key, label, overdue: dayIndex < 0, items: [] }
        groups.set(key, group)
      }
      group.items.push(entry)
    }
    return [...groups.values()]
  }, [visibleMistakes, now])
  const dueThisWeekCount = useMemo(() => {
    const horizon = now.getTime() + 7 * 24 * 60 * 60 * 1000
    return visibleMistakes.filter((mistake) => !mistake.suspended && new Date(getMistakeSchedule(mistake).dueAt).getTime() <= horizon).length
  }, [visibleMistakes, now])

  async function autofillEmptyFields() {
    setAutofilling(true)
    setAutofillProgress(null)
    try {
      const { autofillMistakeFields } = await import("../lib/mistake-ai")
      const autofills = await autofillMistakeFields(autofillCandidates, data.attempts, setAutofillProgress)
      const summary = summarizeMistakeAutofills(data.mistakes, autofills)
      if (!summary.fieldCount) {
        toast("ChatGPT could not infer any of the empty fields from the available mistake and exam details.")
        return
      }
      onApplyAutofills(autofills)
      toast.success(`Autofilled ${summary.fieldCount} field${summary.fieldCount === 1 ? "" : "s"} across ${summary.mistakeCount} mistake${summary.mistakeCount === 1 ? "" : "s"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not autofill mistake fields.")
    } finally {
      setAutofilling(false)
    }
  }

  return (
    <div className="grid min-w-0 gap-5 lg:gap-6">
      <PageHeader title="Mistakes" description="Review and practise missed questions.">
        <Button variant="outline" onClick={() => setImportOpen(true)}><FileJson />Import from chatbot</Button>
        <Button onClick={onLog}><Plus />Add mistake</Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More mistake tools" />}><MoreHorizontal /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-64">
            {AI_ENABLED ? <><DropdownMenuItem onClick={() => void autofillEmptyFields()} disabled={!autofillCandidates.length || autofilling}><Sparkles />Autofill empty fields{autofillCandidates.length ? ` (${autofillCandidates.length})` : ""}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setBulkEditOpen(true)} disabled={!data.mistakes.length}><Sparkles />Bulk edit with ChatGPT…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMergeOpen(true)} disabled={!hasMergeableFields}><Merge />Merge fields</DropdownMenuItem></> : null}
            <DropdownMenuItem onClick={() => { setExportFormat("pdf"); setExportOpen(true) }} disabled={!data.mistakes.length}><FileDown />Export…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRoundTripTarget({})} disabled={!data.mistakes.length}><FileUp />Re-import edited JSON…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      {autofilling && autofillProgress ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground tabular-nums">{formatChatGPTProgress(autofillProgress)}</p> : null}
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-4"><div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BookOpenCheck className="size-5" /></div><div><p className="font-medium">{summaryCounts.due ? "Your next practice round" : "You're caught up"}</p><p className="text-sm text-muted-foreground tabular-nums">{summaryCounts.due} ready · {summaryProgress.matureCards} mature</p></div></div>
        <Button variant={summaryCounts.due ? "default" : "outline"} onClick={() => setTab("study")}>Review now<ArrowRight /></Button>
      </section>
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">Showing</span><Select value={activeSubject} onValueChange={(value) => { setSubject(value ?? "all"); setMathsExamFilter("all"); resetFilters() }}><SelectTrigger aria-label="Filter mistake cards by subject"><SelectValue>{activeSubject === "all" ? "All subjects" : activeSubject === "unlinked" ? "No linked exam" : activeSubject}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All subjects</SelectItem>{subjects.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}<SelectItem value="unlinked">No linked exam</SelectItem></SelectContent></Select>{showMathsExamFilter ? <Select value={activeMathsExamFilter} onValueChange={(value) => { setMathsExamFilter((value ?? "all") as MathsExamFilter); resetFilters() }}><SelectTrigger aria-label="Filter maths mistake cards by exam"><SelectValue>{activeMathsExamFilter === "all" ? "All exams" : activeMathsExamFilter === "exam-1" ? "Exam 1 · Tech-free" : "Exam 2 · Tech-active"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All exams</SelectItem><SelectItem value="exam-1">Exam 1 · Tech-free</SelectItem><SelectItem value="exam-2">Exam 2 · Tech-active</SelectItem></SelectContent></Select> : null}</div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as PageTab)} className="min-w-0">
        <TabsList variant="line" className="h-auto! w-full! flex-nowrap justify-start gap-2 overflow-x-auto border-b pb-2">
          <TabsTrigger value="browse" className="px-3">Library</TabsTrigger>
          <TabsTrigger value="study" className="px-3">Review{counts.due ? ` (${counts.due})` : ""}</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          {AI_ENABLED ? <TabsTrigger value="alternative">Alternatives{alternativeCount ? ` (${alternativeCount})` : ""}</TabsTrigger> : null}
          <TabsTrigger value="insights">{AI_ENABLED ? "Insights" : "Progress"}</TabsTrigger>
        </TabsList>
        <TabsContent value="insights" className="mt-4 grid gap-4">
          <Card><CardHeader><CardTitle>Your progress</CardTitle><CardDescription>{progress.matureCards} of {progress.activeCards} active cards have reached a 21+ day interval.</CardDescription></CardHeader><CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center lg:gap-8"><Progress value={progress.masteryPercent} aria-label="Mistake mastery" /><div className="grid grid-cols-3 gap-4 lg:gap-6"><div><p className="text-2xl font-semibold tabular-nums">{Math.round(progress.masteryPercent)}%</p><p className="text-xs text-muted-foreground">Mastery</p></div><div><p className="text-2xl font-semibold tabular-nums">{progress.recallRate === null ? "—" : Math.round(progress.recallRate) + "%"}</p><p className="text-xs text-muted-foreground">Recall · last 30 days</p></div><div><p className="text-2xl font-semibold tabular-nums">{progress.reviewsCompleted}</p><p className="text-xs text-muted-foreground">Reviews · last 30 days</p></div></div></CardContent></Card>
          {AI_ENABLED ? <MistakeInsights data={data} priorityCategory={topPriority?.category} onSave={onSaveInsights} /> : null}
        </TabsContent>
        <TabsContent value="study" className="mt-4"><StudyQueue onSavePreferences={onSaveReviewPreferences} allMistakes={data.mistakes} preferences={data.mistakeReviewPreferences} key={`${activeSubject}:${activeMathsExamFilter}`} mistakes={visibleMistakes} attempts={data.attempts} studies={studies} onReview={onReview} onEdit={onEdit} onReimport={reimportMistake} onToggleSuspend={onToggleSuspend} onBrowse={() => setTab("browse")} /></TabsContent>
        <TabsContent value="schedule" className="mt-4 min-w-0">
          <ReviewPacing key={data.mistakeReviewPreferences?.updatedAt ?? "default"} data={data} onSave={onSaveReviewPreferences} onReduce={onReduceReviews} />
          {scheduleGroups.length ? (
            <div className="grid min-w-0 gap-6">
              <div className="grid gap-1">
                <h2 className="text-lg font-semibold">Review schedule</h2>
                <p className="max-w-[68ch] text-sm text-muted-foreground">{dueThisWeekCount
                  ? `${dueThisWeekCount} card${dueThisWeekCount === 1 ? "" : "s"} to review in the next 7 days.`
                  : "Nothing scheduled for the next week — log mistakes after your next timed paper."}</p>
              </div>
              <div className="grid min-w-0 gap-6 lg:gap-8">
                {scheduleGroups.map((group) => (
                  <section key={group.key} className="grid min-w-0 gap-3 border-t pt-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6" aria-label={`Reviews due ${group.label.toLowerCase()}`}>
                    <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:justify-start sm:gap-1">
                      <h3 className={group.overdue ? "font-semibold text-destructive" : "font-semibold"}>{group.label}</h3>
                      <p className="text-xs text-muted-foreground tabular-nums">{group.items.length} {group.items.length === 1 ? "card" : "cards"}</p>
                    </div>
                    <ul className="min-w-0 divide-y rounded-xl border bg-card">
                      {group.items.map(({ mistake, schedule }) => {
                        const attempt = attemptMap.get(mistake.attemptId)
                        return (
                          <li key={mistake.id} className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onEdit(mistake)}
                              className="grid min-h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-center xl:gap-6"
                            >
                              <span className="grid min-w-0 gap-1">
                                <span className="break-words text-sm font-medium">{mistake.question}</span>
                                {mistake.areaOfStudy ? <span className="break-words text-xs text-muted-foreground">{mistake.areaOfStudy}</span> : null}
                              </span>
                              <span className="grid min-w-0 gap-1">
                                {attempt?.subject || mistake.subject ? <span className="break-words text-sm">{attempt?.subject ?? mistake.subject}</span> : !mistake.attemptId ? <span className="break-words text-sm">Uncategorised</span> : null}
                                {attempt?.title ? <span className="break-words text-xs text-muted-foreground">{attempt.title}</span> : null}
                              </span>
                              <span className="col-start-2 row-span-2 row-start-1 flex flex-col items-end justify-between gap-3 xl:col-auto xl:row-auto xl:flex-row xl:items-center xl:justify-end">
                                <Badge variant="secondary">{stateLabel(schedule.state, schedule.resolved)}</Badge>
                                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <Empty className="min-h-64 border"><EmptyHeader><EmptyMedia variant="icon"><NotebookPen /></EmptyMedia><EmptyTitle>No reviews scheduled</EmptyTitle><EmptyDescription>Cards appear here once mistakes are logged and reviewed.</EmptyDescription></EmptyHeader></Empty>
          )}
        </TabsContent>
        {AI_ENABLED ? <TabsContent value="alternative" className="mt-4"><MistakeAlternativeDeck key={`${activeSubject}:${activeMathsExamFilter}`} mistakes={visibleMistakes} allMistakes={data.mistakes} attempts={data.attempts} deck={data.alternativeMistakeDeck} onSave={onSaveAlternativeDeck} /></TabsContent> : null}
        <TabsContent value="browse" className="mt-4">
          <div className="grid gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" className="pl-8" value={search} onChange={(event) => { setSearch(event.target.value); clearSelection() }} placeholder="Search mistakes" aria-label="Search mistake cards" /></div>
              <div className="flex gap-2 sm:shrink-0">
              <Select items={{ due: "Due date", newest: "Newest first", oldest: "Oldest first", marks: "Most marks lost", question: "Question order" }} value={sort} onValueChange={(value) => { setSort((value ?? "due") as LibrarySort); setPage(0) }}>
                <SelectTrigger className="min-w-0 flex-1 sm:flex-none" aria-label="Sort mistakes"><span className="text-muted-foreground">Sort:</span><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="due">Due date</SelectItem><SelectItem value="newest">Newest first</SelectItem><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="marks">Most marks lost</SelectItem><SelectItem value="question">Question order</SelectItem></SelectContent>
              </Select>
              <Button variant="outline" onClick={() => setShowFilters((open) => !open)} aria-expanded={showFilters} aria-controls="mistake-library-filters"><SlidersHorizontal />Filters{activeFilters.length ? <Badge variant="secondary" className="px-1.5 tabular-nums">{activeFilters.length}</Badge> : null}</Button>
              </div>
            </div>
            {showFilters ? <section id="mistake-library-filters" aria-labelledby="mistake-filters-heading" className="grid min-w-0 gap-4 rounded-xl border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h2 id="mistake-filters-heading" className="text-sm font-medium">Filter mistakes</h2><p className="mt-1 text-xs text-muted-foreground">Combine filters to narrow your library. Results update as you choose.</p></div>
                <span className="text-xs text-muted-foreground tabular-nums" role="status">{browsedMistakes.length} matching {browsedMistakes.length === 1 ? "mistake" : "mistakes"}</span>
              </div>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Field className="min-w-0">
                  <FieldLabel htmlFor="mistake-filter-provider">Exam provider</FieldLabel>
                  <Select value={provider} onValueChange={(value) => { const next = value ?? "all"; setProvider(next); if (next !== "all" && attemptMap.get(examId)?.provider !== next) setExamId("all"); clearSelection() }}>
                    <SelectTrigger id="mistake-filter-provider" className="w-full"><SelectValue>{provider === "all" ? "All providers" : provider}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="all">All providers</SelectItem>{providers.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field className="min-w-0 xl:col-span-2">
                  <FieldLabel htmlFor="mistake-filter-exam">Linked exam</FieldLabel>
                  <Combobox items={examOptions} value={examOptions.find((item) => item.value === examId) ?? examOptions[0]} itemToStringLabel={(item) => item.label} filter={(item, query) => `${item.label} ${item.detail}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())} onValueChange={(value) => { setExamId(value?.value ?? "all"); clearSelection() }} autoHighlight>
                    <ComboboxTrigger id="mistake-filter-exam" render={<Button variant="outline" className="w-full min-w-0 justify-between bg-card font-normal" />}><span className="truncate text-left"><ComboboxValue /></span></ComboboxTrigger>
                    <ComboboxContent className="min-w-0">
                      <div className="border-b p-2"><ComboboxInput className="w-full" showTrigger={false} placeholder="Search exam name, paper or year…" aria-label="Search linked exams" /></div>
                      <ComboboxEmpty>No exams match your search.</ComboboxEmpty>
                      <ComboboxList>{(item) => <ComboboxItem key={item.value} value={item} className="items-start py-2"><span className="grid min-w-0 gap-0.5"><span className="text-wrap break-words">{item.label}</span><span className="text-xs text-wrap text-muted-foreground">{item.detail}</span></span></ComboboxItem>}</ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor="mistake-filter-category">Mistake category</FieldLabel>
                  <Select value={category} onValueChange={(value) => { setCategory(value ?? "all"); clearSelection() }}>
                    <SelectTrigger id="mistake-filter-category" className="w-full min-w-0 [&>span]:truncate"><SelectValue>{category === "all" ? "All categories" : category}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor="mistake-filter-topic">Topic</FieldLabel>
                  <Combobox items={topicOptions} value={topicOptions.find((item) => item.value === topic) ?? topicOptions[0]} onValueChange={(value) => { setTopic(value?.value ?? "all"); clearSelection() }} autoHighlight>
                    <ComboboxTrigger id="mistake-filter-topic" render={<Button variant="outline" className="w-full min-w-0 justify-between bg-card font-normal" />}><span className="truncate text-left"><ComboboxValue /></span></ComboboxTrigger>
                    <ComboboxContent className="min-w-0"><div className="border-b p-2"><ComboboxInput className="w-full" showTrigger={false} placeholder="Search topics…" aria-label="Search topics" /></div><ComboboxEmpty>No topics match your search.</ComboboxEmpty><ComboboxList>{(item) => <ComboboxItem key={item.value} value={item}><span className="text-wrap break-words">{item.label}</span></ComboboxItem>}</ComboboxList></ComboboxContent>
                  </Combobox>
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor="mistake-filter-review">Review status</FieldLabel>
                  <Select value={browserFilter} onValueChange={(value) => { setBrowserFilter((value ?? "all") as BrowserFilter); clearSelection() }}>
                    <SelectTrigger id="mistake-filter-review" className="w-full"><SelectValue>{REVIEW_FILTER_LABELS[browserFilter]}</SelectValue></SelectTrigger>
                    <SelectContent>{Object.entries(REVIEW_FILTER_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
              <fieldset className="grid gap-2 border-t pt-3">
                <legend className="sr-only">Progress</legend>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-sm font-medium">Progress</span>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by progress">
                    {([['all', 'Any progress'], ['unresolved', 'Unresolved'], ['resolved', 'Resolved']] as const).map(([value, label]) => <Button key={value} size="sm" variant={resolution === value ? "secondary" : "ghost"} aria-pressed={resolution === value} onClick={() => { setResolution(value); clearSelection() }}>{label}</Button>)}
                  </div>
                  <p className="text-xs text-muted-foreground">Focus on mistakes that still need practice, or revisit resolved ones.</p>
                </div>
              </fieldset>
            </section> : null}
            {activeFilters.length ? <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Active filters">
              {activeFilters.map((filter) => <Button key={filter.key} size="sm" variant="secondary" className="h-auto min-h-7 max-w-full py-1" onClick={() => { filter.clear(); clearSelection() }} aria-label={`Remove filter: ${filter.label}`}><span className="truncate">{filter.label}</span><X className="size-3" /></Button>)}
              <Button size="sm" variant="ghost" onClick={clearAllFilters}>Clear all</Button>
            </div> : null}
            {browsedMistakes.length ? <>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground tabular-nums" role="status">{browsedMistakes.length} {browsedMistakes.length === 1 ? "mistake" : "mistakes"}{browsedMistakes.length !== visibleMistakes.length ? ` of ${visibleMistakes.length}` : ""}{shownMistakes.length < browsedMistakes.length ? ` · ${currentPage * pageSize + 1}–${currentPage * pageSize + shownMistakes.length}` : ""}</span>
              <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-primary" disabled={!browsedMistakes.length} checked={browsedMistakes.length > 0 && selectedMistakes.length === browsedMistakes.length} ref={(node) => { if (node) node.indeterminate = selectedMistakes.length > 0 && selectedMistakes.length < browsedMistakes.length }} onChange={(event) => setSelected(event.target.checked ? new Set(browsedMistakes.map((mistake) => mistake.id)) : new Set())} />Select all {browsedMistakes.length} results</label><Button size="sm" variant="outline" disabled={!browsedMistakes.length} onClick={() => setPractice(worksheetMistakes)}><Play />{selectedMistakes.length ? `Practise selected (${selectedMistakes.length})` : "Practise"}</Button></div>
            </div>
            {selectedMistakes.length ? <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted p-3" aria-label="Selected card actions"><span className="mr-auto text-sm font-medium tabular-nums">{selectedMistakes.length} selected</span><Button size="sm" variant="outline" disabled={selectedMistakes.every((mistake) => mistake.suspended)} onClick={() => { onSetSuspended(selectedMistakes.map((mistake) => mistake.id), true); setSelected(new Set()) }}>Pause reviews</Button><Button size="sm" variant="outline" disabled={selectedMistakes.every((mistake) => !mistake.suspended)} onClick={() => { onSetSuspended(selectedMistakes.map((mistake) => mistake.id), false); setSelected(new Set()) }}>Resume reviews</Button>{AI_ENABLED ? <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}><Sparkles />Edit with ChatGPT</Button> : null}<Button size="sm" variant="outline" onClick={() => setExportOpen(true)}><FileDown />Export selected</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X />Clear selection</Button></div> : null}
            <WorkspaceSplit id="mistakes" primary={
              <section className="grid min-w-0 gap-3" aria-label="Mistake results">
                <ol className="grid min-w-0 divide-y overflow-hidden rounded-xl border bg-card">
                  {shownMistakes.map((mistake) => <BrowseRow key={mistake.id} mistake={mistake} now={now} active={mistake.id === activeId} selected={selected.has(mistake.id)} onOpen={() => setActiveId(mistake.id)} onSelect={() => toggleSelected(mistake.id)} onReimport={() => reimportMistake(mistake)} />)}
                </ol>
                <nav aria-label="Library pages" className="flex items-center justify-between gap-2">
                  <Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                  <span className="text-xs text-muted-foreground" role="status">Page {currentPage + 1} of {pageCount}</span>
                  <Button size="sm" variant="outline" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
                </nav>
              </section>
              } secondary={isWorkspace ? <div className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">{activeMistake
                ? <MistakeDetail mistake={activeMistake} attempt={attemptMap.get(activeMistake.attemptId)} studies={studies} onEdit={onEdit} onReimport={reimportMistake} onToggleSuspend={onToggleSuspend} onDelete={onDelete} onPractice={(target) => setPractice([target])} />
                : <div className="grid min-h-80 place-content-center gap-3 rounded-xl border border-dashed p-8 text-center"><NotebookPen className="mx-auto size-7 text-muted-foreground" /><h2 className="font-medium">Choose a mistake</h2><p className="max-w-xs text-sm text-muted-foreground">Read the question, understand what went wrong, and practise the corrected method.</p></div>}</div> : null}
            />
            {!isWorkspace && activeMistake ? <Dialog open onOpenChange={(open) => { if (!open) setActiveId(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Mistake details</DialogTitle><DialogDescription>Review the question and your corrected approach.</DialogDescription></DialogHeader><MistakeDetail mistake={activeMistake} attempt={attemptMap.get(activeMistake.attemptId)} studies={studies} onEdit={onEdit} onReimport={reimportMistake} onToggleSuspend={onToggleSuspend} onDelete={onDelete} onPractice={(target) => setPractice([target])} /></DialogContent></Dialog> : null}

            </> : <Empty className="min-h-64 rounded-xl border border-dashed"><EmptyHeader><EmptyMedia variant="icon"><NotebookPen /></EmptyMedia><EmptyTitle>{data.mistakes.length ? "No matching mistakes" : "No mistakes yet"}</EmptyTitle><EmptyDescription>{data.mistakes.length ? "Try another search or clear your filters." : "Save a missed question here to review it later, with or without an exam."}</EmptyDescription></EmptyHeader>{data.mistakes.length ? <Button variant="outline" onClick={clearAllFilters}>Clear filters</Button> : <Button onClick={onLog}><Plus />Add mistake</Button>}</Empty>}
          </div>
        </TabsContent>
      </Tabs>
      {practice ? <MistakePractice mistakes={practice} onClose={() => setPractice(null)} /> : null}
      {importOpen ? (
        <MistakeJsonImportDialog
          open
          attempts={data.attempts}
          onOpenChange={setImportOpen}
          onSaveMistakes={onImportMistakes}
        />
      ) : null}
      {exportOpen ? <MistakeExportDialog initialFormat={exportFormat} mistakes={data.mistakes} current={worksheetMistakes} attempts={data.attempts} onOpenChange={setExportOpen} /> : null}
      {roundTripTarget ? <MistakeRoundTripDialog mistakes={roundTripMistakes} singleMistake={roundTripTarget.mistakeId !== undefined} onExport={() => {
        if (roundTripTarget.mistakeId !== undefined) {
          void exportMistakes("json", roundTripMistakes, data.attempts).then((downloaded) => { if (downloaded) toast.success("Export downloaded") }).catch((error) => toast.error(error instanceof Error ? error.message : "Could not export mistake."))
        } else {
          setRoundTripTarget(null); setExportFormat("json"); setExportOpen(true)
        }
      }} onOpenChange={(open) => { if (!open) setRoundTripTarget(null) }} onApply={(edits) => { onApplyEdits(edits); toast.success(`Updated ${edits.length} ${edits.length === 1 ? "mistake" : "mistakes"}`) }} /> : null}
      {bulkEditOpen ? <MistakeBulkEditDialog mistakes={data.mistakes} current={browsedMistakes} selected={selectedMistakes} attempts={data.attempts} onOpenChange={setBulkEditOpen} onApply={onApplyEdits} /> : null}
      {mergeOpen ? <MistakeFieldMergeDialog mistakes={data.mistakes} onOpenChange={setMergeOpen} onApply={onApplyMergePlan} /> : null}
    </div>
  )
}

function ReviewPacing({ data, onSave, onReduce }: { data: AppData; onSave: (preferences: MistakeReviewPreferences) => void; onReduce: (days: number, target: number) => void }) {
  const preferences = normalizeMistakeReviewPreferences(data.mistakeReviewPreferences)
  const [spacing, setSpacing] = useState(preferences.spacingMultiplier)
  const [retry, setRetry] = useState(preferences.retryHours)
  const [maximum, setMaximum] = useState(preferences.maximumIntervalDays)
  const [days, setDays] = useState(7)
  const [target, setTarget] = useState(5)
  const now = useTickingNow(30_000).getTime()
  const changes = reduceMistakeReviews(data.mistakes, days, target, now)
  return <Card className="mb-6">
    <CardHeader><CardTitle>Review pacing</CardTitle><CardDescription>Due dates are suggestions. Practise any saved question whenever you need to. These controls sync with Folio.</CardDescription></CardHeader>
    <CardContent className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-2 text-sm">Successful review spacing · {spacing.toFixed(1)}×<input type="range" min="0.5" max="3" step="0.1" value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} /></label>
        <label className="grid gap-2 text-sm">Retry after a miss · {retry < 1 ? `${Math.round(retry * 60)} minutes` : `${Math.round(retry)} hours`}<input type="range" min={1 / 6} max="168" step="any" value={retry} onChange={(e) => setRetry(Number(e.target.value))} /></label>
        <label className="grid gap-2 text-sm">Longest interval · {maximum} days<input type="range" min="7" max="365" step="1" value={maximum} onChange={(e) => setMaximum(Number(e.target.value))} /></label>
      </div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setSpacing(1); setRetry(1 / 6); setMaximum(365) }}>Frequent reviews</Button><Button variant="outline" onClick={() => { setSpacing(1.5); setRetry(24); setMaximum(180) }}>Relaxed defaults</Button><Button onClick={() => onSave({ ...preferences, spacingMultiplier: spacing, retryHours: retry, maximumIntervalDays: maximum, updatedAt: new Date().toISOString() })}>Save pacing</Button></div>
      <div className="grid gap-4 border-t pt-4">
        {preferences.lighterUntil && Date.parse(preferences.lighterUntil) > now ? <div className="flex flex-wrap items-center gap-2"><p className="text-sm">Lighter schedule until {new Date(preferences.lighterUntil).toLocaleDateString()}</p><Button variant="outline" onClick={() => onSave({ ...preferences, lighterUntil: undefined })}>End lighter period</Button></div> : null}
        <h3 className="font-medium">Reduce upcoming reviews</h3>
        <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">Next {days} days<input type="range" min="1" max="90" step="1" value={days} onChange={(e) => setDays(Number(e.target.value))} /></label><label className="grid gap-2 text-sm">{target === 0 ? "Take a break" : `Up to ${target} scheduled questions per day`}<input type="range" min="0" max="50" step="1" value={target} onChange={(e) => setTarget(Number(e.target.value))} /></label></div>
        <p className="text-sm text-muted-foreground">{changes.size} questions will move to later dates. Overflow is spread beyond this period around existing reviews. A break resumes at up to 10 questions a day. Review history stays intact; you can still practise early. New reviews also respect this target during the period.</p>
        <Button className="w-fit" variant="outline" onClick={() => onReduce(days, target)}>Start lighter period · move {changes.size} dates</Button>
      </div>
    </CardContent>
  </Card>
}
