import { useState } from "react"
import { Check, Pencil, RotateCcw, Trash2, X } from "lucide-react"
import { Button } from "../ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { Input } from "../ui/input"
import type { AtarEstimate } from "../../lib/atar"
import type { SavedAtarEstimate } from "../../lib/exam-data"

function scenarioDelta(item: SavedAtarEstimate, current: AtarEstimate | null) {
  if (!current) return null
  const savedAtar = item.atarLabel.trim() ? Number(item.atarLabel) : NaN
  if (Number.isFinite(savedAtar) && current.atar !== null) {
    const diff = Math.round((savedAtar - current.atar) * 100) / 100
    if (Math.abs(diff) < 0.005) return { label: "Matches now", tone: "neutral" as const }
    return { label: `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(2)}`, tone: diff > 0 ? "positive" as const : "negative" as const }
  }
  if (item.aggregate !== null) {
    const diff = Math.round((item.aggregate - current.aggregate) * 100) / 100
    if (Math.abs(diff) < 0.005) return { label: item.atarLabel === current.atarLabel ? "Matches now" : "Same agg", tone: "neutral" as const }
    return { label: `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(2)} agg`, tone: diff > 0 ? "positive" as const : "negative" as const }
  }
  return null
}

export function AtarScenariosCard({ saved, currentEstimate, onLoad, onRename, onDelete }: {
  saved: SavedAtarEstimate[]
  currentEstimate: AtarEstimate | null
  onLoad: (saved: SavedAtarEstimate) => void
  onRename: (saved: SavedAtarEstimate, name: string) => void
  onDelete: (saved: SavedAtarEstimate) => void
}) {
  const ordered = saved.toSorted((first, second) => second.savedAt.localeCompare(first.savedAt))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  function startEdit(item: SavedAtarEstimate) {
    setEditingId(item.id)
    setDraft(item.name ?? "")
  }

  function commitEdit(item: SavedAtarEstimate) {
    const next = draft.trim()
    setEditingId(null)
    if (next !== (item.name ?? "")) onRename(item, next)
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Saved scenarios</CardTitle>
        {ordered.length && currentEstimate ? <CardDescription>Differences compare each saved scenario with your current estimate.</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {ordered.length ? (
          <ul className="divide-y">
            {ordered.map((item) => {
              const dateLabel = new Date(item.savedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
              const studyCount = item.rows.filter((row) => row.code).length
              const delta = scenarioDelta(item, currentEstimate)
              const labelBase = `${item.name ? `${item.name}, ` : ""}ATAR ${item.atarLabel}, ${item.year} VTAC, saved ${dateLabel}`
              const deltaClass = delta?.tone === "positive" ? "text-success" : delta?.tone === "negative" ? "text-destructive" : "text-muted-foreground"
              return (
                <li key={item.id} className="min-w-0 py-2.5 first:pt-0 last:pb-0">
                  {editingId === item.id ? (
                    <form className="flex min-w-0 items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); commitEdit(item) }}>
                      <Input
                        autoFocus
                        aria-label="Scenario name"
                        className="h-8 min-w-0 flex-1 text-sm"
                        maxLength={60}
                        placeholder="Scenario name (optional)"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Escape") setEditingId(null) }}
                      />
                      <Button type="submit" variant="secondary" size="icon-sm" aria-label="Save scenario name"><Check /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel rename" onClick={() => setEditingId(null)}><X /></Button>
                    </form>
                  ) : (
                    <div className="grid gap-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {item.name ? <p className="truncate text-sm font-medium">{item.name}</p> : null}
                          <p className={`flex flex-wrap items-baseline gap-x-2 tabular-nums ${item.name ? "text-xs" : "text-sm font-medium"}`}>
                            <span className={item.name ? "font-medium text-foreground" : undefined}>ATAR {item.atarLabel}</span>
                            {delta ? <span className={`text-xs font-normal ${deltaClass}`}>{delta.label}</span> : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button variant="ghost" size="sm" aria-label={`Load saved ${labelBase}`} onClick={() => onLoad(item)}><RotateCcw />Load</Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Rename saved ${labelBase}`} onClick={() => startEdit(item)}><Pencil /></Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Delete saved ${labelBase}`} onClick={() => onDelete(item)}><Trash2 /></Button>
                        </div>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{item.year} VTAC · {studyCount} {studyCount === 1 ? "study" : "studies"} · {dateLabel}</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Save a scenario to compare subject choices or come back to these inputs.</p>}
      </CardContent>
    </Card>
  )
}
