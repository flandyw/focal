import { useDeferredValue, useMemo, useState } from "react"
import { CalendarPlus, ChevronDown, FileJson, GraduationCap, Link2, Sparkles, TrafficCone } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs"
import { MarkdownPreview } from "./markdown-preview"
import { PageHeader } from "./page-header"
import { StoplightImportDialog } from "./stoplight-import"
import { StoplightReviseDialog } from "./stoplight-revise"
import { MetricCard, MetricGrid, WorkspacePage } from "./workspace-layout"
import { AI_ENABLED } from "../lib/host"
import type { AppData } from "../lib/exam-data"
import type { CurriculumArea, LearningWorkspaceUpdate, StoplightRating } from "../lib/learning-workspace"
import { formatChatGPTProgress, type ChatGPTProgress } from "../lib/mistake-ai-core"
import {
  RATINGS, groupBy, activeItems, buildItemEvidence, collectLinkRecords, isRecheckDue, itemGroup,
  mergeStoplightItems, planRevision, setRating, type ItemEvidence, type ItemLink,
} from "../lib/stoplight"
import { cn } from "../lib/utils"
import { useTickingNow } from "../hooks/use-ticking-now"
import { Input } from "./ui/input"

const FILTERS = { all: "All items", red: "Red", amber: "Amber", green: "Green", recheck: "Re-check due", unrated: "Unrated" } as const
type Filter = keyof typeof FILTERS

// Selected state always carries the label too, so colour is never the only signal.
const SELECTED: Record<StoplightRating, string> = {
  red: "border-stoplight-red bg-stoplight-red text-white hover:border-stoplight-red hover:bg-stoplight-red hover:text-white dark:text-background dark:hover:text-background",
  amber: "border-stoplight-amber bg-stoplight-amber text-warning-foreground hover:border-stoplight-amber hover:bg-stoplight-amber/90 hover:text-warning-foreground",
  green: "border-stoplight-green bg-stoplight-green text-white hover:border-stoplight-green hover:bg-stoplight-green hover:text-white dark:text-background dark:hover:text-background",
}
const SEGMENT: Record<StoplightRating, string> = { red: "bg-stoplight-red", amber: "bg-stoplight-amber", green: "bg-stoplight-green" }

function CountBar({ items }: { items: CurriculumArea[] }) {
  const counts = RATINGS.map(({ id }) => items.filter((item) => item.rating === id).length)
  return (
    <div className="flex h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${counts[0]} red, ${counts[1]} amber, ${counts[2]} green of ${items.length}`}>
      {RATINGS.map(({ id }, index) => counts[index] ? <div key={id} className={SEGMENT[id]} style={{ width: `${counts[index] / items.length * 100}%` }} /> : null)}
    </div>
  )
}

function evidenceText(evidence: ItemEvidence) {
  return [
    evidence.mistakes ? `${evidence.passed}/${evidence.mistakes} linked mistake${evidence.mistakes === 1 ? "" : "s"} passed${evidence.due ? ` · ${evidence.due} due` : ""}` : "",
    evidence.available ? `${evidence.awarded}/${evidence.available} marks` : "",
  ].filter(Boolean).join(" · ")
}

