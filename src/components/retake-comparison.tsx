import { useState } from "react"
import { normaliseComparisonName, questionKey, type ExamAttempt } from "../lib/exam-data"
import { paperTypeOf } from "../lib/paper-types"
import { formatTimer } from "../lib/exam-timer"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"

const paperKey = (attempt: ExamAttempt) => JSON.stringify([
  normaliseComparisonName(attempt.subject), normaliseComparisonName(attempt.provider),
  attempt.examYear, paperTypeOf(attempt) ?? normaliseComparisonName(attempt.paper),
])
const percentage = (attempt: ExamAttempt) => attempt.rawMax > 0 ? attempt.rawScore / attempt.rawMax * 100 : null
const signed = (value: number) => `${value > 0 ? "+" : ""}${Number(value.toFixed(1))}`
const changeColor = (value: number) => value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground"
const dateLabel = (attempt: ExamAttempt) => `${attempt.completedAt} · ${attempt.rawScore}/${attempt.rawMax}`

export function RetakeComparison({ attempt, attempts }: { attempt: ExamAttempt; attempts: ExamAttempt[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const retakes = attempts.filter((other) => other.id !== attempt.id && paperKey(other) === paperKey(attempt))
    .toSorted((a, b) => b.completedAt.localeCompare(a.completedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  const target = retakes.find((other) => other.id === selectedId)
    ?? retakes.find((other) => other.completedAt < attempt.completedAt)
    ?? retakes.at(-1)
  if (!target) return null

  const [earlier, later] = [attempt, target].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const earlierPercent = percentage(earlier), laterPercent = percentage(later)
  const scoreDelta = later.rawScore - earlier.rawScore
  const earlierQuestions = new Map((earlier.questionResults ?? []).map((question) => [questionKey(question.label), question]))
  const laterQuestions = new Map((later.questionResults ?? []).map((question) => [questionKey(question.label), question]))
  const keys = [...new Set([...laterQuestions.keys(), ...earlierQuestions.keys()])]

  return (
    <section aria-label="Retake comparison" className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">Compare with earlier attempt</h3>
        {retakes.length > 1 ? (
          <Select value={target.id} onValueChange={setSelectedId}>
            <SelectTrigger className="w-auto" aria-label="Comparison attempt"><SelectValue>{dateLabel(target)}</SelectValue></SelectTrigger>
            <SelectContent>{retakes.map((other) => <SelectItem key={other.id} value={other.id}>{dateLabel(other)}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm tabular-nums">
        {([['Earlier', earlier], ['Later', later]] as const).map(([label, item]) => (
          <p key={label}><span className="text-muted-foreground">{label} · {item.completedAt}</span><br />{item.rawScore}/{item.rawMax} ({percentage(item)?.toFixed(1) ?? "—"}%)</p>
        ))}
        <p className={changeColor(scoreDelta)}>Change: {signed(scoreDelta)} marks{earlierPercent !== null && laterPercent !== null ? <><br /><span className={changeColor(laterPercent - earlierPercent)}>{signed(laterPercent - earlierPercent)} percentage points</span></> : null}</p>
        {earlier.timing && later.timing ? <p>Writing: {formatTimer(earlier.timing.actualWritingSeconds)} → {formatTimer(later.timing.actualWritingSeconds)}<br />Change: {signed((later.timing.actualWritingSeconds - earlier.timing.actualWritingSeconds) / 60)} min</p> : null}
      </div>
      {keys.length ? (
        <Table>
          <TableHeader><TableRow><TableHead>Question</TableHead><TableHead>Earlier marks/max</TableHead><TableHead>Later marks/max</TableHead><TableHead>Change</TableHead><TableHead>Confidence (earlier → later)</TableHead></TableRow></TableHeader>
          <TableBody>{keys.map((key) => {
            const before = earlierQuestions.get(key), after = laterQuestions.get(key)
            const delta = before && after ? after.marksAwarded - before.marksAwarded : null
            return (
              <TableRow key={key}>
                <TableCell>{after?.label ?? before?.label}</TableCell>
                <TableCell>{before ? `${before.marksAwarded}/${before.maxMarks}` : "—"}</TableCell>
                <TableCell>{after ? `${after.marksAwarded}/${after.maxMarks}` : "—"}</TableCell>
                <TableCell className={delta === null ? "text-muted-foreground" : changeColor(delta)}>{delta === null ? "—" : signed(delta)}</TableCell>
                <TableCell className="capitalize">{before?.confidence ?? "—"} → {after?.confidence ?? "—"}</TableCell>
              </TableRow>
            )
          })}</TableBody>
        </Table>
      ) : <p className="text-sm text-muted-foreground">Neither attempt has question results; only totals can be compared.</p>}
    </section>
  )
}
