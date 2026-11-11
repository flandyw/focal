import { RotateCcw, Trash2 } from "lucide-react"
import { Button } from "../ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card"
import type { SavedAtarEstimate } from "../../lib/exam-data"

export function AtarScenariosCard({ saved, onLoad, onDelete }: { saved: SavedAtarEstimate[]; onLoad: (saved: SavedAtarEstimate) => void; onDelete: (saved: SavedAtarEstimate) => void }) {
  const ordered = saved.toSorted((first, second) => second.savedAt.localeCompare(first.savedAt))
  return (
    <Card>
      <CardHeader><CardTitle>Saved scenarios</CardTitle></CardHeader>
      <CardContent>
        {ordered.length ? (
          <ul className="grid divide-y">
            {ordered.map((item) => (
              <li key={item.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium tabular-nums">ATAR {item.atarLabel}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.year} VTAC · {new Date(item.savedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onLoad(item)}><RotateCcw />Load</Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete saved ATAR ${item.atarLabel}`} onClick={() => onDelete(item)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Save a scenario to compare subject choices or come back to these inputs.</p>}
      </CardContent>
    </Card>
  )
}
