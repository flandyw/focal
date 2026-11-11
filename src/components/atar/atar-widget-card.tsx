import { useEffect, useRef } from "react"
import { RefreshCw, RotateCcw } from "lucide-react"
import { Button } from "../ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { Label } from "../ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { Switch } from "../ui/switch"
import { AtarTargetInput } from "./atar-estimate-card"
import type { SavedAtarEstimate } from "../../lib/exam-data"
import { refreshWidgets, setWidgetAtarSettings, takeWidgetFocus, useWidgetState, type WidgetAtarSettings } from "../../lib/widgets"

const time = (value: number) => new Date(value).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })

/** Mirrors the macOS ATAR widget and controls what it shows. */
export function AtarWidgetCard({ saved, target, onTargetChange, onLoad }: {
  saved: SavedAtarEstimate[]
  target: number | null
  onTargetChange: (target: number | null) => void
  onLoad: (saved: SavedAtarEstimate) => void
}) {
  const { settings, atar, sentAt, error, focus } = useWidgetState()
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focus && takeWidgetFocus()) card.current?.scrollIntoView({ block: "center" }) }, [focus])

  const ordered = saved.toSorted((first, second) => second.savedAt.localeCompare(first.savedAt))
  const scenario = saved.find((item) => item.id === atar?.scenarioId)
  const pinMissing = !["latest", "live"].includes(settings.source) && !saved.some((item) => item.id === settings.source)
  const sourceLabel = (value: string) => value === "latest" ? "Newest saved scenario" : value === "live" ? "Live Focal estimate"
    : ((item) => item ? `Pinned: ATAR ${item.atarLabel} · ${new Date(item.savedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}` : "Pinned scenario (deleted)")(saved.find((item) => item.id === value))
  const toggles: { key: keyof Omit<WidgetAtarSettings, "source">; label: string }[] = [
    { key: "target", label: "Target and gap" },
    { key: "change", label: "Change since last estimate" },
    { key: "subjects", label: "Subjects (large widget)" },
  ]

  return (
    <Card ref={card} id="atar-widget" tabIndex={-1} className="outline-none">
      <CardHeader>
        <CardTitle>Desktop widget</CardTitle>
        <CardDescription>What the macOS ATAR widget shows, and where it comes from.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2 rounded-lg border bg-muted/40 p-4" aria-live="polite">
          {atar ? (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Estimated rank</p>
                  <p className="text-4xl font-semibold tracking-tight tabular-nums text-primary">{atar.label}</p>
                </div>
                {atar.target !== null ? (
                  <div className="text-right tabular-nums">
                    <p className="text-xs text-muted-foreground">Target</p>
                    <p className="text-lg font-medium">{atar.target.toFixed(2)}</p>
                    {atar.gap !== null ? <p className="text-xs text-muted-foreground">{atar.gap > 0 ? `${atar.gap.toFixed(2)} to go` : "Target reached"}</p> : null}
                  </div>
                ) : null}
              </div>
              {atar.change !== null && Math.abs(atar.change) >= 0.005 ? <p className="text-xs text-muted-foreground tabular-nums">{atar.change > 0 ? "▲" : "▼"} {Math.abs(atar.change).toFixed(2)} since last estimate</p> : null}
              <p className="text-xs text-muted-foreground tabular-nums">Aggregate {atar.aggregate.toFixed(2)} · {atar.year} VTAC</p>
              {atar.subjects.length ? (
                <ul className="grid gap-1 border-t pt-2 text-xs">
                  {atar.subjects.map((subject) => (
                    <li key={subject.name} className="flex justify-between gap-2 tabular-nums">
                      <span className="truncate">{subject.name}</span><span className="text-muted-foreground">{subject.scaled.toFixed(1)} · {subject.increment ? "10%" : "100%"}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="border-t pt-2 text-xs text-muted-foreground">
                {atar.source}, recomputed with your latest practice results.
              </p>
            </>
          ) : atar === null ? (
            <p className="text-sm text-muted-foreground">
              {settings.source === "live" ? "No estimate: add practice results for four subjects including English, or enter scores and save a scenario."
                : saved.length ? "The scenario no longer forms an estimate with current scores. Load it, fix its studies and save again, or switch to the live estimate."
                : "No estimate yet. Save a scenario or switch to the live Focal estimate."}
            </p>
          ) : <p className="text-sm text-muted-foreground">Not sent yet. Sign in and let Focal sync; the widget updates within a few seconds.</p>}
          <p className="text-xs text-muted-foreground">
            {error ? `Could not update the widget: ${error}` : sentAt ? `Sent to the widget at ${time(sentAt)}. macOS decides when it redraws.` : null}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="atar-widget-source">Shows</Label>
          <Select value={settings.source} onValueChange={(value) => { if (value) setWidgetAtarSettings({ source: value }) }}>
            <SelectTrigger id="atar-widget-source" className="w-full"><SelectValue>{sourceLabel(settings.source)}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Newest saved scenario</SelectItem>
              <SelectItem value="live">Live Focal estimate</SelectItem>
              {ordered.map((item) => <SelectItem key={item.id} value={item.id}>{sourceLabel(item.id)}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {pinMissing ? "The pinned scenario was deleted, so the widget shows the newest one."
              : settings.source === "live" ? "Your subjects, each on its Focal estimate from practice results. No saving needed."
              : "Saving a scenario on this page updates the widget. Pin one to keep it fixed."}
          </p>
        </div>

        <div className="grid gap-3">
          {toggles.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <Label htmlFor={`atar-widget-${key}`}>{label}</Label>
              <Switch id={`atar-widget-${key}`} checked={settings[key]} onCheckedChange={(checked) => setWidgetAtarSettings({ [key]: checked })} />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="atar-widget-target">Target ATAR</Label>
            <AtarTargetInput id="atar-widget-target" target={target} onTargetChange={onTargetChange} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {scenario ? <Button variant="outline" size="sm" onClick={() => onLoad(scenario)}><RotateCcw />Edit this scenario</Button> : null}
          <Button variant="outline" size="sm" onClick={refreshWidgets}><RefreshCw />Refresh widget</Button>
        </div>
      </CardContent>
    </Card>
  )
}
