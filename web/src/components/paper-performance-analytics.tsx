import { useMemo, useState } from "react"
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Calculator, Minus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ExamAttempt, Mistake } from "@/lib/exam-data"
import { getExamTarget } from "@/lib/exam-target"
import { isTechSplitMathsSubject } from "@/lib/mistake-filters"
import {
  buildLostMarksAttribution,
  buildPaperWeaknessMatrix,
  type PaperPerformanceCell,
  type PaperWeaknessDiagnosis,
} from "@/lib/performance-insights"

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatMastery(value: number | null) {
  return value === null ? "—" : `${value.toFixed(0)}%`
}

function diagnosisLabel(diagnosis: PaperWeaknessDiagnosis) {
  if (diagnosis === "tech-free fragile") return "E1 weakness"
  if (diagnosis === "tech-active fragile") return "E2 weakness"
  if (diagnosis === "general weakness") return "Weak on both"
  if (diagnosis === "secure") return "Secure"
  if (diagnosis === "stable") return "Stable"
  return "More evidence needed"
}

function diagnosisVariant(diagnosis: PaperWeaknessDiagnosis): "destructive" | "secondary" | "outline" {
  if (diagnosis === "tech-free fragile" || diagnosis === "tech-active fragile" || diagnosis === "general weakness") return "destructive"
  if (diagnosis === "secure") return "secondary"
  return "outline"
}

function PaperCellButton({ cell, onClick }: { cell: PaperPerformanceCell; onClick: () => void }) {
  if (cell.mastery === null) return <span className="text-muted-foreground">—</span>
  return (
    <Button variant="ghost" className="h-auto min-w-24 flex-col items-end gap-0.5 px-2 py-1 text-right" onClick={onClick}>
      <span className="font-semibold tabular-nums">{formatMastery(cell.mastery)}</span>
      <span className="text-[11px] font-normal text-muted-foreground tabular-nums">{formatNumber(cell.missedMarks)} lost · {cell.evidenceConfidence} evidence</span>
    </Button>
  )
}

function trendText(cell: PaperPerformanceCell) {
  if (cell.trendPoints === null) return "Needs results from at least two papers"
  return `${cell.trendPoints >= 0 ? "+" : ""}${cell.trendPoints.toFixed(1)} pp · ${cell.trend}`
}

function CellDetails({ subject, area, cell }: { subject: string; area: string; cell: PaperPerformanceCell }) {
  const responsible = cell.questions.filter((question) => question.missedMarks > 0 || question.mistakeCategories.length > 0)
  const blindSpots = responsible.filter((question) => question.confidence === "high" && question.missedMarks > 0).length
  return (
    <DialogContent className="max-h-[min(52rem,calc(100vh-2rem))] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{area} · Exam {cell.paper}</DialogTitle>
        <DialogDescription>{subject} · {formatMastery(cell.mastery)} mastery from {cell.questionCount} marked question{cell.questionCount === 1 ? "" : "s"}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3"><p className="text-xl font-semibold tabular-nums">{formatNumber(cell.missedMarks)}/{formatNumber(cell.availableMarks)}</p><p className="text-xs text-muted-foreground">marks lost / available</p></div>
        <div className="rounded-lg border p-3"><p className="text-xl font-semibold tabular-nums">{cell.confidenceRisk.toFixed(0)}%</p><p className="text-xs text-muted-foreground">confidence risk</p></div>
        <div className="rounded-lg border p-3"><p className="text-xl font-semibold tabular-nums">{cell.mistakeCount}</p><p className="text-xs text-muted-foreground">logged mistakes</p></div>
        <div className="rounded-lg border p-3"><p className="text-xl font-semibold tabular-nums">{cell.repeatMistakes}</p><p className="text-xs text-muted-foreground">repeat mistakes</p></div>
      </div>
      <div className="grid gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-3">
        <div><p className="text-xs text-muted-foreground">Recent trend</p><p className="mt-1 text-sm font-medium">{trendText(cell)}</p></div>
        <div><p className="text-xs text-muted-foreground">Evidence strength</p><p className="mt-1 text-sm font-medium capitalize">{cell.evidenceConfidence} · {formatNumber(cell.availableMarks)} marks</p></div>
        <div><p className="text-xs text-muted-foreground">Blind spots</p><p className="mt-1 text-sm font-medium">{blindSpots} high-confidence error{blindSpots === 1 ? "" : "s"}</p></div>
      </div>
      <div>
        <h3 className="text-sm font-medium">Questions responsible</h3>
        <p className="mt-1 text-xs text-muted-foreground">Questions with lost marks or a linked mistake, newest first.</p>
        {responsible.length ? <div className="mt-3 divide-y rounded-lg border">{responsible.map((question) => (
          <div key={`${question.attemptId}-${question.question}`} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{question.provider} {question.examYear} · Question {question.question}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{question.attemptTitle} · {new Date(`${question.completedAt}T00:00:00`).toLocaleDateString("en-AU")} · {question.confidence} confidence{question.mistakeCategories.length ? ` · ${question.mistakeCategories.join(", ")}` : ""}</p>
            </div>
            <span className="text-sm font-medium tabular-nums">{formatNumber(question.earnedMarks)}/{formatNumber(question.availableMarks)}</span>
            <Button variant="ghost" size="sm" render={<a href={`#${getExamTarget(question.attemptId)}`} />}>Open <ArrowDownRight /></Button>
          </div>
        ))}</div> : <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No lost-mark questions are linked to this cell.</p>}
      </div>
    </DialogContent>
  )
}

