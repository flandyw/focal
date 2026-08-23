import { useMemo, useState } from "react"
import { AlertTriangle, CalendarCheck, Clock, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { buildAdaptivePlan, DEFAULT_ADAPTIVE_PLANNER_CONFIG, type AdaptivePlan } from "@/lib/adaptivePlanner"
import { getProjectMasteryScore } from "@/lib/mastery"
import type { CalendarEvent, Project, StudySession, TimetableConfig } from "@/lib/types"

function EffortRow({ project, onUpdateProject }: {
  project: Project
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<void> | void
}) {
  const [estimate, setEstimate] = useState(project.planning?.estimatedMinutes ? String(project.planning.estimatedMinutes) : "")
  const [block, setBlock] = useState(String(project.planning?.sessionMinutes ?? 45))
  const save = () => {
    const estimatedMinutes = Number(estimate)
    const sessionMinutes = Number(block)
    if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) {
      if (project.planning) void onUpdateProject(project.id, { planning: undefined })
      return
    }
    void onUpdateProject(project.id, {
      planning: {
        estimatedMinutes: Math.round(estimatedMinutes),
        sessionMinutes: Number.isFinite(sessionMinutes) ? Math.max(15, Math.min(180, Math.round(sessionMinutes))) : 45,
      },
    })
  }
  const mastery = getProjectMasteryScore(project)
  return (
    <div className="grid items-center gap-2 border-t py-3 first:border-0 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
      <div className="min-w-0">
        <p className="truncate font-medium">{project.name}</p>
        <p className="text-xs text-muted-foreground">{project.deadline ? `Due ${new Date(project.deadline).toLocaleDateString("en-AU")}` : "No deadline"}{mastery !== null ? ` · ${mastery}% mastery` : ""}</p>
      </div>
      <Input type="number" min="15" step="15" value={estimate} onChange={(event) => setEstimate(event.target.value)} onBlur={save} placeholder="Total min" aria-label={`Estimated minutes for ${project.name}`} />
      <Input type="number" min="15" max="180" step="15" value={block} onChange={(event) => setBlock(event.target.value)} onBlur={save} aria-label={`Block minutes for ${project.name}`} />
      <span className="hidden text-xs text-muted-foreground sm:block">minutes</span>
    </div>
  )
}
export function AdaptivePlannerView({ projects, sessions, events, timetable, onUpdateProject, onCreateStudySessions }: {
  projects: Project[]
  sessions: StudySession[]
  events: CalendarEvent[]
  timetable: TimetableConfig | null
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<void> | void
  onCreateStudySessions: (items: {
    projectId?: string; subjectIds: string[]; title: string; startTime: string; endTime: string; description?: string; topics?: string[]
  }[]) => Promise<void>
}) {
  const activeProjects = useMemo(() => projects.filter((project) => !project.isArchived && !project.isFinished), [projects])
  const [plan, setPlan] = useState<AdaptivePlan | null>(null)
  const [applying, setApplying] = useState(false)
  const configuredCount = activeProjects.filter((project) => project.planning).length

  const generate = () => {
    const next = buildAdaptivePlan({ projects, sessions, events, timetable, config: DEFAULT_ADAPTIVE_PLANNER_CONFIG })
    setPlan(next)
    if (next.items.length === 0) toast.info(configuredCount ? "No additional sessions are needed or available" : "Add an effort estimate first")
  }
  const apply = async () => {
    if (!plan?.items.length) return
    setApplying(true)
    try {
      await onCreateStudySessions(plan.items)
      setPlan(null)
    } finally {
      setApplying(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid max-w-6xl gap-5 p-4 pb-10 min-[1200px]:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
          <div>
            <div className="flex items-center gap-2"><CalendarCheck className="size-5 text-primary" /><h1 className="text-xl font-semibold">Adaptive planner</h1></div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Fit remaining assessment work around your timetable, calendar and existing sessions. The preview never changes the calendar until you approve it.</p>
          </div>
          <Button onClick={generate}><Sparkles /> Build seven-day plan</Button>
        </header>

        <Card>
          <CardHeader><CardTitle>Work estimates</CardTitle><CardDescription>Total expected study time and preferred focus-block length. Completed and future planned sessions are subtracted automatically.</CardDescription></CardHeader>
          <CardContent>
            {activeProjects.length ? activeProjects.map((project) => <EffortRow key={project.id} project={project} onUpdateProject={onUpdateProject} />) : <p className="text-sm text-muted-foreground">No current assessments.</p>}
          </CardContent>
        </Card>

        {plan && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Card>
              <CardHeader><CardTitle>Proposed sessions</CardTitle><CardDescription>{plan.items.length} conflict-free block{plan.items.length === 1 ? "" : "s"}. Existing sessions and fixed events remain untouched.</CardDescription></CardHeader>
              <CardContent className="grid gap-2">
                {plan.items.map((item, index) => {
                  const project = projects.find((candidate) => candidate.id === item.projectId)
                  return <div key={`${item.projectId}-${item.startTime}-${index}`} className="flex items-start gap-3 rounded-lg border p-3">
                    <Clock className="mt-0.5 size-4 text-primary" />
                    <div className="min-w-0 flex-1"><p className="font-medium">{item.title}</p><p className="text-sm text-muted-foreground">{project?.name} · {new Date(item.startTime).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}–{new Date(item.endTime).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</p></div>
                  </div>
                })}
                {!plan.items.length && <p className="text-sm text-muted-foreground">No sessions proposed.</p>}
              </CardContent>
            </Card>
            <div className="grid content-start gap-4">
              {plan.gaps.length > 0 && <Card className="border-warning/30"><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> Capacity gaps</CardTitle></CardHeader><CardContent className="grid gap-2">{plan.gaps.map((gap) => <div key={gap.projectId}><p className="font-medium">{gap.projectName}</p><p className="text-sm text-muted-foreground">{gap.minutes} min unallocated · {gap.reason}</p></div>)}</CardContent></Card>}
              <Button size="lg" disabled={!plan.items.length || applying} onClick={() => void apply()}>{applying ? <Loader2 className="animate-spin" /> : <CalendarCheck />} Add sessions to calendar</Button>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
