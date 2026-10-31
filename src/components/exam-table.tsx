import { Fragment, lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, ChevronsUpDown, CircleAlert, MoreHorizontal } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Skeleton } from "./ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { analyseAttempt, findAttemptReferenceForYear, type AssessmentReference, type ExamAttempt } from "../lib/exam-data"
import { compareExamRows, type ExamSortKey, type SortDirection } from "../lib/exam-sort"
import { getExamIdFromHash, getExamTarget } from "../lib/exam-target"
import { formatTimer } from "../lib/exam-timer"

const AttemptDistributionChart = lazy(() =>
  import("./attempt-distribution-chart").then((module) => ({ default: module.AttemptDistributionChart })),
)

function SortableHead({ column, label, sortKey, direction, onSort }: {
  column: ExamSortKey
  label: string
  sortKey: ExamSortKey
  direction: SortDirection
  onSort: (column: ExamSortKey) => void
}) {
  const active = sortKey === column
  return (
    <TableHead aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => onSort(column)}>
        {label}
        {active ? (direction === "asc" ? <ChevronUp /> : <ChevronDown />) : <ChevronsUpDown />}
      </Button>
    </TableHead>
  )
}

export function ExamTable({
  attempts,
  references,
  comparisonYear,
  onComparisonYearChange,
  onEdit,
  onAddMistake,
  onDelete,
}: {
  attempts: ExamAttempt[]
  references: AssessmentReference[]
  comparisonYear: number
  onComparisonYearChange: (year: number) => void
  onEdit: (attempt: ExamAttempt) => void
  onAddMistake: (attemptId: string) => void
  onDelete: (attempt: ExamAttempt) => void
}) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(60)
  const [sort, setSort] = useState<{ key: ExamSortKey, direction: SortDirection }>({ key: "completedAt", direction: "desc" })
  const comparisonYears = useMemo(
    () => [...new Set(references.map((reference) => reference.year))].toSorted((a, b) => b - a),
    [references],
  )
  const analysedRows = useMemo(() => attempts.map((attempt) => {
    const reference = findAttemptReferenceForYear(attempt, references, comparisonYear)
    return { attempt, reference, analysis: analyseAttempt(attempt, reference) }
  }), [attempts, references, comparisonYear])
  const rows = useMemo(() => {
    const terms = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return analysedRows
      .filter(({ attempt }) => terms.every((term) => `${attempt.title} ${attempt.subject} ${attempt.provider} ${attempt.paper} ${attempt.examYear} ${attempt.completedAt}`.toLowerCase().includes(term)))
      .toSorted((left, right) => compareExamRows(left, right, sort.key, sort.direction))
  },
  [analysedRows, deferredQuery, sort])
  // ponytail: reveal more on demand; virtualise if continuous scrolling is needed.
  const shownRows = rows.slice(0, Math.max(visibleCount, rows.findIndex(({ attempt }) => attempt.id === expandedId) + 1))
  const handleSort = (key: ExamSortKey) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
  }))
  useEffect(() => {
    const revealTarget = () => {
      const id = getExamIdFromHash(window.location.hash)
      if (id && attempts.some((attempt) => attempt.id === id)) {
        setQuery("")
        setExpandedId(id)
      }
    }
    revealTarget()
    window.addEventListener("hashchange", revealTarget)
    return () => window.removeEventListener("hashchange", revealTarget)
  }, [attempts])

  return (
    <>
      <section id="all-exams" aria-labelledby="all-exams-title" className="grid scroll-mt-20 gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="all-exams-title" className="focal-section-title">All exams</h2>
            <p className="max-w-[68ch] text-sm text-muted-foreground text-pretty">Search, edit, log mistakes, or expand a row for its VCAA distribution. Scroll sideways to reach every column on a narrow screen.</p>
          </div>
          <Input type="search" className="w-full sm:w-80" aria-label="Search exams" placeholder="Search exams…" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(60) }} />
        </div>
        {rows.length ? (
          <div className="w-full overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><span className="sr-only">Expand</span></TableHead>
                  <SortableHead column="examYear" label="Exam year" sortKey={sort.key} direction={sort.direction} onSort={handleSort} />
                  <SortableHead column="completedAt" label="Date" sortKey={sort.key} direction={sort.direction} onSort={handleSort} />
                  <SortableHead column="mark" label="Mark" sortKey={sort.key} direction={sort.direction} onSort={handleSort} />
                  <SortableHead column="result" label="Result" sortKey={sort.key} direction={sort.direction} onSort={handleSort} />
                  <TableHead aria-sort={sort.key === "comparison" ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                    <div className="flex items-center whitespace-nowrap">
                      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => handleSort("comparison")}>
                        VCAA comparison
                        {sort.key === "comparison" ? (sort.direction === "asc" ? <ChevronUp /> : <ChevronDown />) : <ChevronsUpDown />}
                      </Button>
                      <Select value={String(comparisonYear)} onValueChange={(value) => onComparisonYearChange(Number(value))}>
                        <SelectTrigger size="sm" className="w-auto border-0 bg-transparent px-1.5 py-0 text-xs font-medium shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted" aria-label="VCAA comparison year">
                          <SelectValue>{comparisonYear}</SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-24">
                          {comparisonYears.map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableHead>
                  <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownRows.map(({ attempt, reference, analysis }) => {
                  const expanded = expandedId === attempt.id
                  return (
                    <Fragment key={attempt.id}>
                      <TableRow id={getExamTarget(attempt.id)} className="scroll-mt-20 transition-colors target:bg-accent/60">
                        <TableCell className="py-2">
                          <Button variant="ghost" size="icon-sm" aria-expanded={expanded} aria-controls={`distribution-${attempt.id}`} aria-label={`${expanded ? "Hide" : "Show"} distribution for ${attempt.title}`} onClick={() => setExpandedId(expanded ? null : attempt.id)}>
                            {expanded ? <ChevronUp /> : <ChevronDown />}
                          </Button>
                        </TableCell>
                        <TableCell><div className="font-medium">{attempt.title}</div><div className="text-xs text-muted-foreground">{attempt.provider} · {attempt.paper}</div></TableCell>
                        <TableCell className="whitespace-nowrap">{new Date(`${attempt.completedAt}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</TableCell>
                        <TableCell className="tabular-nums">{reference ? <><div>{analysis.scaledScore.toFixed(1)}/{reference.maxScore}</div><div className="text-xs text-muted-foreground">{attempt.rawScore}/{attempt.rawMax} raw</div></> : `${attempt.rawScore}/${attempt.rawMax}`}</TableCell>
                        <TableCell className="tabular-nums">{analysis.percentage.toFixed(1)}%</TableCell>
                        <TableCell>{reference && analysis.grade ? <div className="flex items-center gap-2 whitespace-nowrap"><Badge variant="secondary">{analysis.grade}</Badge><span className="text-xs text-muted-foreground">est. {analysis.percentile?.toFixed(0)}th</span></div> : <span className="text-xs text-muted-foreground">Unavailable in {comparisonYear}</span>}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}><MoreHorizontal /><span className="sr-only">Actions for {attempt.title}</span></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => onEdit(attempt)}>Edit exam</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onAddMistake(attempt.id)}>Log mistake</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => onDelete(attempt)}>Delete exam</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                      {expanded ? <TableRow id={`distribution-${attempt.id}`} className="bg-muted/30 hover:bg-muted/30"><TableCell colSpan={7} className="p-4 whitespace-normal"><div className="grid gap-5">
                        {attempt.timing ? <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><span><strong>Writing:</strong> {formatTimer(attempt.timing.actualWritingSeconds)}</span><span><strong>Overtime:</strong> {formatTimer(attempt.timing.overtimeSeconds)}</span><span><strong>Paused:</strong> {formatTimer(attempt.timing.pausedSeconds)}</span></div> : null}
                        {attempt.questionResults?.length ? <div className="overflow-x-auto rounded-lg border bg-background"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Topic</TableHead><TableHead>Confidence</TableHead><TableHead className="text-right">Mark</TableHead></TableRow></TableHeader><TableBody>{attempt.questionResults.map((result) => <TableRow key={result.id}><TableCell className="font-medium">{result.label}</TableCell><TableCell><div>{result.areaOfStudy || "—"}</div>{result.examinerNote ? <div className="max-w-2xl text-xs text-muted-foreground">{result.examinerNote}</div> : null}</TableCell><TableCell className="capitalize">{result.confidence}</TableCell><TableCell className="text-right tabular-nums">{result.marksAwarded}/{result.maxMarks}</TableCell></TableRow>)}</TableBody></Table></div> : null}
                        <Suspense fallback={<Skeleton className="h-64 w-full" />}><AttemptDistributionChart attempt={attempt} references={references} comparisonYear={comparisonYear} /></Suspense>
                      </div></TableCell></TableRow> : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Alert><CircleAlert /><AlertTitle>No matching exams</AlertTitle><AlertDescription>Try a subject, provider, paper, exam year or completion date.</AlertDescription>{query ? <Button size="sm" variant="outline" onClick={() => setQuery("")}>Clear search</Button> : null}</Alert>
        )}
        {rows.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs tabular-nums text-muted-foreground">Showing {shownRows.length} of {rows.length} exams</p>{shownRows.length < rows.length ? <Button size="sm" variant="outline" onClick={() => setVisibleCount(shownRows.length + 60)}>Show more exams</Button> : null}</div> : null}
      </section>
    </>
  )
}