function dominantCategory(categories: ReturnType<typeof buildLostMarksAttribution>["categories"], paper: 1 | 2) {
  return categories
    .filter((row) => row.category !== "Unattributed")
    .toSorted((first, second) => (paper === 1 ? second.exam1 - first.exam1 : second.exam2 - first.exam2))[0]
}

function mainErrorCategories(cells: PaperPerformanceCell[]) {
  const counts = new Map<string, number>()
  for (const cell of cells) {
    for (const question of cell.questions) {
      for (const category of question.mistakeCategories) counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }
  return [...counts.entries()].toSorted((first, second) => second[1] - first[1] || first[0].localeCompare(second[0])).slice(0, 2).map(([category]) => category)
}

export function PaperPerformanceAnalytics({ attempts, mistakes }: { attempts: ExamAttempt[]; mistakes: Mistake[] }) {
  const subjects = useMemo(() => [...new Set(attempts.filter((attempt) => isTechSplitMathsSubject(attempt.subject)).map((attempt) => attempt.subject))].toSorted(), [attempts])
  const [selectedSubject, setSelectedSubject] = useState("")
  const [selectedCell, setSelectedCell] = useState<{ area: string; cell: PaperPerformanceCell } | null>(null)
  const subject = subjects.includes(selectedSubject) ? selectedSubject : subjects[0]
  const matrix = useMemo(() => subject ? buildPaperWeaknessMatrix(attempts, mistakes, subject) : [], [attempts, mistakes, subject])
  const lostMarks = useMemo(() => subject ? buildLostMarksAttribution(attempts, mistakes, subject) : null, [attempts, mistakes, subject])
  const technologySignals = matrix.filter((row) => row.diagnosis === "tech-free fragile" || row.diagnosis === "tech-active fragile" || row.diagnosis === "general weakness").slice(0, 3)
  const exam1Dominant = lostMarks ? dominantCategory(lostMarks.categories, 1) : undefined
  const exam2Dominant = lostMarks ? dominantCategory(lostMarks.categories, 2) : undefined

  if (!subject) return null

  return (
    <section className="grid gap-6" aria-labelledby="paper-analysis-title">
      <Card className="min-w-0">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle id="paper-analysis-title">Exam 1 vs Exam 2 weakness matrix</CardTitle>
              <CardDescription>Paper-aware mastery, technology dependence, confidence, repeat mistakes, and the exact questions behind each result.</CardDescription>
            </div>
            {subjects.length > 1 ? <Select value={subject} onValueChange={(value) => setSelectedSubject(value ?? "")}><SelectTrigger aria-label="Choose mathematics subject"><SelectValue /></SelectTrigger><SelectContent>{subjects.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select> : <Badge variant="outline">{subject}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          {technologySignals.length ? <div className="grid gap-3 md:grid-cols-3">{technologySignals.map((row) => {
            const Icon = row.diagnosis === "tech-active fragile" ? Calculator : row.diagnosis === "tech-free fragile" ? AlertTriangle : Minus
            const weakCells = row.diagnosis === "tech-free fragile" ? [row.exam1] : row.diagnosis === "tech-active fragile" ? [row.exam2] : [row.exam1, row.exam2]
            const mainErrors = mainErrorCategories(weakCells)
            return <div key={row.areaOfStudy} className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-2"><Icon className="size-4" /><p className="font-medium">{row.areaOfStudy}</p></div>
              <p className="mt-2 text-sm text-muted-foreground">Exam 1 {formatMastery(row.exam1.mastery)} · Exam 2 {formatMastery(row.exam2.mastery)}</p>
              <p className="mt-1 text-sm font-medium">{row.gap === null ? "More evidence needed" : `${row.gap >= 0 ? "+" : ""}${row.gap.toFixed(1)} pp technology gap`} · {diagnosisLabel(row.diagnosis)}</p>
              {mainErrors.length ? <p className="mt-2 text-xs text-muted-foreground">Main errors: {mainErrors.join(", ")}</p> : null}
            </div>
          })}</div> : null}
          {matrix.length ? <Table>
            <TableHeader><TableRow><TableHead>Area of Study</TableHead><TableHead className="text-right">Exam 1</TableHead><TableHead className="text-right">Exam 2</TableHead><TableHead className="text-right">Gap</TableHead><TableHead>Diagnosis</TableHead></TableRow></TableHeader>
            <TableBody>{matrix.map((row) => <TableRow key={row.areaOfStudy}>
              <TableCell className="font-medium">{row.areaOfStudy}</TableCell>
              <TableCell className="text-right"><PaperCellButton cell={row.exam1} onClick={() => setSelectedCell({ area: row.areaOfStudy, cell: row.exam1 })} /></TableCell>
              <TableCell className="text-right"><PaperCellButton cell={row.exam2} onClick={() => setSelectedCell({ area: row.areaOfStudy, cell: row.exam2 })} /></TableCell>
              <TableCell className="text-right font-medium tabular-nums">{row.gap === null ? "—" : <span className="inline-flex items-center gap-1">{row.gap > 1 ? <ArrowUpRight className="size-3.5" /> : row.gap < -1 ? <ArrowDownRight className="size-3.5" /> : null}{row.gap >= 0 ? "+" : ""}{row.gap.toFixed(0)}</span>}</TableCell>
              <TableCell><Badge variant={diagnosisVariant(row.diagnosis)}>{diagnosisLabel(row.diagnosis)}</Badge></TableCell>
            </TableRow>)}</TableBody>
          </Table> : <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Add Area of Study labels to Exam 1 and Exam 2 question results to build this comparison.</div>}
          <p className="text-xs text-muted-foreground">Gap = Exam 2 mastery minus Exam 1 mastery. A negative gap points to technology-active fragility; a positive gap points to tech-free fragility. Select any percentage for the supporting evidence.</p>
        </CardContent>
      </Card>

      {lostMarks?.attemptCount ? <Card className="min-w-0">
        <CardHeader><CardTitle>Lost-marks attribution</CardTitle><CardDescription>Last {lostMarks.attemptCount} {subject} paper{lostMarks.attemptCount === 1 ? "" : "s"} · {formatNumber(lostMarks.totalLost)} marks lost in total.</CardDescription></CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.45fr)]">
          <div className="grid gap-3">{lostMarks.categories.map((row) => <div key={row.category} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3 text-sm"><span className={row.category === "Unattributed" ? "text-muted-foreground" : "font-medium"}>{row.category}</span><span className="tabular-nums">{formatNumber(row.marks)} <span className="text-xs text-muted-foreground">E1 {formatNumber(row.exam1)} · E2 {formatNumber(row.exam2)}</span></span></div>
            <Progress value={lostMarks.totalLost ? row.marks / lostMarks.totalLost * 100 : 0} />
          </div>)}</div>
          <div className="grid content-start gap-3">
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Exam 1 pattern</p><p className="mt-1 font-medium">{exam1Dominant && exam1Dominant.exam1 > 0 ? `${exam1Dominant.category} dominates · ${formatNumber(exam1Dominant.exam1)} marks` : "Not enough attributed mistakes yet"}</p></div>
            <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Exam 2 pattern</p><p className="mt-1 font-medium">{exam2Dominant && exam2Dominant.exam2 > 0 ? `${exam2Dominant.category} dominates · ${formatNumber(exam2Dominant.exam2)} marks` : "Not enough attributed mistakes yet"}</p></div>
            {lostMarks.unattributedMarks > 0 ? <p className="text-xs text-muted-foreground">{formatNumber(lostMarks.unattributedMarks)} lost marks do not yet have a logged mistake category. Add mistakes with marks lost to improve attribution.</p> : null}
          </div>
        </CardContent>
      </Card> : null}

      <Dialog open={selectedCell !== null} onOpenChange={(open) => { if (!open) setSelectedCell(null) }}>
        {selectedCell ? <CellDetails subject={subject} area={selectedCell.area} cell={selectedCell.cell} /> : null}
      </Dialog>
    </section>
  )
}
