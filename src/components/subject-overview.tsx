import { parseISO } from "date-fns"
import { ArrowRight, BookOpen, ChartLine, CircleCheck, FileText, GraduationCap, Layers, ListChecks, Percent, Target } from "lucide-react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Button } from "./ui/button"
import { ChartContainer, ChartTooltip } from "./ui/chart"
import { count } from "../lib/utils"
import { PageHeader } from "./page-header"
import { AIOverview } from "./ai-overview"
import { Delta, EmptyState, Meter, Panel, Ring, StatGrid, StatTile, WorkspacePage } from "./workspace-layout"
import type { AppView } from "../lib/app-view"
import type { ExamAttempt } from "../lib/exam-data"
import type { LearningWorkspace } from "../lib/learning-workspace"
import { activeItems, groupBy, isRecheckDue } from "../lib/stoplight"
import { studySubjectOptions, subjectKey } from "../lib/studySubjects"

const percent = (attempt: ExamAttempt) => Math.round((attempt.rawScore / attempt.rawMax) * 100)
const shortDate = (date: string) => parseISO(date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
const mean = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null

export function SubjectOverview({ subject, attempts, learning, now, dueMistakes, onNavigate, onOpenSkills, onReview, onOpenAttempt }: {
  subject: string
  attempts: ExamAttempt[]
  learning: LearningWorkspace
  now: Date
  dueMistakes: number
  onNavigate: (view: AppView) => void
  onOpenSkills: (subject: string, filter?: "red" | "recheck" | "unrated") => void
  onReview: () => void
  onOpenAttempt: (id: string) => void
}) {
  const items = activeItems(learning)
  const checklists = [...groupBy(items, (item) => subjectKey(item.subject)).values()]
    .map((items) => ({
      name: subject === "all" ? studySubjectOptions([items[0].subject])[0]?.name ?? items[0].subject : subject,
      total: items.length,
      green: items.filter((item) => item.rating === "green").length,
      amber: items.filter((item) => item.rating === "amber").length,
      red: items.filter((item) => item.rating === "red").length,
      recheck: items.filter((item) => isRecheckDue(item, now)).length,
      unrated: items.filter((item) => !item.rating).length,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name))
  const green = checklists.reduce((sum, list) => sum + list.green, 0)

  const marked = attempts.filter((attempt) => attempt.rawMax > 0).toSorted((a, b) => a.completedAt.localeCompare(b.completedAt))
  const scores = marked.map(percent)
  const average = mean(scores)
  // Last three papers against the three before them.
  const recent = mean(scores.slice(-3)), earlier = mean(scores.slice(-6, -3))
  const points = marked.map((attempt, index) => ({ index, score: scores[index], date: shortDate(attempt.completedAt), title: attempt.title || `${attempt.provider} ${attempt.examYear} ${attempt.paper}` }))
  const summary = scores.length ? `${count(scores.length, "marked paper")}, from ${scores[0]}% to ${scores.at(-1)}%.` : "No marked papers yet."

  return (
    <WorkspacePage>
      <PageHeader icon={BookOpen} title={subject === "all" ? "Subjects" : subject} description="Marks, skills and reviews for your next study session.">
        <Button variant="outline" onClick={() => onNavigate("sacs")}><GraduationCap data-icon="inline-start" />Assessments</Button>
        <Button variant="outline" onClick={() => onNavigate("goals")}><Target data-icon="inline-start" />Goals</Button>
        <Button onClick={() => onNavigate("exams")}><FileText data-icon="inline-start" />Practice</Button>
      </PageHeader>

      <StatGrid>
        <StatTile icon={Percent} label="Average mark" value={average == null ? "—" : `${average}%`} delta={recent != null && earlier != null ? <Delta value={recent - earlier} suffix=" pp" /> : null} hint={earlier != null ? "Last 3 papers vs the 3 before" : "Across marked papers"} spark={scores.slice(-12)} />
        <StatTile icon={FileText} label="Papers marked" value={scores.length} hint={scores.length ? `Best ${Math.max(...scores)}% · latest ${scores.at(-1)}%` : "Log a paper to start"} onClick={() => onNavigate("exams")} />
        <StatTile icon={ListChecks} tone="success" label="Skills green" value={items.length ? `${Math.round((green / items.length) * 100)}%` : "—"} hint={items.length ? `${green} of ${count(items.length, "item")}` : "No checklist yet"} onClick={() => onOpenSkills(subject)} />
        <StatTile icon={Layers} tone={dueMistakes ? "warning" : "default"} label="Mistakes due" value={dueMistakes} hint={dueMistakes ? "Ready to review now" : "Nothing due"} onClick={dueMistakes ? onReview : undefined} />
      </StatGrid>

      {subject === "all" ? null : <AIOverview area="subject" subject={subject} fingerprint={`${dueMistakes}:${attempts.length}`} />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel icon={ChartLine} title="Marks over time" description={summary}>
          {points.length > 1 ? (
            <ChartContainer config={{ score: { label: "Mark", color: "var(--primary)" } }} className="aspect-auto h-56 w-full" role="img" aria-label={summary}>
              <AreaChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="index" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={(index: number) => points[index]?.date ?? ""} />
                <YAxis domain={[(min: number) => Math.max(0, Math.floor(min / 10) * 10 - 10), 100]} tickLine={false} axisLine={false} width={40} tickFormatter={(value) => `${value}%`} />
                <ChartTooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const point = payload[0].payload as (typeof points)[number]
                  return <div className="rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md"><p className="font-medium">{point.title}</p><p className="text-muted-foreground">{point.date} · {point.score}%</p></div>
                }} />
                <Area type="monotone" dataKey="score" stroke="var(--color-score)" strokeWidth={2} fill="var(--color-score)" fillOpacity={0.08} dot={{ r: 3, fill: "var(--color-score)" }} activeDot={{ r: 5 }} animationDuration={500} />
              </AreaChart>
            </ChartContainer>
          ) : <EmptyState icon={ChartLine} title="Not enough papers to chart" description="Mark two papers and the trend appears here." action={<Button size="sm" onClick={() => onNavigate("exams")}>Log a paper<ArrowRight data-icon="inline-end" /></Button>} />}
        </Panel>

        <Panel flush icon={FileText} title="Recent attempts" action={<Button variant="ghost" size="sm" onClick={() => onNavigate("exams")}>All<ArrowRight data-icon="inline-end" /></Button>}>
          {marked.length ? <ul>{marked.toReversed().slice(0, 5).map((attempt) => (
            <li key={attempt.id} className="border-b border-border last:border-b-0">
              <button type="button" className="focal-row-action flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5" onClick={() => onOpenAttempt(attempt.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{attempt.title || `${attempt.provider} ${attempt.examYear} ${attempt.paper}`}</span>
                  <span className="block truncate text-xs text-muted-foreground">{shortDate(attempt.completedAt)} · {attempt.rawScore}/{attempt.rawMax}</span>
                </span>
                <Meter value={percent(attempt)} className="w-16" />
                <span className="w-10 shrink-0 text-right font-semibold tabular-nums">{percent(attempt)}%</span>
              </button>
            </li>
          ))}</ul> : <EmptyState icon={FileText} title="No attempts yet" description="Your latest papers and marks show here." />}
        </Panel>
      </div>

      <Panel flush id="subjects-skills" icon={ListChecks} title="Skills" description="Jump straight to the items that need practice" action={<Button variant="ghost" size="sm" onClick={() => onOpenSkills(subject)}>Open checklist<ArrowRight data-icon="inline-end" /></Button>}>
        {checklists.length ? (
          <ul>
            {checklists.map(({ name, total, green, amber, red, recheck, unrated }) => (
              <li key={name} className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-4 py-3 last:border-b-0 sm:px-5">
                <Ring value={green / total} size={52} tone="var(--success)"><span className="text-xs font-semibold tabular-nums">{Math.round((green / total) * 100)}%</span></Ring>
                <div className="min-w-48 flex-1">
                  <h3 className="truncate text-sm font-medium">{name}</h3>
                  <p className="text-xs text-muted-foreground tabular-nums">{green} of {count(total, "item")} rated green</p>
                  <span aria-hidden className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
                    {([[green, "bg-success"], [amber, "bg-warning"], [red, "bg-destructive"], [unrated, "bg-muted"]] as const).map(([amount, tone]) => amount ? <span key={tone} className={`focal-grow ${tone}`} style={{ flexGrow: amount }} /> : null)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([["red", red, "red"], ["recheck", recheck, "to re-check"], ["unrated", unrated, "unrated"]] as const).map(([filter, matching, label]) => matching > 0 ? (
                    <Button key={filter} variant="secondary" size="sm" aria-label={`${matching} ${label} for ${name}`} onClick={() => onOpenSkills(name, filter)}>{matching} {label}</Button>
                  ) : null)}
                  {red + recheck + unrated === 0 ? <span className="inline-flex items-center gap-1 text-xs text-success"><CircleCheck aria-hidden className="size-4" />All green</span> : null}
                  {subject === "all" ? <Button variant="outline" size="sm" aria-label={`Open checklist for ${name}`} onClick={() => onOpenSkills(name)}>Open<ArrowRight data-icon="inline-end" /></Button> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={ListChecks} title="No skill checklist yet" description="Add a skill or import a checklist, then rate each item red, amber or green." action={<Button size="sm" onClick={() => onOpenSkills(subject)}>Open Skills<ArrowRight data-icon="inline-end" /></Button>} />}
      </Panel>
    </WorkspacePage>
  )
}
