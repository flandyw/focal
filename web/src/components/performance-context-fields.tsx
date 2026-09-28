import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ContextRating, PerformanceContext } from "@/lib/performance-context"

type PerformanceContextFieldsProps = {
  value: PerformanceContext
  onChange: (value: PerformanceContext) => void
  idPrefix: string
}

const FACTORS = [
  { key: "energy", label: "Energy" },
  { key: "focus", label: "Focus" },
  { key: "stress", label: "Stress" },
  { key: "confidence", label: "Confidence" },
  { key: "preparedness", label: "Preparedness" },
] as const

const ratingLabels = ["Very low", "Low", "Moderate", "High", "Very high"]

export function PerformanceContextFields({ value, onChange, idPrefix }: PerformanceContextFieldsProps) {
  return (
    <fieldset className="grid gap-4 border-t pt-5">
      <div>
        <legend className="text-sm font-medium">Conditions and headspace <span className="text-muted-foreground">(optional)</span></legend>
        <FieldDescription>Rate how you felt when you began. After a few results, Insights can identify conditions linked with stronger performance.</FieldDescription>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-sleep`}>Sleep (hours)</FieldLabel>
          <Input
            id={`${idPrefix}-sleep`}
            type="number"
            min="0"
            max="24"
            step="0.5"
            value={value.sleepHours ?? ""}
            onChange={(event) => onChange({ ...value, sleepHours: event.target.value === "" ? undefined : event.target.valueAsNumber })}
            placeholder="e.g. 7.5"
          />
        </Field>
        {FACTORS.map((factor) => (
          <Field key={factor.key}>
            <FieldLabel htmlFor={`${idPrefix}-${factor.key}`}>{factor.label}</FieldLabel>
            <Select
              value={value[factor.key]?.toString() ?? "unset"}
              onValueChange={(next) => onChange({ ...value, [factor.key]: next === "unset" ? undefined : Number(next) as ContextRating })}
            >
              <SelectTrigger id={`${idPrefix}-${factor.key}`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Not recorded</SelectItem>
                {ratingLabels.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{index + 1} · {label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        ))}
      </div>
    </fieldset>
  )
}
