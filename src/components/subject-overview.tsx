import { Button } from "./ui/button"
import { count } from "../lib/utils"
import { PageHeader } from "./page-header"
import { AIOverview } from "./ai-overview"
import { SectionHeading, WorkspacePage } from "./workspace-layout"
import type { AppView } from "../lib/app-view"
import type { ExamAttempt } from "../lib/exam-data"
import type { LearningWorkspace } from "../lib/learning-workspace"
import { activeItems, groupBy, isRecheckDue } from "../lib/stoplight"
import { studySubjectOptions, subjectKey } from "../lib/studySubjects"

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
  const checklists = [...groupBy(activeItems(learning), (item) => subjectKey(item.subject)).values()]
    .map((items) => ({
      name: subject === "all" ? studySubjectOptions([items[0].subject])[0]?.name ?? items[0].subject : subject,
      total: items.length,
      green: items.filter((item) => item.rating === "green").length,
      red: items.filter((item) => item.rating === "red").length,
      recheck: items.filter((item) => isRecheckDue(item, now)).length,
      unrated: items.filter((item) => !item.rating).length,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name))

  return (
    <WorkspacePage>
      <PageHeader title={subject === "all" ? "Subjects" : subject} description="Skills, assessments and goals for your next study session.">
        <Button variant="outline" onClick={() => onNavigate("sacs")}>Assessments</Button>
        <Button variant="outline" onClick={() => onNavigate("goals")}>Goals</Button>
      </PageHeader>
      <section aria-labelledby="subjects-skills" className="grid gap-3">
        <SectionHeading id="subjects-skills" title="Skills" description="See what needs practice and jump straight to those items." />
        {checklists.length ? (
          <ul className="divide-y rounded-lg border">
            {checklists.map(({ name, total, green, red, recheck, unrated }) => (
              <li key={name} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4">
                <div>
                  {subject === "all" ? <h3 className="font-medium">{name}</h3> : null}
                  <p className="text-sm text-muted-foreground tabular-nums">{green} of {count(total, "item")} rated green</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([["red", red, "red"], ["recheck", recheck, "to re-check"], ["unrated", unrated, "unrated"]] as const).map(([filter, matching, label]) => matching > 0 ? (
                    <Button key={filter} variant="secondary" size="sm" aria-label={`${matching} ${label} for ${name}`} onClick={() => onOpenSkills(name, filter)}>{matching} {label}</Button>
                  ) : null)}
                  <Button variant="outline" size="sm" aria-label={`Open checklist for ${name}`} onClick={() => onOpenSkills(name)}>Open checklist</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">No skill checklist yet. Import one from your study design in Skills.</p>
            <Button variant="outline" onClick={() => onOpenSkills(subject)}>Open Skills</Button>
          </div>
        )}
      </section>
      {subject === "all" ? null : <AIOverview area="subject" subject={subject} fingerprint={`${dueMistakes}:${attempts.length}`} />}
      <div className="rounded-md border p-4"><p className="font-medium">{count(dueMistakes, "mistake")} due</p><Button className="mt-3" onClick={onReview}>Review due mistakes</Button></div>
      <section className="grid gap-3">
        <h2 className="font-medium">Recent attempts</h2>
        {attempts.length ? attempts.toSorted((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 5).map((attempt) => (
          <Button key={attempt.id} variant="outline" className="h-auto justify-between gap-3 whitespace-normal py-3 text-left" onClick={() => onOpenAttempt(attempt.id)}>
            <span>{attempt.title || `${attempt.provider} ${attempt.examYear} ${attempt.paper}`}<span className="block text-xs font-normal text-muted-foreground">{attempt.completedAt}</span></span>
            <span className="tabular-nums">{attempt.rawScore}/{attempt.rawMax}</span>
          </Button>
        )) : <p className="text-sm text-muted-foreground">No attempts yet.</p>}
      </section>
    </WorkspacePage>
  )
}
