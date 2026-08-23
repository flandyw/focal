import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
} from "@/features/timer/model"

interface DurationInputsProps {
  variant: "focus" | "sidebar"
  settings: {
    workMinutes: number
    breakMinutes: number
    longBreakMinutes: number
  }
  onChange: (key: "workMinutes" | "breakMinutes" | "longBreakMinutes", value: string) => void
}

function Stepper({
  label,
  value,
  onChange,
  compact,
}: {
  label: string
  value: number
  onChange: (value: string) => void
  compact?: boolean
}) {
  const decrement = () => onChange(String(Math.max(MIN_DURATION_MINUTES, value - 1)))
  const increment = () => onChange(String(Math.min(MAX_DURATION_MINUTES, value + 1)))

  if (compact) {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-micro font-medium text-muted-foreground">{label}</span>
        <Input
          type="number"
          min={MIN_DURATION_MINUTES}
          max={MAX_DURATION_MINUTES}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onWheel={(event) => event.currentTarget.blur()}
          className="h-7 px-2 text-center text-xs tabular-nums shadow-none"
          aria-label={`${label} minutes`}
        />
      </label>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="block text-micro font-semibold uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      <div className="flex items-center rounded-lg border">
        <Button
          variant="ghost"
          size="icon"
          onClick={decrement}
          disabled={value <= MIN_DURATION_MINUTES}
          aria-label={`Decrease ${label}`}
        >
          −
        </Button>
        <Input
          type="number"
          min={MIN_DURATION_MINUTES}
          max={MAX_DURATION_MINUTES}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onWheel={(event) => event.currentTarget.blur()}
          className="min-w-0 flex-1 appearance-none border-0 px-0 text-center tabular-nums shadow-none focus-visible:ring-0"
          aria-label={`${label} minutes`}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={increment}
          disabled={value >= MAX_DURATION_MINUTES}
          aria-label={`Increase ${label}`}
        >
          +
        </Button>
      </div>
    </div>
  )
}

export function DurationInputs({ variant, settings, onChange }: DurationInputsProps) {
  const compact = variant === "sidebar"
  const fields = [
    ["workMinutes", "Focus"] as const,
    ["breakMinutes", "Break"] as const,
    ["longBreakMinutes", "Long"] as const,
  ]

  return (
    <div className={cn("grid grid-cols-3", compact ? "gap-1.5" : "gap-2")}>
      {fields.map(([key, label]) => (
        <Stepper
          key={key}
          label={label}
          value={settings[key]}
          onChange={(value) => onChange(key, value)}
          compact={compact}
        />
      ))}
    </div>
  )
}
