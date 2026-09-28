import { memo, useDeferredValue, useEffect, useMemo, useState } from "react"
import { ArrowRight, BookOpenCheck, FileDown, FileJson, Merge, MoreHorizontal, NotebookPen, Play, Plus, Search, Shuffle, SkipForward, SlidersHorizontal, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import { filterMistakeLibrary, type BrowserFilter } from "@/lib/mistake-library"
import { MistakePractice } from "@/components/mistake-practice"
import { MarkdownPreview } from "@/components/markdown-preview"
import { MistakeAttachments } from "@/components/mistake-attachments"
import { MistakeAlternativeDeck } from "@/components/mistake-alternative-deck"
import { MistakeJsonImportDialog } from "@/components/mistake-json-import"
import { MistakeInsights } from "@/components/mistake-insights"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  getDueMistakes,
  getMistakeSchedule,
  previewMistakeReview,
  type AppData,
  type ExamAttempt,
  type Mistake,
  type MistakeReviewState,
  type ReviewRating,
} from "@/lib/exam-data"
import { downloadMistakesPdf } from "@/lib/mistake-pdf"
import { isTechSplitMathsSubject, matchesMathsExamFilter, type MathsExamFilter } from "@/lib/mistake-filters"
import { buildRevisionPriorities, formatReviewInterval, getMistakeProgress, getMistakeQueueCounts } from "@/lib/mistake-review"
import {
  getMistakeFieldValues,
  hasEmptyMistakeFields,
  countMistakeFieldMergePlan,
  summarizeMistakeAutofills,
  type MistakeAutofill,
  type MistakeFieldMergePlan,
  type MistakeMergeField,
} from "@/lib/mistake-autofill"
import { formatChatGPTProgress, type ChatGPTProgress } from "@/lib/mistake-ai-core"
import { findCachedVcaaExamForAttempt, type VcaaStudyResources } from "@/lib/vcaa-resources"


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
  onSaveInsights: (insights: NonNullable<AppData["mistakeInsights"]>) => void
  onSaveAlternativeDeck: (deck: NonNullable<AppData["alternativeMistakeDeck"]>) => void
}

const RATING_OPTIONS: { rating: ReviewRating; label: string; shortcut: string; variant: "destructive" | "outline" | "secondary" | "default" }[] = [
  { rating: "again", label: "Again", shortcut: "1", variant: "destructive" },
  { rating: "hard", label: "Hard", shortcut: "2", variant: "outline" },
  { rating: "good", label: "Good", shortcut: "3", variant: "secondary" },
  { rating: "easy", label: "Easy", shortcut: "4", variant: "default" },
]

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
      {attempt ? <>{attempt.title} · {attempt.paper}{exam ? <> · <a className="font-medium text-foreground underline underline-offset-4" href={exam.url} target="_blank" rel="noreferrer">Exam PDF</a></> : null}</> : "Deleted exam"}
      {mistake.totalMarks !== undefined && mistake.marksLost !== undefined ? <> · {mistake.marksLost}/{mistake.totalMarks} marks lost</> : null}
    </CardDescription>
  )
}

