import { Check, Circle } from "lucide-react"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { isEnglishStudy } from "../../lib/atar"
import type { AtarModel } from "../../lib/atar-model"

/** The answer first: the estimate, how sure it is, and the distance to the target. */
export function AtarSummary({ model, onTargetChange }: { model: AtarModel; onTargetChange: (target: number | null) => void }) {
  const { estimate, results, year } = model
  const hasEnglish = results.some((result) => isEnglishStudy(result.code))
  const missingScores = Math.max(hasEnglish ? 0 : 1, 4 - results.length)
  const emptyGuidance = missingScores
    ? `Score ${missingScores} more ${missingScores === 1 ? "study" : "studies"}${hasEnglish ? "" : " including English"} below to get an estimate.`
    : "These studies do not form an eligible VTAC combination. Add a study from another study area."
  const requirements = [
    { label: "Four or more studies with a score", met: results.length >= 4 },
    { label: "An English-group study", met: hasEnglish },
  ]

  return (
    <section aria-label="Estimated ATAR" className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">Estimated ATAR</p>
        {estimate
          ? <p className="mt-1 text-7xl leading-none font-semibold tracking-tight tabular-nums sm:text-8xl">{estimate.atarLabel}</p>
          : <p className="mt-2 focal-section-title tracking-tight">No estimate yet</p>}
        <p className="mt-3 text-sm text-muted-foreground tabular-nums text-pretty">
          {estimate ? `Aggregate ${estimate.aggregate.toFixed(2)} · ${year} conversion${model.range ? ` · likely ${model.range.low}–${model.range.high}` : ""}` : emptyGuidance}
        </p>
        {estimate ? null : (
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {requirements.map((item) => (
              <li key={item.label} className={`flex items-center gap-2 ${item.met ? "" : "text-muted-foreground"}`}>
                {item.met ? <Check className="size-4 text-primary" aria-hidden /> : <Circle className="size-4" aria-hidden />}
                {item.label}<span className="sr-only">{item.met ? " (met)" : " (not yet met)"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-2 sm:justify-items-end sm:text-right">
        <div className="flex items-center gap-3">
          <Label htmlFor="atar-target">Target ATAR</Label>
          <AtarTargetInput id="atar-target" target={model.target} onTargetChange={onTargetChange} />
        </div>
        <p className="max-w-xs text-sm text-muted-foreground tabular-nums text-pretty" aria-live="polite">
          {model.target === null ? "Set a target to see the gap. It is saved as your ATAR goal."
            : model.gap === null ? `Target ${model.target.toFixed(2)}${model.targetAggregate !== null ? ` needs an aggregate of ${model.targetAggregate.toFixed(2)}` : ""}.`
            : model.gap > 0 ? <><span className="font-medium text-foreground">{model.gap.toFixed(2)} below target.</span>{model.aggregateGap !== null ? ` ${model.aggregateGap.toFixed(2)} more aggregate needed (${model.targetAggregate!.toFixed(2)}).` : ""}</>
            : <span className="font-medium text-foreground">On or above target by {Math.abs(model.gap).toFixed(2)}.</span>}
        </p>
      </div>
    </section>
  )
}

function AtarTargetInput({ id, target, onTargetChange }: { id: string; target: number | null; onTargetChange: (target: number | null) => void }) {
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
