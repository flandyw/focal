import { Check, Circle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader } from "../ui/card"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { isEnglishStudy } from "../../lib/atar"
import type { AtarModel } from "../../lib/atar-model"

export function AtarEstimateCard({ model, onTargetChange }: { model: AtarModel; onTargetChange: (target: number | null) => void }) {
  const { estimate, results, year } = model
  const counted = estimate ? [...estimate.primaryFour, ...estimate.increments] : []
  const hasEnglish = results.some((result) => isEnglishStudy(result.code))
  const missingScores = Math.max(hasEnglish ? 0 : 1, 4 - results.length)
  const emptyGuidance = missingScores
    ? `Add scores for ${missingScores} more ${missingScores === 1 ? "subject" : "subjects"}${hasEnglish ? "" : " including English"}. Choose Focal estimate or Manual in Studies.`
    : "These studies do not form an eligible VTAC combination. Add a study from another study area."
  const requirements = [
    { label: "Four or more studies with a score", met: results.length >= 4 },
    { label: "An English-group study", met: hasEnglish },
  ]

  return (
    <Card className="max-lg:order-first">
      <CardHeader><CardDescription>Estimated ATAR</CardDescription></CardHeader>
      <CardContent className="grid gap-5">
        <div>
          <p className="text-6xl font-semibold tracking-tight tabular-nums">{estimate?.atarLabel ?? "—"}</p>
          <p className="mt-2 text-sm text-muted-foreground tabular-nums">{estimate ? `Aggregate ${estimate.aggregate.toFixed(2)} · ${year} conversion` : emptyGuidance}</p>
          {model.range ? <p className="mt-1 text-sm text-muted-foreground tabular-nums">Likely {model.range.low}–{model.range.high} across Focal estimate ranges</p> : null}
        </div>
        {estimate ? (
          <>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {counted.map((item) => <span key={item.id} className={item.role === "Increment" ? "bg-primary/35" : "bg-primary"} style={{ width: `${(item.contribution / estimate.aggregate) * 100}%` }} />)}
            </div>
            {estimate.excluded.length > 0 ? <p className="text-xs text-muted-foreground">Not counted under VTAC combination limits: {estimate.excluded.map((item) => item.studyName).join(", ")}.</p> : null}
          </>
        ) : (
          <ul className="grid gap-2 text-sm">
            {requirements.map((item) => (
              <li key={item.label} className={`flex items-center gap-2 ${item.met ? "" : "text-muted-foreground"}`}>
                {item.met ? <Check className="size-4 text-primary" aria-hidden /> : <Circle className="size-4" aria-hidden />}
                {item.label}<span className="sr-only">{item.met ? " (met)" : " (not yet met)"}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="atar-target">Target ATAR</Label>
            <AtarTargetInput id="atar-target" target={model.target} onTargetChange={onTargetChange} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {model.target === null ? "Set a target to see the gap. It is saved as your ATAR goal."
              : model.gap === null ? `Target ${model.target.toFixed(2)}${model.targetAggregate !== null ? ` needs an aggregate of ${model.targetAggregate.toFixed(2)}` : ""}.`
              : model.gap > 0 ? `${model.gap.toFixed(2)} below target · ${model.aggregateGap !== null ? `${model.aggregateGap.toFixed(2)} more aggregate needed (${model.targetAggregate!.toFixed(2)})` : ""}`
              : `On or above target by ${Math.abs(model.gap).toFixed(2)}`}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function AtarTargetInput({ id, target, onTargetChange }: { id: string; target: number | null; onTargetChange: (target: number | null) => void }) {
  function commit(value: string) {
    const next = value.trim() === "" ? null : Number(value)
    if (next === target) return
    if (next === null || (Number.isFinite(next) && next >= 1 && next <= 99.95)) onTargetChange(next)
  }
  return (
    <Input
      id={id}
      key={String(target)}
      className="w-24 text-right tabular-nums"
      type="number"
      inputMode="decimal"
      min="1"
      max="99.95"
      step="0.05"
      placeholder="None"
      defaultValue={target ?? ""}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }}
    />
  )
}