function ReviewCard({ mistake, attempt, studies, onRate }: { mistake: Mistake; attempt?: ExamAttempt; studies: VcaaStudyResources[]; onRate: (rating: ReviewRating) => void }) {
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
    <Card className="mx-auto w-full max-w-4xl" aria-live="polite">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{mistake.question}</CardTitle>
            <ExamContext mistake={mistake} attempt={attempt} studies={studies} />
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge variant="secondary">{stateLabel(schedule.state, schedule.resolved)}</Badge>
            <Badge variant="outline">{mistake.category}</Badge>
            {mistake.areaOfStudy ? <Badge variant="outline">{mistake.areaOfStudy}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid min-h-80 content-start gap-6">
        <section>
          <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Question</p>
          <MarkdownPreview>{mistake.questionText?.trim() || mistake.question}</MarkdownPreview>
          <MistakeAttachments attachments={mistake.attachments} />
        </section>
        {revealed ? <>
          <Separator />
          <section className="grid gap-5">
            <div><p className="mb-2 text-sm font-medium">What went wrong</p><MarkdownPreview>{mistake.explanation}</MarkdownPreview></div>
            <div><p className="mb-2 text-sm font-medium">Improved response or method</p><MarkdownPreview>{mistake.correction}</MarkdownPreview></div>
            {mistake.criterion ? <div><p className="mb-2 text-sm font-medium">Assessment criterion</p><MarkdownPreview>{mistake.criterion}</MarkdownPreview></div> : null}
          </section>
        </> : null}
      </CardContent>
      <CardFooter className="block">
        {!revealed ? (
          <div className="flex flex-col items-center gap-2">
            <Button size="lg" onClick={() => setRevealed(true)}>Show answer</Button>
            <p className="text-xs text-muted-foreground">Space or Enter</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {RATING_OPTIONS.map((option) => (
              <Button key={option.rating} variant={option.variant} className="h-auto flex-col gap-0.5 py-2" disabled={submitting} onClick={() => rate(option.rating)}>
                <span>{option.label} <span className="text-xs opacity-60">{option.shortcut}</span></span>
                <span className="text-xs font-normal opacity-70">{formatReviewInterval(previews[option.rating].dueAt)}</span>
              </Button>
            ))}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}

function StudyQueue({ mistakes, attempts, studies, onReview, onBrowse, onEdit, onToggleSuspend }: { onEdit: (mistake: Mistake) => void; onToggleSuspend: (mistake: Mistake) => void; mistakes: Mistake[]; attempts: ExamAttempt[]; studies: VcaaStudyResources[]; onReview: (mistake: Mistake, rating: ReviewRating) => void; onBrowse: () => void }) {
  const [reviewed, setReviewed] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const attemptMap = useMemo(() => new Map(attempts.map((attempt) => [attempt.id, attempt])), [attempts])
  const due = getDueMistakes(mistakes, now)
  const dueIdKey = due.map((mistake) => mistake.id).join("\u0000")
  const [queueIds, setQueueIds] = useState(() => due.map((mistake) => mistake.id))
  const dueMap = new Map(due.map((mistake) => [mistake.id, mistake]))
  const current = queueIds.map((id) => dueMap.get(id)).find((mistake) => mistake !== undefined)
  const counts = getMistakeQueueCounts(mistakes, now)
  const nextScheduled = mistakes
    .filter((mistake) => !mistake.suspended && !due.some((dueMistake) => dueMistake.id === mistake.id))
    .map((mistake) => getMistakeSchedule(mistake).dueAt)
    .toSorted()[0]
  const sessionTotal = reviewed + due.length

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const nextDueIds = dueIdKey ? dueIdKey.split("\u0000") : []
    const nextDueIdSet = new Set(nextDueIds)
    setQueueIds((currentIds) => [
      ...currentIds.filter((id) => nextDueIdSet.has(id)),
      ...nextDueIds.filter((id) => !currentIds.includes(id)),
    ])
  }, [dueIdKey])

  function rate(rating: ReviewRating) {
    if (!current) return
    onReview(current, rating)
    setQueueIds((ids) => ids.filter((id) => id !== current.id))
    setReviewed((value) => value + 1)
  }

  function shuffleQueue() {
    setQueueIds((ids) => {
      const shuffled = [...ids]
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
        ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
      }
      return shuffled
    })
  }

  function skipCard() {
    setQueueIds((ids) => ids.length > 1 ? [...ids.slice(1), ids[0]] : ids)
  }

  if (!current) {
    return (
      <Empty className="min-h-96 border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><BookOpenCheck /></EmptyMedia>
          <EmptyTitle>{reviewed ? "Review complete" : "Nothing due right now"}</EmptyTitle>
          <EmptyDescription>{nextScheduled ? `Next card is due in ${formatReviewInterval(nextScheduled, now)}.` : mistakes.length ? "All active cards are reviewed." : "Log a mistake after your next practice exam to create your first card."}</EmptyDescription>
        </EmptyHeader>
        {mistakes.length ? <Button variant="outline" onClick={onBrowse}>Browse cards</Button> : null}
      </Empty>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="mx-auto grid w-full max-w-4xl gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            <span className="font-medium">Study session</span>
            <span className="ml-2 text-muted-foreground">{reviewed} reviewed · {due.length} remaining</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onBrowse}>End session</Button>
            <Button size="sm" variant="outline" onClick={shuffleQueue} disabled={due.length < 2}><Shuffle />Shuffle</Button>
            <Button size="sm" variant="outline" onClick={skipCard} disabled={due.length < 2}><SkipForward />Skip</Button>
          </div>
        </div>
        <Progress value={sessionTotal ? reviewed / sessionTotal * 100 : 0} />
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span><span className="font-medium text-foreground tabular-nums">{counts.new}</span> new</span>
          <span><span className="font-medium text-foreground tabular-nums">{counts.learning + counts.relearning}</span> learning</span>
          <span><span className="font-medium text-foreground tabular-nums">{counts.review}</span> review</span>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-4xl flex-wrap justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => onEdit(current)}>Edit this card</Button><Button size="sm" variant="ghost" onClick={() => onToggleSuspend(current)}>Pause this card</Button></div>
      <ReviewCard key={current.id + current.updatedAt} mistake={current} attempt={attemptMap.get(current.attemptId)} studies={studies} onRate={rate} />
    </div>
  )
}

