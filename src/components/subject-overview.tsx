import { Button } from "./ui/button"
import { PageHeader } from "./page-header"
import type { AppView } from "../lib/app-view"
import type { ExamAttempt } from "../lib/exam-data"

/** One subject's workspace: its tools, its due reviews and its latest attempts, each linking to the canonical record. */
export function SubjectOverview({ subject, attempts, dueMistakes, onNavigate, onReview, onOpenAttempt }: {
  subject: string
  attempts: ExamAttempt[]
  dueMistakes: number
  onNavigate: (view: AppView) => void
  onReview: () => void
  onOpenAttempt: (id: string) => void
}) {
  return (
    <div className="grid gap-6">
      <PageHeader title={subject === "all" ? "Subjects" : subject} description="Skills, assessments and goals for your next study session.">
        {([["stoplight", "Skills"], ["sacs", "Assessments"], ["goals", "Goals"]] as const).map(([destination, label]) => <Button key={destination} variant="outline" onClick={() => onNavigate(destination)}>{label}</Button>)}
      </PageHeader>
      <div className="rounded-md border p-4"><p className="font-medium">{dueMistakes} mistakes due</p><Button className="mt-3" onClick={onReview}>Review due mistakes</Button></div>
      <section className="grid gap-3">
        <h2 className="font-medium">Recent attempts</h2>
        {attempts.length ? attempts.toSorted((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 5).map((attempt) => (
          <Button key={attempt.id} variant="outline" className="h-auto justify-between gap-3 whitespace-normal py-3 text-left" onClick={() => onOpenAttempt(attempt.id)}>
            <span>{attempt.title || `${attempt.provider} ${attempt.examYear} ${attempt.paper}`}<span className="block text-xs font-normal text-muted-foreground">{attempt.completedAt}</span></span>
            <span className="tabular-nums">{attempt.rawScore}/{attempt.rawMax}</span>
          </Button>
        )) : <p className="text-sm text-muted-foreground">No attempts yet.</p>}
      </section>
    </div>
  )
}
