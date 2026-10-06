import { memo, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react"
import { ArrowRight, BookOpenCheck, FileDown, FileJson, FileUp, Merge, MoreHorizontal, NotebookPen, Pencil, Play, Plus, Search, Shuffle, SkipForward, SlidersHorizontal, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import { useMinWidth } from "../hooks/use-mobile"
import { AI_ENABLED } from "../lib/host"
import { filterMistakeLibrary, type BrowserFilter } from "../lib/mistake-library"
import { MistakePractice } from "./mistake-practice"
import { MarkdownPreview } from "./markdown-preview"
import { MistakeAttachments } from "./mistake-attachments"
import { MistakeAlternativeDeck } from "./mistake-alternative-deck"
import { MistakeJsonImportDialog } from "./mistake-json-import"
import { MistakeInsights } from "./mistake-insights"
import { PageHeader } from "./page-header"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
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
  type AppData,
  type ExamAttempt,
  type Mistake,
  type MistakeReviewState,
  type ReviewRating,
} from "../lib/exam-data"
import { MistakeBulkEditDialog } from "./mistake-bulk-edit-dialog"
import { MistakeExportDialog } from "./mistake-export-dialog"
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
  data: AppData
  studies: VcaaStudyResources[]
  onLog: () => void
  onEdit: (mistake: Mistake) => void
  onReview: (mistake: Mistake, rating: ReviewRating) => void
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
  return !(target instanceof HTMLElement) || !target.closest("input, textarea, select, button, [contenteditable='true']")
}

function ExamContext({ mistake, attempt, studies }: { mistake: Mistake; attempt?: ExamAttempt; studies: VcaaStudyResources[] }) {
  const exam = attempt ? findCachedVcaaExamForAttempt(attempt, studies) : undefined
  return (
    <CardDescription>
      {attempt ? <>{attempt.title} · {attempt.paper}{exam ? <> · <a className="font-medium text-foreground underline underline-offset-4" href={exam.url} target="_blank" rel="noreferrer">Exam PDF</a></> : null}</> : mistake.attemptId ? "Deleted exam" : "Uncategorised"}
      {mistake.totalMarks !== undefined && mistake.marksLost !== undefined ? <> · {mistake.marksLost}/{mistake.totalMarks} marks lost</> : null}
    </CardDescription>
  )
}

function AnswerPanel({ label, value, tone }: { label: string; value?: string; tone: "problem" | "fix" | "neutral" }) {
  const border = tone === "problem" ? "border-l-destructive/60" : tone === "fix" ? "border-l-primary" : "border-l-border"
  return (
    <section className={"min-w-0 rounded-lg border border-l-4 bg-muted/20 p-4 " + border}>
      <SectionLabel>{label}</SectionLabel>
      {value?.trim() ? <MarkdownPreview unframed>{value}</MarkdownPreview> : <p className="text-sm text-muted-foreground">Not recorded yet.</p>}
    </section>
  )
}