function BrowseCardInner({ mistake, attempt, studies, onEdit, onToggleSuspend, onDelete, selected, onSelect, onPractice }: { selected: boolean; onSelect: () => void; onPractice: () => void; mistake: Mistake; attempt?: ExamAttempt; studies: VcaaStudyResources[]; onEdit: (mistake: Mistake) => void; onToggleSuspend: (mistake: Mistake) => void; onDelete: (mistake: Mistake) => void }) {
  const schedule = getMistakeSchedule(mistake)
  const isDue = !mistake.suspended && new Date(schedule.dueAt).getTime() <= Date.now()
  return (
    <article className={"min-w-0 rounded-xl border bg-card p-4 transition-colors sm:p-5 " + (selected ? "border-primary bg-primary/5" : "hover:border-foreground/20")}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={"Select " + mistake.question} className="mt-1 size-4 shrink-0 accent-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0"><h3 className="font-medium leading-snug"><button type="button" className="text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onEdit(mistake)}>{mistake.question}</button></h3><ExamContext mistake={mistake} attempt={attempt} studies={studies} /></div>
            <span className={"shrink-0 rounded-full px-2 py-0.5 text-xs font-medium " + (isDue ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{mistake.suspended ? "Paused" : isDue ? "Due now" : `Due ${formatDueDate(schedule.dueAt)}`}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{mistake.questionText?.trim() || mistake.explanation || mistake.question}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{mistake.category}</span>{mistake.areaOfStudy ? <span>{mistake.areaOfStudy}</span> : null}<span>{stateLabel(schedule.state, schedule.resolved)}</span></div>
          <MistakeAttachments attachments={mistake.attachments} compact />
          <div className="mt-3"><MistakeAnswerDetails mistake={mistake} /></div>
          <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={onPractice}><Play />Practise</Button><Button size="sm" variant="ghost" onClick={() => onEdit(mistake)}>Edit</Button><DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`More actions for ${mistake.question}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onToggleSuspend(mistake)}>{mistake.suspended ? "Resume reviews" : "Pause reviews"}</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => onDelete(mistake)}>Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
        </div>
      </div>
    </article>
  )
}

const BrowseCard = memo(BrowseCardInner)

// KaTeX + markdown parsing is the single most expensive synchronous cost on
// this page. Only pay it when the user expands a card's answer section.
function MistakeAnswerDetails({ mistake }: { mistake: Mistake }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="rounded-lg border" onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">Answer and review history</summary>
      <div className="grid gap-4 border-t p-3">
        <div><p className="mb-2 text-sm font-medium">What went wrong</p>{open ? <MarkdownPreview>{mistake.explanation}</MarkdownPreview> : <p className="text-sm text-muted-foreground">Expand to render formatting and maths.</p>}</div>
        <div><p className="mb-2 text-sm font-medium">Improved response or method</p>{open ? <MarkdownPreview>{mistake.correction}</MarkdownPreview> : null}</div>
        {mistake.reviewHistory?.length ? <div>
          <p className="mb-2 text-sm font-medium">Recent reviews</p>
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {mistake.reviewHistory.toReversed().slice(0, 5).map((review) => <li key={review.id}>{new Date(review.completedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} · {review.result}{review.intervalDays === undefined ? "" : ` · ${review.intervalDays}d interval`}</li>)}
          </ul>
        </div> : null}
      </div>
    </details>
  )
}

const MERGE_FIELD_LABELS: Record<MistakeMergeField, string> = {
  areaOfStudy: "Topic / Area of Study",
  criterion: "Assessment criterion",
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
      const { generateMistakeFieldMergePlan } = await import("@/lib/mistake-ai")
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
                <SelectItem value="criterion">Assessment criterion</SelectItem>
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

export function MistakesPage({ data, studies, onLog, onEdit, onReview, onToggleSuspend, onSetSuspended, onDelete, onImportMistakes, onApplyAutofills, onApplyMergePlan, onSaveInsights, onSaveAlternativeDeck }: MistakesPageProps) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer) }, [])
  const [subject, setSubject] = useState("all")
  const [mathsExamFilter, setMathsExamFilter] = useState<MathsExamFilter>("all")
  const [tab, setTab] = useState<PageTab>("browse")
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [browserFilter, setBrowserFilter] = useState<BrowserFilter>("all")
  const [category, setCategory] = useState("all")
  const [topic, setTopic] = useState("all")
  const [sort, setSort] = useState("due")
  const [showFilters, setShowFilters] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [practice, setPractice] = useState<Mistake[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [autofilling, setAutofilling] = useState(false)
  const [autofillProgress, setAutofillProgress] = useState<ChatGPTProgress | null>(null)
  const attemptMap = useMemo(() => new Map(data.attempts.map((attempt) => [attempt.id, attempt])), [data.attempts])
  const subjects = useMemo(() => [...new Set(data.attempts.map((attempt) => attempt.subject))].toSorted(), [data.attempts])
  const activeSubject = subject === "all" || subjects.includes(subject) ? subject : "all"
  const mathsSubject = activeSubject !== "all" ? activeSubject : subjects.length === 1 ? subjects[0] : null
  const showMathsExamFilter = mathsSubject !== null && isTechSplitMathsSubject(mathsSubject)
  const activeMathsExamFilter = showMathsExamFilter ? mathsExamFilter : "all"
  const visibleMistakes = useMemo(() => data.mistakes.filter((mistake) => {
    const attempt = attemptMap.get(mistake.attemptId)
    const matchesSubject = activeSubject === "all" || attempt?.subject === activeSubject
    return matchesSubject && matchesMathsExamFilter(attempt, activeMathsExamFilter)
  }), [data.mistakes, attemptMap, activeSubject, activeMathsExamFilter])
  const dueIds = useMemo(() => new Set(getDueMistakes(visibleMistakes, now).map((mistake) => mistake.id)), [visibleMistakes, now])
  const counts = useMemo(() => getMistakeQueueCounts(visibleMistakes, now), [visibleMistakes, now])
  const progress = useMemo(() => getMistakeProgress(visibleMistakes), [visibleMistakes])
  const topPriority = useMemo(() => buildRevisionPriorities(visibleMistakes).find((item) => item.unresolved > 0), [visibleMistakes])
  const alternativeCount = useMemo(() => data.alternativeMistakeDeck?.cards.filter((card) => visibleMistakes.some((mistake) => mistake.id === card.sourceMistakeId)).length ?? 0, [data.alternativeMistakeDeck, visibleMistakes])
  const autofillCandidates = useMemo(() => data.mistakes.filter(hasEmptyMistakeFields), [data.mistakes])
  const hasMergeableFields = useMemo(() => data.mistakes.some((mistake) => Boolean(mistake.areaOfStudy?.trim() || mistake.criterion?.trim())), [data.mistakes])
  const browsedMistakes = useMemo(() => {
    return filterMistakeLibrary(visibleMistakes, attemptMap, dueIds, { search: deferredSearch, browserFilter, category, topic, sort })
  }, [visibleMistakes, attemptMap, dueIds, deferredSearch, browserFilter, category, topic, sort])
  const selectedMistakes = browsedMistakes.filter((mistake) => selected.has(mistake.id))
  const worksheetMistakes = selectedMistakes.length ? selectedMistakes : browsedMistakes
  const categories = [...new Set(visibleMistakes.map((mistake) => mistake.category))].sort()
  const topics = [...new Set(visibleMistakes.flatMap((mistake) => mistake.areaOfStudy ? [mistake.areaOfStudy] : []))].sort()
  function resetFilters() { setSearch(""); setCategory("all"); setTopic("all"); setBrowserFilter("all"); setSelected(new Set()) }
  function toggleSelected(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  const scheduleGroups = useMemo(() => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const dayMs = 24 * 60 * 60 * 1000
    const upcoming = visibleMistakes
      .filter((mistake) => !mistake.suspended)
      .map((mistake) => ({ mistake, schedule: getMistakeSchedule(mistake) }))
      .toSorted((first, second) => first.schedule.dueAt.localeCompare(second.schedule.dueAt))
    const groups = new Map<string, { key: string; label: string; overdue: boolean; items: typeof upcoming }>()
    for (const entry of upcoming) {
      const dueDate = new Date(entry.schedule.dueAt)
      const dayIndex = Math.floor((new Date(dueDate).setHours(0, 0, 0, 0) - startOfToday.getTime()) / dayMs)
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
  }, [visibleMistakes])
  const dueThisWeekCount = useMemo(() => {
    const horizon = Date.now() + 7 * 24 * 60 * 60 * 1000
    return visibleMistakes.filter((mistake) => !mistake.suspended && new Date(getMistakeSchedule(mistake).dueAt).getTime() <= horizon).length
  }, [visibleMistakes])

  async function exportWorksheet() {
    setExporting(true)
    try {
      await downloadMistakesPdf(worksheetMistakes, data.attempts, activeSubject === "all" ? "mistakes" : activeSubject)
      toast.success("Worksheet downloaded")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export worksheet.")
    } finally {
      setExporting(false)
    }
  }

  async function autofillEmptyFields() {
    setAutofilling(true)
    setAutofillProgress(null)
    try {
      const { autofillMistakeFields } = await import("@/lib/mistake-ai")
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
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader title="Mistakes" description="Review and practise missed questions.">
        <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!data.attempts.length}><FileJson />Import from chatbot</Button>
        <Button onClick={onLog} disabled={!data.attempts.length}><Plus />Add mistake</Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More mistake tools" />}><MoreHorizontal /></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void autofillEmptyFields()} disabled={!autofillCandidates.length || autofilling}><Sparkles />Autofill empty fields{autofillCandidates.length ? ` (${autofillCandidates.length})` : ""}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMergeOpen(true)} disabled={!hasMergeableFields}><Merge />Merge fields</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void exportWorksheet()} disabled={!worksheetMistakes.length || exporting}><FileDown />{exporting ? "Creating PDF…" : "Export worksheet"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      {autofilling && autofillProgress ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground tabular-nums">{formatChatGPTProgress(autofillProgress)}</p> : null}
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-4"><div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BookOpenCheck className="size-5" /></div><div><p className="font-medium">{counts.due ? `${counts.due} ${counts.due === 1 ? "mistake" : "mistakes"} ready to review` : "You're caught up"}</p><p className="text-sm text-muted-foreground">{visibleMistakes.length} saved · {progress.matureCards} mastered</p></div></div>
        <Button variant={counts.due ? "default" : "outline"} onClick={() => setTab("study")}>Review now<ArrowRight /></Button>
      </section>
      {subjects.length > 1 || showMathsExamFilter ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">Showing</span>{subjects.length > 1 ? <Select value={activeSubject} onValueChange={(value) => { setSubject(value ?? "all"); setMathsExamFilter("all"); resetFilters() }}><SelectTrigger aria-label="Filter mistake cards by subject"><SelectValue>{activeSubject === "all" ? "All subjects" : activeSubject}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All subjects</SelectItem>{subjects.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select> : null}{showMathsExamFilter ? <Select value={activeMathsExamFilter} onValueChange={(value) => { setMathsExamFilter((value ?? "all") as MathsExamFilter); resetFilters() }}><SelectTrigger aria-label="Filter maths mistake cards by exam"><SelectValue>{activeMathsExamFilter === "all" ? "All exams" : activeMathsExamFilter === "exam-1" ? "Exam 1 · Tech-free" : "Exam 2 · Tech-active"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All exams</SelectItem><SelectItem value="exam-1">Exam 1 · Tech-free</SelectItem><SelectItem value="exam-2">Exam 2 · Tech-active</SelectItem></SelectContent></Select> : null}</div> : null}
      <Tabs value={tab} onValueChange={(value) => setTab(value as PageTab)}>
        <TabsList variant="line" className="h-auto! w-full! flex-wrap justify-start gap-2 border-b pb-2">
          <TabsTrigger value="browse" className="flex-none px-3">Library</TabsTrigger>
          <TabsTrigger value="study" className="flex-none px-3">Review{counts.due ? ` (${counts.due})` : ""}</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="alternative">Alternatives{alternativeCount ? ` (${alternativeCount})` : ""}</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>
        <TabsContent value="insights" className="mt-4 grid gap-4">
          <Card><CardHeader><CardTitle>Your progress</CardTitle><CardDescription>{progress.matureCards} of {progress.activeCards} active cards have reached a 21+ day interval.</CardDescription></CardHeader><CardContent className="grid gap-4"><Progress value={progress.masteryPercent} aria-label="Mistake mastery" /><div className="grid grid-cols-3 gap-4"><div><p className="text-2xl font-semibold">{Math.round(progress.masteryPercent)}%</p><p className="text-xs text-muted-foreground">Mastery</p></div><div><p className="text-2xl font-semibold">{progress.recallRate === null ? "—" : Math.round(progress.recallRate) + "%"}</p><p className="text-xs text-muted-foreground">Recall · last 30 days</p></div><div><p className="text-2xl font-semibold">{progress.reviewsCompleted}</p><p className="text-xs text-muted-foreground">Reviews · last 30 days</p></div></div></CardContent></Card>
          <MistakeInsights data={data} priorityCategory={topPriority?.category} onSave={onSaveInsights} />
        </TabsContent>
        <TabsContent value="study" className="mt-4"><StudyQueue key={`${activeSubject}:${activeMathsExamFilter}`} mistakes={visibleMistakes} attempts={data.attempts} studies={studies} onReview={onReview} onEdit={onEdit} onToggleSuspend={onToggleSuspend} onBrowse={() => setTab("browse")} /></TabsContent>
        <TabsContent value="schedule" className="mt-4">
          {scheduleGroups.length ? (
            <div className="grid gap-6">
              <p className="text-sm text-muted-foreground">{dueThisWeekCount
                ? `${dueThisWeekCount} card${dueThisWeekCount === 1 ? "" : "s"} to review in the next 7 days.`
                : "Nothing scheduled for the next week — log mistakes after your next timed paper."}</p>
              {scheduleGroups.map((group) => (
                <section key={group.key} className="grid gap-2" aria-label={`Reviews due ${group.label.toLowerCase()}`}>
                  <div className="flex items-center gap-2">
                    <h3 className={group.overdue ? "text-sm font-semibold text-destructive" : "text-sm font-semibold"}>{group.label}</h3>
                    <Badge variant={group.overdue ? "destructive" : "secondary"}>{group.items.length}</Badge>
                  </div>
                  <div className="grid gap-2">
                    {group.items.map(({ mistake }) => {
                      const attempt = attemptMap.get(mistake.attemptId)
                      return (
                        <button
                          key={mistake.id}
                          type="button"
                          onClick={() => onEdit(mistake)}
                          className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                        >
                          <span className="truncate text-sm font-medium">{mistake.question}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {[attempt?.subject, attempt?.title, stateLabel(getMistakeSchedule(mistake).state, Boolean(mistake.resolved))].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <Empty className="min-h-64 border"><EmptyHeader><EmptyMedia variant="icon"><NotebookPen /></EmptyMedia><EmptyTitle>No reviews scheduled</EmptyTitle><EmptyDescription>Cards appear here once mistakes are logged and reviewed.</EmptyDescription></EmptyHeader></Empty>
          )}
        </TabsContent>
        <TabsContent value="alternative" className="mt-4"><MistakeAlternativeDeck key={`${activeSubject}:${activeMathsExamFilter}`} mistakes={visibleMistakes} allMistakes={data.mistakes} attempts={data.attempts} deck={data.alternativeMistakeDeck} onSave={onSaveAlternativeDeck} /></TabsContent>
        <TabsContent value="browse" className="mt-4">
          <div className="grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" value={search} onChange={(event) => { setSearch(event.target.value); setSelected(new Set()) }} placeholder="Search mistakes" aria-label="Search mistake cards" /></div>
              <Select value={browserFilter} onValueChange={(value) => { setBrowserFilter((value ?? "all") as BrowserFilter); setSelected(new Set()) }}>
                <SelectTrigger aria-label="Filter mistake cards by schedule"><SelectValue>{({ all: "All cards", due: "Due now", new: "New", learning: "Learning", review: "Review", mature: "Mature", suspended: "Paused" } as Record<BrowserFilter, string>)[browserFilter]}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cards</SelectItem><SelectItem value="due">Due now</SelectItem><SelectItem value="new">New</SelectItem><SelectItem value="learning">Learning</SelectItem><SelectItem value="review">Review</SelectItem><SelectItem value="mature">Mature</SelectItem><SelectItem value="suspended">Reviews paused</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" onClick={() => setShowFilters((open) => !open)} aria-expanded={showFilters}><SlidersHorizontal />Filters</Button>
            </div>
            {showFilters ? <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/20 p-3">
              <Select value={category} onValueChange={(value) => { setCategory(value ?? "all"); setSelected(new Set()) }}><SelectTrigger aria-label="Filter by mistake category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
              <Select value={topic} onValueChange={(value) => { setTopic(value ?? "all"); setSelected(new Set()) }}><SelectTrigger aria-label="Filter by topic"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All topics</SelectItem>{topics.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
              <Select value={sort} onValueChange={(value) => setSort(value ?? "due")}><SelectTrigger aria-label="Sort mistakes"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="due">Due date</SelectItem><SelectItem value="newest">Newest first</SelectItem><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="marks">Most marks lost</SelectItem><SelectItem value="question">Question order</SelectItem></SelectContent></Select>
              {search || category !== "all" || topic !== "all" || browserFilter !== "all" ? <Button size="sm" variant="ghost" onClick={resetFilters}><X />Clear filters</Button> : null}
            </div> : null}
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground" role="status">{browsedMistakes.length} {browsedMistakes.length === 1 ? "mistake" : "mistakes"}{browsedMistakes.length !== visibleMistakes.length ? ` of ${visibleMistakes.length}` : ""}</span>
              <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-primary" disabled={!browsedMistakes.length} checked={browsedMistakes.length > 0 && selectedMistakes.length === browsedMistakes.length} ref={(node) => { if (node) node.indeterminate = selectedMistakes.length > 0 && selectedMistakes.length < browsedMistakes.length }} onChange={(event) => setSelected(event.target.checked ? new Set(browsedMistakes.map((mistake) => mistake.id)) : new Set())} />Select all</label><Button size="sm" variant="outline" disabled={!browsedMistakes.length} onClick={() => setPractice(worksheetMistakes)}><Play />{selectedMistakes.length ? `Practise selected (${selectedMistakes.length})` : "Practise"}</Button></div>
            </div>
            {selectedMistakes.length ? <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-muted p-3" aria-label="Selected card actions"><span className="mr-auto text-sm font-medium">{selectedMistakes.length} selected</span><Button size="sm" variant="outline" disabled={selectedMistakes.every((mistake) => mistake.suspended)} onClick={() => { onSetSuspended(selectedMistakes.map((mistake) => mistake.id), true); setSelected(new Set()) }}>Pause reviews</Button><Button size="sm" variant="outline" disabled={selectedMistakes.every((mistake) => !mistake.suspended)} onClick={() => { onSetSuspended(selectedMistakes.map((mistake) => mistake.id), false); setSelected(new Set()) }}>Resume reviews</Button><Button size="sm" variant="outline" disabled={exporting} onClick={() => void exportWorksheet()}><FileDown />{exporting ? "Exporting…" : "Export selected"}</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X />Clear selection</Button></div> : null}
            {browsedMistakes.length ? <div className="grid gap-2">{browsedMistakes.slice(0, 48).map((mistake) => <BrowseCard key={mistake.id} mistake={mistake} attempt={attemptMap.get(mistake.attemptId)} studies={studies} onEdit={onEdit} onToggleSuspend={onToggleSuspend} onDelete={onDelete} selected={selected.has(mistake.id)} onSelect={() => toggleSelected(mistake.id)} onPractice={() => setPractice([mistake])} />)}</div> : <Empty className="min-h-64 rounded-xl border border-dashed"><EmptyHeader><EmptyMedia variant="icon"><NotebookPen /></EmptyMedia><EmptyTitle>{data.mistakes.length ? "No matching mistakes" : "No mistakes yet"}</EmptyTitle><EmptyDescription>{data.mistakes.length ? "Try another search or clear your filters." : data.attempts.length ? "Save a missed question here to review it later." : "Add an exam first, then save the questions you want to improve."}</EmptyDescription></EmptyHeader>{data.mistakes.length ? <Button variant="outline" onClick={() => { resetFilters(); setSubject("all"); setMathsExamFilter("all") }}>Clear filters</Button> : <Button onClick={onLog} disabled={!data.attempts.length}><Plus />Add mistake</Button>}</Empty>}
            {browsedMistakes.length > 48 ? <p className="text-center text-xs text-muted-foreground">Showing 48 of {browsedMistakes.length} cards — refine the search to narrow the list.</p> : null}
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
      {mergeOpen ? <MistakeFieldMergeDialog mistakes={data.mistakes} onOpenChange={setMergeOpen} onApply={onApplyMergePlan} /> : null}
    </div>
  )
}
