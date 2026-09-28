import { useMemo, useState } from "react"
import { Archive, BookOpenCheck, Plus, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/page-header"
import { SubjectCombobox } from "@/components/subject-combobox"
import { MetricCard, MetricGrid, SectionHeading, WorkspacePage } from "@/components/workspace-layout"
import type { AppData } from "@/lib/exam-data"
import { buildMasteryAreas, type LearningWorkspace, type LearningWorkspaceUpdate } from "@/lib/learning-workspace"

function masteryLabel(value: number | null) {
  if (value === null) return "Untested"
  if (value >= 85) return "Secure"
  if (value >= 70) return "Developing"
  return "Priority"
}

export function MasteryPage({ data, subjects, onChange, onOpenPractice }: {
  data: AppData
  subjects: string[]
  onChange: (learning: LearningWorkspaceUpdate) => void
  onOpenPractice: (subject: string) => void
}) {
  const [subject, setSubject] = useState(data.subjects[0] ?? subjects[0] ?? "")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "priority" | "untested">("all")
  const areas = useMemo(() => buildMasteryAreas(data), [data])
  const archivedAreas = data.learning.curriculumAreas.filter((area) => area.archivedAt)
  const visibleAreas = useMemo(() => areas.filter((area) => {
    const matchesQuery = `${area.subject} ${area.name}`.toLowerCase().includes(query.trim().toLowerCase())
    const matchesFilter = filter === "all" || filter === "priority" && area.mastery !== null && area.mastery < 70 || filter === "untested" && area.mastery === null
    return matchesQuery && matchesFilter
  }), [areas, filter, query])
  const grouped = useMemo(() => {
    const result = new Map<string, typeof visibleAreas>()
    for (const area of visibleAreas) result.set(area.subject, [...(result.get(area.subject) ?? []), area])
    return result
  }, [visibleAreas])
  const priorities = areas.filter((area) => area.mastery !== null && area.mastery < 70).length
  const untested = areas.filter((area) => area.mastery === null).length

  function commit(update: (current: LearningWorkspace) => LearningWorkspace) {
    onChange((current) => ({ ...update(current), updatedAt: new Date().toISOString() }))
  }

  function addArea() {
    if (!subject.trim()) return setError("Choose a subject.")
    if (!name.trim()) return setError("Enter an area, skill, or outcome.")
    const duplicate = areas.some((area) => area.subject.trim().toLowerCase() === subject.trim().toLowerCase() && area.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (duplicate) return setError("That area is already mapped for this subject.")
    const timestamp = new Date().toISOString()
    commit((current) => ({ ...current, curriculumAreas: [...current.curriculumAreas, { id: crypto.randomUUID(), subject: subject.trim(), name: name.trim(), createdAt: timestamp, updatedAt: timestamp }] }))
    setName("")
    setError(null)
  }

  function removeArea(subjectName: string, areaName: string) {
    const updatedAt = new Date().toISOString()
    commit((current) => ({ ...current, curriculumAreas: current.curriculumAreas.map((area) => area.subject === subjectName && area.name === areaName ? { ...area, archivedAt: updatedAt, updatedAt } : area) }))
  }

  function restoreArea(id: string) {
    const updatedAt = new Date().toISOString()
    commit((current) => ({ ...current, curriculumAreas: current.curriculumAreas.map((area) => area.id === id ? { ...area, archivedAt: undefined, updatedAt } : area) }))
  }

  return (
    <WorkspacePage>
      <PageHeader title="Curriculum mastery" description="See which areas are secure, weak, or still untested from question-level results and mistake evidence." />
      <MetricGrid>
        <MetricCard label="Mapped areas" value={areas.length}><span>Across all subjects</span></MetricCard>
        <MetricCard label="Revision priorities" value={priorities}><span>Below 70% mastery</span></MetricCard>
        <MetricCard label="Untested areas" value={untested}><span>Waiting for evidence</span></MetricCard>
      </MetricGrid>
      <Card className="gap-5">
        <CardHeader><CardTitle>Add a curriculum area</CardTitle><CardDescription>Create the map from your study design, teacher course outline, or current Areas of Study.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[minmax(14rem,0.8fr)_minmax(18rem,1.2fr)_auto] md:items-end">
          <Field><FieldLabel htmlFor="mastery-subject">Subject</FieldLabel><SubjectCombobox id="mastery-subject" subjects={subjects} preferredSubjects={data.subjects} value={subject} onValueChange={setSubject} allowCustom required /></Field>
          <Field data-invalid={error ? true : undefined}><FieldLabel htmlFor="mastery-area">Area, skill, or outcome</FieldLabel><Input id="mastery-area" value={name} onChange={(event) => { setName(event.target.value); setError(null) }} placeholder="e.g. Differentiation" /></Field>
          <Button onClick={addArea}><Plus />Add area</Button>
          <FieldError className="md:col-span-full">{error}</FieldError>
        </CardContent>
      </Card>

      {areas.length ? <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search mastery areas" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subjects and areas" /></div><Select value={filter} onValueChange={(value) => setFilter((value ?? "all") as typeof filter)}><SelectTrigger className="w-full sm:w-44" aria-label="Filter mastery areas"><SelectValue>{filter === "all" ? "All areas" : filter === "priority" ? "Priorities" : "Untested"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All areas</SelectItem><SelectItem value="priority">Priorities</SelectItem><SelectItem value="untested">Untested</SelectItem></SelectContent></Select></div> : null}

      {visibleAreas.length ? [...grouped.entries()].map(([subjectName, subjectAreas]) => (
        <section key={subjectName} className="grid gap-4" aria-labelledby={`mastery-${subjectName}`}>
          <SectionHeading id={`mastery-${subjectName}`} title={subjectName} description={`${subjectAreas.length} mapped area${subjectAreas.length === 1 ? "" : "s"}`} action={<Button size="sm" variant="outline" onClick={() => onOpenPractice(subjectName)}>Practise priorities</Button>} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{subjectAreas.map((area) => {
            const manual = data.learning.curriculumAreas.some((item) => !item.archivedAt && item.subject === area.subject && item.name === area.name)
            return <Card key={area.key}>
              <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{area.name}</CardTitle><CardDescription>{area.evidenceCount ? `${area.evidenceCount} evidence item${area.evidenceCount === 1 ? "" : "s"} · ${area.mistakes} mistake${area.mistakes === 1 ? "" : "s"}` : "No linked evidence yet"}</CardDescription></div><Badge variant={area.mastery !== null && area.mastery < 70 ? "destructive" : "outline"}>{masteryLabel(area.mastery)}</Badge></div></CardHeader>
              <CardContent className="grid gap-3"><div className="flex items-center gap-3"><Progress value={area.mastery ?? 0} className="flex-1" /><span className="w-10 text-right text-sm font-medium tabular-nums">{area.mastery === null ? "—" : `${Math.round(area.mastery)}%`}</span></div><div className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-3 text-center text-xs"><div><strong className="block text-sm tabular-nums">{area.availableMarks ? `${area.awardedMarks}/${area.availableMarks}` : "—"}</strong><span className="text-muted-foreground">marks</span></div><div><strong className="block text-sm tabular-nums">{area.mistakes}</strong><span className="text-muted-foreground">mistakes</span></div><div><strong className="block text-sm tabular-nums">{area.reviews}</strong><span className="text-muted-foreground">reviews</span></div></div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{area.lastEvidenceAt ? `Last evidence ${new Date(`${area.lastEvidenceAt}T00:00:00`).toLocaleDateString("en-AU")}` : "Waiting for linked evidence"}</span>{manual ? <Button variant="ghost" size="icon-sm" onClick={() => removeArea(area.subject, area.name)}><Archive /><span className="sr-only">Archive area</span></Button> : null}</div></CardContent>
            </Card>
          })}</div>
        </section>
      )) : <Empty className="min-h-56 border"><EmptyHeader><EmptyMedia variant="icon"><BookOpenCheck /></EmptyMedia><EmptyTitle>{areas.length ? "No matching mastery areas" : "Build your mastery map"}</EmptyTitle><EmptyDescription>{areas.length ? "Try a different search or filter." : "Add curriculum areas above, or label Areas of Study while recording question results and mistakes."}</EmptyDescription></EmptyHeader></Empty>}
      {archivedAreas.length ? <Card><CardHeader><CardTitle>Archived curriculum areas</CardTitle><CardDescription>Restore an area without losing its synced history.</CardDescription></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{archivedAreas.map((area) => <div key={area.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><p className="text-sm font-medium">{area.name}</p><p className="text-xs text-muted-foreground">{area.subject}</p></div><Button size="sm" variant="outline" onClick={() => restoreArea(area.id)}>Restore</Button></div>)}</CardContent></Card> : null}
    </WorkspacePage>
  )
}
