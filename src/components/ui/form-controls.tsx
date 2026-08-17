import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { useId, type ComponentProps, type ReactNode } from "react"
import type { Matcher } from "react-day-picker"
import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface FormFieldProps extends ComponentProps<"div"> {
  label: string
  controlId?: string
  hint?: string
  hintId?: string
  labelAccessory?: ReactNode
  labelClassName?: string
  children: ReactNode
}

function FormField({ label, controlId, hint, hintId, labelAccessory, labelClassName, className, children, ...props }: FormFieldProps) {
  const labelElement = <label htmlFor={controlId} className={cn("text-control font-medium text-muted-foreground", labelClassName)}>{label}</label>

  return (
    <div className={cn("grid gap-2", className)} {...props}>
      {labelAccessory ? (
        <div className="flex items-center justify-between gap-3">
          {labelElement}
          {labelAccessory}
        </div>
      ) : labelElement}
      {children}
      {hint && <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

interface SelectFieldProps {
  label: string
  hint?: string
  labelClassName?: string
  className?: string
  placeholder?: string
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
}

function SelectField({ label, hint, labelClassName, className, placeholder, value, onValueChange, options }: SelectFieldProps) {
  const generatedId = useId()
  const controlId = `${generatedId}-select`
  const hintId = hint ? `${generatedId}-hint` : undefined

  return (
    <FormField label={label} controlId={controlId} hint={hint} hintId={hintId} labelClassName={labelClassName}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={controlId} aria-describedby={hintId} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

interface DatePickerFieldProps {
  id?: string
  label: string
  date?: Date
  onDateChange: (date: Date | undefined) => void
  disabledDays?: Matcher | Matcher[]
  invalid?: boolean
  placeholder?: string
  formatPattern?: string
  clearLabel?: string
  buttonClassName?: string
  labelClassName?: string
}

function DatePickerField({
  id,
  label,
  date,
  onDateChange,
  disabledDays,
  invalid,
  placeholder = "Pick date",
  formatPattern = "PPP",
  clearLabel,
  buttonClassName,
  labelClassName,
}: DatePickerFieldProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId

  return (
    <FormField label={label} controlId={controlId} labelClassName={labelClassName}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={controlId}
            type="button"
            variant="outline"
            aria-haspopup="dialog"
            aria-invalid={invalid}
            className={cn(
              "w-full justify-start bg-background/65 text-left font-normal",
              !date && "text-muted-foreground",
              buttonClassName
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" aria-hidden="true" />
            {date ? format(date, formatPattern) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={onDateChange}
            disabled={disabledDays}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {date && clearLabel && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 justify-self-start px-2 text-xs text-muted-foreground"
          onClick={() => onDateChange(undefined)}
          aria-label={`${clearLabel}: ${label}`}
        >
          {clearLabel}
        </Button>
      )}
    </FormField>
  )
}

interface ChoiceOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

interface ChoiceGridProps<T extends string> {
  options: ChoiceOption<T>[]
  value: T | ""
  onChange: (value: T | "") => void
  className?: string
}

function ChoiceGrid<T extends string>({ options, value, onChange, className }: ChoiceGridProps<T>) {
  return (
    <div className={cn("grid gap-2", className)}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          onClick={() => onChange(value === option.value ? "" : option.value)}
          variant={value === option.value ? "default" : "outline"}
          className="h-auto min-h-10"
          aria-pressed={value === option.value}
        >
          {option.icon} {option.label}
        </Button>
      ))}
    </div>
  )
}

interface EmojiPickerProps<T extends string> {
  label: string
  options: readonly T[]
  value: T
  onChange: (value: T) => void
}

function EmojiPicker<T extends string>({ label, options, value, onChange }: EmojiPickerProps<T>) {
  return (
    <FormField label={label}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            variant={value === option ? "default" : "ghost"}
            size="icon-lg"
            className="text-base"
            aria-label={`Select ${option}`}
            aria-pressed={value === option}
          >
            {option}
          </Button>
        ))}
      </div>
    </FormField>
  )
}

interface ToggleChipProps {
  active: boolean
  onToggle: () => void
  icon?: ReactNode
  children: ReactNode
  activeClassName?: string
}

function ToggleChip({ active, onToggle, icon, children, activeClassName }: ToggleChipProps) {
  return (
    <Button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      variant={active ? "default" : "outline"}
      className={activeClassName}
    >
      {icon}
      {children}
    </Button>
  )
}

interface FormSectionProps extends ComponentProps<"section"> {
  title: string
  icon?: ReactNode
  children: ReactNode
}

function FormSection({ title, icon, className, children, ...props }: FormSectionProps) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className={cn("grid gap-3", className)} {...props}>
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

export { ChoiceGrid, DatePickerField, EmojiPicker, FormField, FormSection, SelectField, ToggleChip }