export function StoplightPage({ data, subjects, onChange, onApplyLinks }: {
  data: AppData
  subjects: string[]
  onChange: (learning: LearningWorkspaceUpdate) => void
  onApplyLinks: (links: ItemLink[]) => void
}) {
  const items = useMemo(() => activeItems(data.learning), [data.learning])
  const itemSubjects = useMemo(() => [...new Set(items.map((item) => item.subject))].toSorted((a, b) => a.localeCompare(b)), [items])
  const [chosen, setChosen] = useState("")
  const subject = itemSubjects.includes(chosen) ? chosen : itemSubjects[0] ?? ""
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const needle = useDeferredValue(query.trim().toLowerCase())
  const [importOpen, setImportOpen] = useState(false)
  const [viewing, setViewing] = useState<CurriculumArea | null>(null)
  const [revising, setRevising] = useState(false)
  const [linking, setLinking] = useState(false)
  const [progress, setProgress] = useState<ChatGPTProgress | null>(null)
  const now = useTickingNow()
  const evidence = useMemo(() => buildItemEvidence(data, now), [data, now])
  const unlinked = useMemo(() => collectLinkRecords(data), [data])
  const subjectItems = useMemo(() => items.filter((item) => item.subject === subject), [items, subject])
  const visible = subjectItems.filter((item) =>
    (filter === "all" || filter === "unrated" && !item.rating || filter === "recheck" && isRecheckDue(item, now) || item.rating === filter) &&
    (!needle || `${item.name} ${item.group ?? ""} ${item.check ?? ""}`.toLowerCase().includes(needle)))
  const groups = groupBy(visible, itemGroup)
  const green = subjectItems.filter((item) => item.rating === "green").length
  const reds = subjectItems.filter((item) => item.rating === "red").length
  const rechecks = subjectItems.filter((item) => isRecheckDue(item, now)).length

  function importItems(importSubject: string, imported: Parameters<typeof mergeStoplightItems>[2]) {
    onChange((current) => mergeStoplightItems(current, importSubject, imported).learning)
    setChosen(importSubject)
    toast.success(`Checklist updated for ${importSubject}`)
  }

  function planWeek() {
    const result = planRevision(data.learning, data, subject, now)
    if (!result.count) return toast("Nothing to plan: every red, amber or re-check item already has a task.")
    onChange(result.learning)
    toast.success(`Added ${result.count} revision task${result.count === 1 ? "" : "s"} to your calendar`)
  }

  function applyRatings(ratings: Map<string, StoplightRating>) {
    onChange((current) => [...ratings].reduce((learning, [id, rating]) => setRating(learning, id, rating), current))
    toast.success(`Updated ${ratings.size} rating${ratings.size === 1 ? "" : "s"}`)
  }

  async function linkMistakes() {
    setLinking(true)
    setProgress(null)
    try {
      const { classifyToStoplight } = await import("../lib/mistake-ai")
      const links = await classifyToStoplight(unlinked, items, setProgress)
      if (!links.length) return toast("ChatGPT found no confident matches. Link items by hand when logging a mistake.")
      onApplyLinks(links)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not link mistakes.")
    } finally {
      setLinking(false)
    }
  }

  const viewingMistakes = viewing ? data.mistakes.filter((mistake) => mistake.itemIds?.includes(viewing.id)) : []

  return (
    <WorkspacePage>
      <PageHeader title="Stoplight">
        <Button variant="outline" onClick={() => setImportOpen(true)}><FileJson />Import checklist</Button>
        {AI_ENABLED ? <Button variant="outline" disabled={!unlinked.length || linking} onClick={() => void linkMistakes()}><Sparkles />Link mistakes{unlinked.length ? ` (${unlinked.length})` : ""}</Button> : null}
        {subject ? <Button variant="outline" onClick={() => setRevising(true)}><GraduationCap />Revise with chatbot</Button> : null}
        {subject ? <Button onClick={planWeek}><CalendarPlus />Plan this week</Button> : null}
      </PageHeader>
      {linking && progress ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground tabular-nums">{formatChatGPTProgress(progress)}</p> : null}

      {subject ? (
        <>
          <Tabs value={subject} onValueChange={(value) => setChosen(String(value))}>
            <TabsList>{itemSubjects.map((name) => <TabsTrigger key={name} value={name}>{name}</TabsTrigger>)}</TabsList>
          </Tabs>
          <MetricGrid className="sm:grid-cols-4">
            <MetricCard label="Green" value={`${subjectItems.length ? Math.round(green / subjectItems.length * 100) : 0}%`}><span>{green} of {subjectItems.length} items</span></MetricCard>
            <MetricCard label="Red" value={reds}><span>Start here</span></MetricCard>
            <MetricCard label="Re-check due" value={rechecks}><span>Greens fade after 21 days, ambers after 14</span></MetricCard>
            <MetricCard label="Unlinked" value={unlinked.length}><span>Mistakes and questions without an item</span></MetricCard>
          </MetricGrid>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Good or Easy on every linked mistake turns an item green. Hard, Again or a new mistake brings green back to amber.</p>
            <Input type="search" className="w-full sm:max-w-sm" aria-label="Search checklist" placeholder="Search knowledge, skills or checks" value={query} onChange={(event) => setQuery(event.target.value)} />
            <Select value={filter} onValueChange={(value) => setFilter((value ?? "all") as Filter)}>
              <SelectTrigger className="w-40" aria-label="Filter items"><SelectValue>{FILTERS[filter]}</SelectValue></SelectTrigger>
              <SelectContent>{Object.entries(FILTERS).map(([id, text]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {visible.length ? [...groups].map(([group, groupItems]) => (
            <Collapsible key={group} defaultOpen className="rounded-xl border">
              <CollapsibleTrigger className="group/trigger flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span className="min-w-0 truncate font-medium">{group}</span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  {groupItems.filter((item) => item.rating === "green").length}/{groupItems.length}
                  <CountBar items={groupItems} />
                  <ChevronDown className="size-4 transition-transform group-data-[panel-open]/trigger:rotate-180" />
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent keepMounted><ul className="divide-y border-t">
                {groupItems.map((item) => {
                  const entry = evidence.get(item.id)
                  const text = entry ? evidenceText(entry) : ""
                  return (
                    <li key={item.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{item.name}</span>
                          {item.type ? <Badge variant="outline" className="capitalize">{item.type}</Badge> : null}
                          {isRecheckDue(item, now) ? <Badge variant="secondary">Re-check</Badge> : null}
                        </div>
                        {item.check ? <p className="text-sm text-muted-foreground">{item.check}</p> : null}
                        {text ? <Button variant="link" size="xs" className="h-auto p-0 text-muted-foreground" onClick={() => setViewing(item)}>{text}</Button> : null}
                      </div>
                      <div role="radiogroup" aria-label={`Rate ${item.name}`} className="flex gap-1" onKeyDown={(event) => {
                        const offset = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0
                        if (!offset) return
                        event.preventDefault()
                        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
                        const next = buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement) + offset + buttons.length) % buttons.length]
                        next.focus()
                        next.click()
                      }}>
                        {RATINGS.map(({ id, label, meaning }) => (
                          <Button key={id} role="radio" tabIndex={item.rating === id || !item.rating && id === "red" ? 0 : -1} aria-checked={item.rating === id} title={meaning} size="sm" variant="outline"
                            className={cn(item.rating === id && SELECTED[id])} onClick={() => onChange((current) => setRating(current, item.id, id))}>{label}</Button>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul></CollapsibleContent>
            </Collapsible>
          )) : <Empty className="min-h-40 border"><EmptyHeader><EmptyTitle>No items match these filters</EmptyTitle></EmptyHeader><Button variant="outline" onClick={() => { setQuery(""); setFilter("all") }}>Clear filters</Button></Empty>}
        </>
      ) : (
        <Empty className="min-h-56 border"><EmptyHeader><EmptyMedia variant="icon"><TrafficCone /></EmptyMedia><EmptyTitle>Build your first checklist</EmptyTitle><EmptyDescription>Import it from your study design with any chatbot. Each key knowledge and skill becomes an item you can rate.</EmptyDescription></EmptyHeader><Button onClick={() => setImportOpen(true)}><Link2 />Import checklist</Button></Empty>
      )}

      <StoplightImportDialog key={String(importOpen)} open={importOpen} subjects={subjects} preferredSubjects={data.subjects} defaultSubject={subject || data.subjects[0] || ""} onOpenChange={setImportOpen} onImport={importItems} />
      <StoplightReviseDialog key={`${revising}${subject}`} open={revising} subject={subject} items={subjectItems} evidence={evidence} onOpenChange={setRevising} onApply={applyRatings} />
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => { if (!open) setViewing(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg lg:max-w-2xl">
          <DialogHeader><DialogTitle>{viewing?.name}</DialogTitle><DialogDescription>{viewingMistakes.length} linked mistake{viewingMistakes.length === 1 ? "" : "s"}. Review them in Mistakes.</DialogDescription></DialogHeader>
          <ul className="grid gap-3">
            {viewingMistakes.map((mistake) => (
              <li key={mistake.id} className="grid gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{mistake.question}</span>{mistake.itemsBy === "ai" ? <Badge variant="outline">Linked by ChatGPT</Badge> : null}</div>
                <MarkdownPreview unframed>{mistake.explanation}</MarkdownPreview>
                <MarkdownPreview unframed>{mistake.correction}</MarkdownPreview>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </WorkspacePage>
  )
}