function ReviewCard({ mistake, attempt, studies, onRate, onEdit, onToggleSuspend }: { mistake: Mistake; attempt?: ExamAttempt; studies: VcaaStudyResources[]; onRate: (rating: ReviewRating) => void; onEdit: (mistake: Mistake) => void; onToggleSuspend: (mistake: Mistake) => void }) {
  const [revealed, setRevealed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const schedule = getMistakeSchedule(mistake)
  const previews = useMemo(() => Object.fromEntries(RATING_OPTIONS.map(({ rating }) => [rating, previewMistakeReview(mistake, rating)])) as Record<ReviewRating, ReturnType<typeof previewMistakeReview>>, [mistake])

  function rate(rating: ReviewRating) {
    if (submitting) return
    setSubmitting(true)
    onRate(rating)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || document.querySelector("[role=dialog]" ) || !canUseReviewShortcut(event.target)) return
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault()
        setRevealed(true)
        return
      }
      if (!revealed) return
      const option = RATING_OPTIONS.find((item) => item.shortcut === event.key)
      if (option && !submitting) {
        event.preventDefault()
        setSubmitting(true)
        onRate(option.rating)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onRate, revealed, submitting])

  return (
    <article className="grid min-w-0 gap-5" aria-live="polite">
      <div className="rounded-xl border bg-card">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:px-6">
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{stateLabel(schedule.state, schedule.resolved)}</Badge>
              <Badge variant="outline">{mistake.category}</Badge>
              {mistake.areaOfStudy ? <Badge variant="outline">{mistake.areaOfStudy}</Badge> : null}
            </div>
            <ExamContext mistake={mistake} attempt={attempt} studies={studies} />
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => onEdit(mistake)}><Pencil />Edit</Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`More actions for ${mistake.question}`} />}><MoreHorizontal /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onToggleSuspend(mistake)}>{mistake.suspended ? "Resume reviews" : "Pause reviews"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="grid min-h-72 content-start gap-3 p-4 sm:p-6">
          <h2 className="text-xl leading-snug font-semibold text-balance">{mistake.question}</h2>
          <MarkdownPreview unframed>{mistake.questionText?.trim() || mistake.question}</MarkdownPreview>
          <MistakeAttachments attachments={mistake.attachments} />
        </div>
      </div>
      {revealed ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <AnswerPanel label="What went wrong" value={mistake.explanation} tone="problem" />
          <AnswerPanel label="Improved response or method" value={mistake.correction} tone="fix" />
        </div>
      ) : null}
      {/* Pinned so the answer controls never scroll away from a long worked solution. */}
      <div className="sticky bottom-0 z-10 -mx-1 border-t bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {!revealed ? (
          <Button size="lg" className="w-full" onClick={() => setRevealed(true)}>Show answer <kbd className="ml-1 rounded border border-primary-foreground/30 px-1.5 text-xs font-normal">Space</kbd></Button>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {RATING_OPTIONS.map((option) => (
              <Button key={option.rating} variant={option.variant} size="lg" className="h-auto flex-col gap-0.5 py-2.5" disabled={submitting} onClick={() => rate(option.rating)}>
                <span className="font-medium">{option.label} <kbd className="ml-0.5 text-xs font-normal opacity-60">{option.shortcut}</kbd></span>
                <span className="text-xs font-normal opacity-70 tabular-nums">{formatReviewInterval(previews[option.rating].dueAt)}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

function StudyQueue({ mistakes, attempts, studies, onReview, onBrowse, onEdit, onToggleSuspend }: { onEdit: (mistake: Mistake) => void; onToggleSuspend: (mistake: Mistake) => void; mistakes: Mistake[]; attempts: ExamAttempt[]; studies: VcaaStudyResources[]; onReview: (mistake: Mistake, rating: ReviewRating) => void; onBrowse: () => void }) {
  const [ratings, setRatings] = useState<Record<ReviewRating, number>>({ again: 0, hard: 0, good: 0, easy: 0 })
  const reviewed = ratings.again + ratings.hard + ratings.good + ratings.easy
  const now = useTickingNow(30_000)
  const attemptMap = useMemo(() => new Map(attempts.map((attempt) => [attempt.id, attempt])), [attempts])
  const due = getDueMistakes(mistakes, now)
  const [queueIds, setQueueIds] = useState(() => due.map((mistake) => mistake.id))
  const dueIds = due.map((mistake) => mistake.id)
  const dueIdSet = new Set(dueIds)
  const activeQueueIds = [
    ...queueIds.filter((id) => dueIdSet.has(id)),
    ...dueIds.filter((id) => !queueIds.includes(id)),
  ]
  if (queueIds.join("\u0000") !== activeQueueIds.join("\u0000")) setQueueIds(activeQueueIds)
  const dueMap = new Map(due.map((mistake) => [mistake.id, mistake]))
  const current = activeQueueIds.map((id) => dueMap.get(id)).find((mistake) => mistake !== undefined)
  const counts = getMistakeQueueCounts(mistakes, now)
  const nextScheduled = mistakes
    .filter((mistake) => !mistake.suspended && !due.some((dueMistake) => dueMistake.id === mistake.id))
    .map((mistake) => getMistakeSchedule(mistake).dueAt)
    .toSorted()[0]
  const sessionTotal = reviewed + due.length

  function rate(rating: ReviewRating) {
    if (!current) return
    onReview(current, rating)
    setQueueIds(activeQueueIds.filter((id) => id !== current.id))
    setRatings((value) => ({ ...value, [rating]: value[rating] + 1 }))
  }

  function shuffleQueue() {
    const shuffled = [...activeQueueIds]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
    }
    setQueueIds(shuffled)
  }

  function skipCard() {
    setQueueIds(activeQueueIds.length > 1 ? [...activeQueueIds.slice(1), activeQueueIds[0]] : activeQueueIds)
  }

  if (!current) {
    return (
      <Empty className="min-h-96 border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><BookOpenCheck /></EmptyMedia>
          <EmptyTitle>{reviewed ? "Review complete" : "Nothing due right now"}</EmptyTitle>
          <EmptyDescription>{nextScheduled ? `Next card is due in ${formatReviewInterval(nextScheduled, now)}.` : mistakes.length ? "All active cards are reviewed." : "Log a mistake after your next practice exam to create your first card."}</EmptyDescription>
        </EmptyHeader>
        {reviewed ? (
          <dl className="flex flex-wrap justify-center gap-6 text-center">
            {RATING_OPTIONS.map(({ rating, label }) => <div key={rating}><dd className="text-2xl font-semibold tabular-nums">{ratings[rating]}</dd><dt className="text-xs text-muted-foreground">{label}</dt></div>)}
          </dl>
        ) : null}
        {mistakes.length ? <Button variant="outline" onClick={onBrowse}>Browse cards</Button> : null}
      </Empty>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-xl border bg-card p-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm tabular-nums"><span className="text-lg font-semibold">{due.length}</span> <span className="text-muted-foreground">left · {reviewed} done</span></p>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={shuffleQueue} disabled={due.length < 2}><Shuffle />Shuffle</Button>
            <Button size="sm" variant="ghost" onClick={skipCard} disabled={due.length < 2}><SkipForward />Skip</Button>
            <Button size="sm" variant="outline" onClick={onBrowse}>End session</Button>
          </div>
        </div>
        <Progress value={sessionTotal ? reviewed / sessionTotal * 100 : 0} aria-label="Session progress" />
        <p className="text-xs text-muted-foreground tabular-nums">{counts.new} new · {counts.learning + counts.relearning} learning · {counts.review} review</p>
      </div>
      <ReviewCard key={current.id + current.updatedAt} mistake={current} attempt={attemptMap.get(current.attemptId)} studies={studies} onRate={rate} onEdit={onEdit} onToggleSuspend={onToggleSuspend} />
    </div>
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
}

// The reading surface. Maths needs a measured column, not a card in a stack, so
// this is the one place a mistake's content is rendered on the library tab.
function MistakeDetail({ mistake, attempt, studies, onEdit, onToggleSuspend, onDelete, onPractice }: MistakeActions) {
  const schedule = getMistakeSchedule(mistake)
  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-4 sm:p-5 lg:p-6">
      <header className="grid gap-2">
        <h2 className="text-lg leading-snug font-semibold text-balance">{mistake.question}</h2>
        <ExamContext mistake={mistake} attempt={attempt} studies={studies} />
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{stateLabel(schedule.state, schedule.resolved)}</Badge>
          <Badge variant="outline">{mistake.category}</Badge>
          {mistake.areaOfStudy ? <Badge variant="outline">{mistake.areaOfStudy}</Badge> : null}
        </div>
      </header>
      <section className="min-w-0">
        <SectionLabel>Question</SectionLabel>
        <MarkdownPreview unframed>{mistake.questionText?.trim() || mistake.question}</MarkdownPreview>
        <MistakeAttachments attachments={mistake.attachments} />
      </section>
      <div className="grid gap-6 border-t pt-5 lg:grid-cols-2">
        <ProseField label="What went wrong" value={mistake.explanation} />
        <ProseField label="Improved response or method" value={mistake.correction} />
      </div>
      {mistake.reviewHistory?.length ? (
        <section className="grid gap-2 border-t pt-5">
          <SectionLabel>Recent reviews</SectionLabel>
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {mistake.reviewHistory.toReversed().slice(0, 6).map((review) => <li key={review.id} className="tabular-nums">{reviewLine(review)}</li>)}
          </ul>
        </section>
      ) : null}
      <footer className="flex flex-wrap items-center gap-2 border-t pt-5">
        <Button size="sm" onClick={() => onPractice(mistake)}><Play />Practise</Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(mistake)}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={() => onToggleSuspend(mistake)}>{mistake.suspended ? "Resume reviews" : "Pause reviews"}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={`More actions for ${mistake.question}`} />}><MoreHorizontal /></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onClick={() => onDelete(mistake)}>Delete</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </footer>
    </article>
  )
}

// A row, not a card. Scanning forty mistakes beats scrolling past four.
function BrowseRowInner({ mistake, active, selected, now, onOpen, onSelect }: {
  mistake: Mistake
  active: boolean
  selected: boolean
  now: Date
  onOpen: () => void
  onSelect: () => void
}) {
  const schedule = getMistakeSchedule(mistake)
  const isDue = !mistake.suspended && new Date(schedule.dueAt).getTime() <= now.getTime()
  return (
    <li className={"rounded-lg transition-colors motion-reduce:transition-none " + (active ? "bg-accent" : "hover:bg-accent/60")}>
      <div className="flex items-start gap-3 px-2 py-1.5">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={"Select " + mistake.question} className="mt-1.5 size-4 shrink-0 accent-primary" />
        <button type="button" onClick={onOpen} aria-expanded={active} className="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="block truncate text-sm font-medium">{mistake.question}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className="truncate">{mistake.category}</span>
            {!mistake.attemptId ? <><span aria-hidden="true">·</span><span>Uncategorised</span></> : null}
            {mistake.areaOfStudy ? <><span aria-hidden="true">·</span><span className="truncate">{mistake.areaOfStudy}</span></> : null}
            {mistake.marksLost !== undefined && mistake.totalMarks !== undefined ? <><span aria-hidden="true">·</span><span className="tabular-nums">{mistake.marksLost}/{mistake.totalMarks} lost</span></> : null}
          </span>
        </button>
        <span className={"shrink-0 pt-0.5 text-xs whitespace-nowrap tabular-nums " + (isDue ? "font-medium text-primary" : "text-muted-foreground")}>
          {mistake.suspended ? "Paused" : isDue ? "Due now" : `Due ${formatDueDate(schedule.dueAt)}`}
        </span>
      </div>
    </li>
  )
}

const BrowseRow = memo(BrowseRowInner)

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

export function MistakesPage({ data, studies, onLog, onEdit, onReview, onToggleSuspend, onSetSuspended, onDelete, onImportMistakes, onApplyAutofills, onApplyMergePlan, onApplyEdits, onSaveInsights, onSaveAlternativeDeck }: MistakesPageProps) {
  const now = useTickingNow(30_000)
  const [subject, setSubject] = useState("all")
  const [mathsExamFilter, setMathsExamFilter] = useState<MathsExamFilter>("all")
  const [tab, setTab] = useState<PageTab>("browse")
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [browserFilter, setBrowserFilter] = useState<BrowserFilter>("all")
  const [category, setCategory] = useState("all")
  const [topic, setTopic] = useState("all")
  const [sort, setSort] = useState("due")
  const [examId, setExamId] = useState("all")
  const [provider, setProvider] = useState("all")
  const [resolution, setResolution] = useState<"all" | "unresolved" | "resolved">("all")
  const [showFilters, setShowFilters] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const isWorkspace = useMinWidth(WORKSPACE_MIN_WIDTH)
  const [practice, setPractice] = useState<Mistake[] | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [roundTripOpen, setRoundTripOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [autofilling, setAutofilling] = useState(false)
  const [autofillProgress, setAutofillProgress] = useState<ChatGPTProgress | null>(null)
  const attemptMap = useMemo(() => new Map(data.attempts.map((attempt) => [attempt.id, attempt])), [data.attempts])
  const subjects = useMemo(() => [...new Set(data.attempts.map((attempt) => attempt.subject))].toSorted(), [data.attempts])
  const activeSubject = subject === "all" || subject === "unlinked" || subjects.includes(subject) ? subject : "all"
  const mathsSubject = activeSubject !== "all" ? activeSubject : subjects.length === 1 ? subjects[0] : null
  const showMathsExamFilter = mathsSubject !== null && isTechSplitMathsSubject(mathsSubject)
  const activeMathsExamFilter = showMathsExamFilter ? mathsExamFilter : "all"
  const visibleMistakes = useMemo(() => data.mistakes.filter((mistake) => {
    const attempt = attemptMap.get(mistake.attemptId)
    const matchesSubject = activeSubject === "all" || (activeSubject === "unlinked" ? !attempt : attempt?.subject === activeSubject)
    return matchesSubject && matchesMathsExamFilter(attempt, activeMathsExamFilter)
  }), [data.mistakes, attemptMap, activeSubject, activeMathsExamFilter])
  const dueIds = useMemo(() => new Set(getDueMistakes(visibleMistakes, now).map((mistake) => mistake.id)), [visibleMistakes, now])
  const counts = useMemo(() => getMistakeQueueCounts(visibleMistakes, now), [visibleMistakes, now])
  const progress = useMemo(() => getMistakeProgress(visibleMistakes), [visibleMistakes])
  // The summary counts the whole collection, the way the Exams page, the sidebar badge
  // and the folio app do. The subject, paper and exam filters only narrow the library,
  // the tabs and the review queue below the summary.
  const summaryCounts = useMemo(() => getMistakeQueueCounts(data.mistakes, now), [data.mistakes, now])
  const summaryProgress = useMemo(() => getMistakeProgress(data.mistakes), [data.mistakes])
  const topPriority = useMemo(() => buildRevisionPriorities(visibleMistakes).find((item) => item.unresolved > 0), [visibleMistakes])
  const alternativeCount = useMemo(() => data.alternativeMistakeDeck?.cards.filter((card) => visibleMistakes.some((mistake) => mistake.id === card.sourceMistakeId)).length ?? 0, [data.alternativeMistakeDeck, visibleMistakes])
  const autofillCandidates = useMemo(() => data.mistakes.filter(hasEmptyMistakeFields), [data.mistakes])
  const hasMergeableFields = useMemo(() => data.mistakes.some((mistake) => Boolean(mistake.areaOfStudy?.trim())), [data.mistakes])
  const browsedMistakes = useMemo(() => {
    return filterMistakeLibrary(visibleMistakes, attemptMap, dueIds, { search: deferredSearch, browserFilter, category, topic, sort, examId, provider, resolution })
  }, [visibleMistakes, attemptMap, dueIds, deferredSearch, browserFilter, category, topic, sort, examId, provider, resolution])
  const selectedMistakes = browsedMistakes.filter((mistake) => selected.has(mistake.id))
  // ponytail: the library renders at most this many rows; raise it when the list
  // pane gains virtualisation.
  const shownMistakes = browsedMistakes.slice(0, 48)
  const activeMistake = shownMistakes.find((mistake) => mistake.id === activeId) ?? null
  const worksheetMistakes = selectedMistakes.length ? selectedMistakes : browsedMistakes
  const categories = [...new Set(visibleMistakes.map((mistake) => mistake.category))].sort()
  const topics = [...new Set(visibleMistakes.flatMap((mistake) => mistake.areaOfStudy ? [mistake.areaOfStudy] : []))].sort()
  const visibleAttemptIds = new Set(visibleMistakes.map((mistake) => mistake.attemptId))
  const exams = data.attempts.filter((attempt) => visibleAttemptIds.has(attempt.id))
  const providers = [...new Set(exams.map((attempt) => attempt.provider))].filter(Boolean).sort()
  const activeFilterCount = [activeSubject !== "all", activeMathsExamFilter !== "all", Boolean(search), browserFilter !== "all", category !== "all", topic !== "all", examId !== "all", provider !== "all", resolution !== "all"].filter(Boolean).length
  function clearSelection() { setSelected(new Set()); setActiveId(null) }
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
          <DropdownMenuContent align="end">
            {AI_ENABLED ? <><DropdownMenuItem onClick={() => void autofillEmptyFields()} disabled={!autofillCandidates.length || autofilling}><Sparkles />Autofill empty fields{autofillCandidates.length ? ` (${autofillCandidates.length})` : ""}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setBulkEditOpen(true)} disabled={!data.mistakes.length}><Sparkles />Bulk edit with ChatGPT…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMergeOpen(true)} disabled={!hasMergeableFields}><Merge />Merge fields</DropdownMenuItem></> : null}
            <DropdownMenuItem onClick={() => setExportOpen(true)} disabled={!data.mistakes.length}><FileDown />Export…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRoundTripOpen(true)} disabled={!data.mistakes.length}><FileUp />Re-import edited JSON…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      {autofilling && autofillProgress ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground tabular-nums">{formatChatGPTProgress(autofillProgress)}</p> : null}
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-4"><div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BookOpenCheck className="size-5" /></div><div><p className="font-medium">{summaryCounts.due ? `${summaryCounts.due} ${summaryCounts.due === 1 ? "mistake" : "mistakes"} ready to review` : "You're caught up"}</p><p className="text-sm text-muted-foreground tabular-nums">{data.mistakes.length} saved · {summaryProgress.matureCards} mastered</p></div></div>
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
        <TabsContent value="study" className="mt-4"><StudyQueue key={`${activeSubject}:${activeMathsExamFilter}`} mistakes={visibleMistakes} attempts={data.attempts} studies={studies} onReview={onReview} onEdit={onEdit} onToggleSuspend={onToggleSuspend} onBrowse={() => setTab("browse")} /></TabsContent>
        <TabsContent value="schedule" className="mt-4 min-w-0">
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
                                {attempt?.subject ? <span className="break-words text-sm">{attempt.subject}</span> : !mistake.attemptId ? <span className="break-words text-sm">Uncategorised</span> : null}
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
              <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" value={search} onChange={(event) => { setSearch(event.target.value); clearSelection() }} placeholder="Search mistakes" aria-label="Search mistake cards" /></div>
              <div className="flex gap-2 sm:shrink-0">
              <Select value={browserFilter} onValueChange={(value) => { setBrowserFilter((value ?? "all") as BrowserFilter); clearSelection() }}>
                <SelectTrigger aria-label="Filter mistake cards by schedule"><SelectValue>{({ all: "All cards", due: "Due now", new: "New", learning: "Learning", review: "Review", mature: "Mature", suspended: "Reviews paused" } as Record<BrowserFilter, string>)[browserFilter]}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cards</SelectItem><SelectItem value="due">Due now</SelectItem><SelectItem value="new">New</SelectItem><SelectItem value="learning">Learning</SelectItem><SelectItem value="review">Review</SelectItem><SelectItem value="mature">Mature</SelectItem><SelectItem value="suspended">Reviews paused</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" className="flex-1 sm:flex-none" onClick={() => setShowFilters((open) => !open)} aria-expanded={showFilters}><SlidersHorizontal />Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}</Button>
              </div>
            </div>
            {showFilters ? <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/20 p-3">
              <Select items={[{ value: "all", label: "All exams" }, { value: "unlinked", label: "No linked exam" }, ...exams.map((exam) => ({ value: exam.id, label: `${exam.title} · ${exam.provider} · ${new Date(`${exam.completedAt}T00:00:00`).toLocaleDateString("en-AU")}` }))]} value={examId} onValueChange={(value) => { setExamId(value ?? "all"); clearSelection() }}><SelectTrigger className="w-full sm:w-auto sm:max-w-72" aria-label="Filter by linked exam"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All exams</SelectItem><SelectItem value="unlinked">No linked exam</SelectItem>{exams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.title} · {exam.provider} · {new Date(`${exam.completedAt}T00:00:00`).toLocaleDateString("en-AU")}</SelectItem>)}</SelectContent></Select>
              <Select value={provider} onValueChange={(value) => { setProvider(value ?? "all"); clearSelection() }}><SelectTrigger aria-label="Filter by exam provider"><SelectValue>{provider === "all" ? "All providers" : provider}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All providers</SelectItem>{providers.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
              <Select items={{ all: "All progress", unresolved: "Unresolved", resolved: "Resolved" }} value={resolution} onValueChange={(value) => { setResolution((value ?? "all") as typeof resolution); clearSelection() }}><SelectTrigger aria-label="Filter by resolution"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All progress</SelectItem><SelectItem value="unresolved">Unresolved</SelectItem><SelectItem value="resolved">Resolved</SelectItem></SelectContent></Select>
              <Select value={category} onValueChange={(value) => { setCategory(value ?? "all"); clearSelection() }}><SelectTrigger aria-label="Filter by mistake category"><SelectValue>{category === "all" ? "All categories" : category}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
              <Select value={topic} onValueChange={(value) => { setTopic(value ?? "all"); clearSelection() }}><SelectTrigger aria-label="Filter by topic"><SelectValue>{topic === "all" ? "All topics" : topic}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All topics</SelectItem>{topics.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
              <Select items={{ due: "Due date", newest: "Newest first", oldest: "Oldest first", marks: "Most marks lost", question: "Question order" }} value={sort} onValueChange={(value) => setSort(value ?? "due")}><SelectTrigger aria-label="Sort mistakes"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="due">Due date</SelectItem><SelectItem value="newest">Newest first</SelectItem><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="marks">Most marks lost</SelectItem><SelectItem value="question">Question order</SelectItem></SelectContent></Select>
              {activeFilterCount ? <Button size="sm" variant="ghost" onClick={clearAllFilters}><X />Clear filters</Button> : null}
            </div> : null}
            {browsedMistakes.length ? <>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground tabular-nums" role="status">{browsedMistakes.length} {browsedMistakes.length === 1 ? "mistake" : "mistakes"}{browsedMistakes.length !== visibleMistakes.length ? ` of ${visibleMistakes.length}` : ""}{shownMistakes.length < browsedMistakes.length ? ` · showing the first ${shownMistakes.length}` : ""}</span>
              <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-primary" disabled={!browsedMistakes.length} checked={browsedMistakes.length > 0 && selectedMistakes.length === browsedMistakes.length} ref={(node) => { if (node) node.indeterminate = selectedMistakes.length > 0 && selectedMistakes.length < browsedMistakes.length }} onChange={(event) => setSelected(event.target.checked ? new Set(browsedMistakes.map((mistake) => mistake.id)) : new Set())} />Select all</label><Button size="sm" variant="outline" disabled={!browsedMistakes.length} onClick={() => setPractice(worksheetMistakes)}><Play />{selectedMistakes.length ? `Practise selected (${selectedMistakes.length})` : "Practise"}</Button></div>
            </div>
            {selectedMistakes.length ? <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted p-3" aria-label="Selected card actions"><span className="mr-auto text-sm font-medium tabular-nums">{selectedMistakes.length} selected</span><Button size="sm" variant="outline" disabled={selectedMistakes.every((mistake) => mistake.suspended)} onClick={() => { onSetSuspended(selectedMistakes.map((mistake) => mistake.id), true); setSelected(new Set()) }}>Pause reviews</Button><Button size="sm" variant="outline" disabled={selectedMistakes.every((mistake) => !mistake.suspended)} onClick={() => { onSetSuspended(selectedMistakes.map((mistake) => mistake.id), false); setSelected(new Set()) }}>Resume reviews</Button>{AI_ENABLED ? <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}><Sparkles />Edit with ChatGPT</Button> : null}<Button size="sm" variant="outline" onClick={() => setExportOpen(true)}><FileDown />Export selected</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X />Clear selection</Button></div> : null}
            <div className="grid items-start gap-4 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
              {/* The list scrolls inside its own sticky pane so the reading pane keeps
                  its own vertical rhythm instead of inheriting forty rows of scroll. */}
              <ol className="grid min-w-0 content-start gap-0.5 lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)] lg:overflow-y-auto lg:pr-1">
                {shownMistakes.map((mistake) => <BrowseRow key={mistake.id} mistake={mistake} now={now} active={mistake.id === activeId} selected={selected.has(mistake.id)} onOpen={() => setActiveId(mistake.id === activeId ? null : mistake.id)} onSelect={() => toggleSelected(mistake.id)} />)}
                {!isWorkspace && activeMistake ? <li className="mt-2"><MistakeDetail mistake={activeMistake} attempt={attemptMap.get(activeMistake.attemptId)} studies={studies} onEdit={onEdit} onToggleSuspend={onToggleSuspend} onDelete={onDelete} onPractice={(target) => setPractice([target])} /></li> : null}
              </ol>
              {isWorkspace ? (activeMistake
                ? <MistakeDetail mistake={activeMistake} attempt={attemptMap.get(activeMistake.attemptId)} studies={studies} onEdit={onEdit} onToggleSuspend={onToggleSuspend} onDelete={onDelete} onPractice={(target) => setPractice([target])} />
                : <div className="grid min-h-[26rem] place-items-center rounded-xl border border-dashed p-10">
                    <div className="grid max-w-sm justify-items-center gap-2 text-center">
                      <NotebookPen className="size-6 text-muted-foreground" />
                      <p className="text-sm font-medium">Select a card to read it here</p>
                      <p className="text-sm text-pretty text-muted-foreground">The question, what went wrong and the improved method open beside the list, with your maths typeset as you wrote it.</p>
                    </div>
                  </div>) : null}
            </div>
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
      {exportOpen ? <MistakeExportDialog mistakes={data.mistakes} current={worksheetMistakes} attempts={data.attempts} onOpenChange={setExportOpen} /> : null}
      {roundTripOpen ? <MistakeRoundTripDialog mistakes={data.mistakes} onOpenChange={setRoundTripOpen} onApply={(edits) => { onApplyEdits(edits); toast.success(`Updated ${edits.length} ${edits.length === 1 ? "mistake" : "mistakes"}`) }} /> : null}
      {bulkEditOpen ? <MistakeBulkEditDialog mistakes={data.mistakes} current={browsedMistakes} selected={selectedMistakes} attempts={data.attempts} onOpenChange={setBulkEditOpen} onApply={onApplyEdits} /> : null}
      {mergeOpen ? <MistakeFieldMergeDialog mistakes={data.mistakes} onOpenChange={setMergeOpen} onApply={onApplyMergePlan} /> : null}
    </div>
  )
}
