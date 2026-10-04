import { type FormEvent, type ReactNode, useId } from "react"
import { addDays, addMonths, addWeeks } from "date-fns"
import { Archive, CheckCircle2, Star } from "lucide-react"
import { DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CompactField, DatePickerField, Pill } from "@/components/ui/form-controls"
import { ASSESSMENT_ICONS, VCE_UNITS } from "@/lib/assessmentOptions"
import { type DeadlineType, type Subject } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  useAssessmentForm,
  type AssessmentFormInitialValues,
  type AssessmentFormValues,
} from "@/hooks/useAssessmentForm"

export type { AssessmentFormValues }

interface AssessmentFormProps {
  customSubjects?: Subject[]
  availableSubjects?: Subject[]
  initialValues?: AssessmentFormInitialValues
  submitLabel: string
  onCancel: () => void
  onSubmit: (values: AssessmentFormValues) => void
  showStatusControls?: boolean
  children?: ReactNode
}

const TYPES: { value: DeadlineType; label: string }[] = [
  { value: "assignment", label: "Assignment" },
  { value: "sac", label: "SAC" },
  { value: "exam", label: "Exam" },
]

const QUICK_DUE: { label: string; add: (d: Date) => Date }[] = [
  { label: "Tomorrow", add: (d) => addDays(d, 1) },
  { label: "+1w", add: (d) => addWeeks(d, 1) },
  { label: "+2w", add: (d) => addWeeks(d, 2) },
  { label: "+1m", add: (d) => addMonths(d, 1) },
]

export function AssessmentForm({
  customSubjects = [],
  availableSubjects,
  initialValues,
  submitLabel,
  onCancel,
  onSubmit,
  showStatusControls = false,
  children,
}: AssessmentFormProps) {
  const formId = useId()
  const {
    name, setName,
    description, setDescription,
    icon, setIcon,
    subjectId, setSubjectId,
    unit, setUnit,
    deadline, setDeadline,
    deadlineType, setDeadlineType,
    isFavorite, setIsFavorite,
    isArchived, setIsArchived,
    isFinished, setIsFinished,
    subjects,
    handleSubmit: submitForm,
    canSave,
  } = useAssessmentForm({ customSubjects, availableSubjects, initialValues, onSubmit })

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submitForm()
  }

  const deadlineDate = deadline ? new Date(deadline) : undefined
  const handleDeadlineChange = (date: Date | undefined) => {
    if (!date) return setDeadline("")
    const endOfDay = new Date(date)
    endOfDay.setHours(23, 59, 59, 999)
    setDeadline(endOfDay.toISOString())
  }

  return (
    <form onSubmit={handleSubmit} className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="grid gap-3 overflow-y-auto p-4">
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="size-10 shrink-0 text-xl" aria-label="Choose icon" title="Choose icon">
                {icon}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="grid w-auto grid-cols-8 gap-1 p-2">
              {ASSESSMENT_ICONS.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={icon === option ? "default" : "ghost"}
                  size="icon-sm"
                  className="text-base"
                  aria-label={`Select ${option}`}
                  aria-pressed={icon === option}
                  onClick={() => setIcon(option)}
                >
                  {option}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
          <Input
            id={`${formId}-name`}
            aria-label="Name"
            placeholder="Assessment name, e.g. Methods SAC 2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            autoComplete="off"
            aria-required="true"
            autoFocus
            className="font-medium"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5" role="group" aria-label="Assessment type">
            {TYPES.map((type) => (
              <Pill key={type.value} active={deadlineType === type.value} onClick={() => setDeadlineType(type.value)}>
                {type.label}
              </Pill>
            ))}
          </div>
          {showStatusControls && (
            <div className="flex gap-1.5">
              <Pill active={isFavorite} onClick={() => setIsFavorite((current) => !current)}>
                <Star className={cn("size-3.5", isFavorite && "fill-yellow-400 text-yellow-500")} />Favourite
              </Pill>
              <Pill
                active={isFinished}
                onClick={() => {
                  setIsFinished((current) => !current)
                  if (!isFinished) setIsArchived(false)
                }}
              >
                <CheckCircle2 className={cn("size-3.5", isFinished && "text-green-500")} />Finished
              </Pill>
              <Pill active={isArchived} onClick={() => setIsArchived((current) => !current)}>
                <Archive className="size-3.5" />Archived
              </Pill>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <DatePickerField
              label="Due date"
              date={deadlineDate}
              onDateChange={handleDeadlineChange}
              placeholder="Choose due date"
              clearLabel="Clear"
              formatPattern="EEE d MMM yyyy"
              labelClassName="text-micro font-medium uppercase tracking-wide"
              buttonClassName="h-8 text-sm"
            />
            <div className="flex flex-wrap gap-1">
              {QUICK_DUE.map((quick) => (
                <Pill key={quick.label} className="h-6 px-1.5" onClick={() => handleDeadlineChange(quick.add(new Date()))}>
                  {quick.label}
                </Pill>
              ))}
            </div>
          </div>
          <div className="grid content-start gap-3">
            <CompactField label="Subject">
              <Select value={subjectId || "_none"} onValueChange={(value) => setSubjectId(value === "_none" ? "" : value)}>
                <SelectTrigger className="h-8 w-full text-sm"><SelectValue placeholder="No subject" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No subject</SelectItem>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.icon} {subject.name}{customSubjects.some((item) => item.id === subject.id) ? " (custom)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CompactField>
            <div className="grid gap-1">
              <span className="text-micro font-medium uppercase tracking-wide text-muted-foreground">Unit</span>
              <div className="flex gap-1" role="group" aria-label="Unit">
                {VCE_UNITS.map((item) => (
                  <Pill key={item.value} active={unit === item.value} className="flex-1 justify-center" onClick={() => setUnit(unit === item.value ? "" : item.value)}>
                    {item.value}
                  </Pill>
                ))}
              </div>
            </div>
          </div>
        </div>

        <CompactField label="Description">
          <Input
            placeholder="Optional — what's it about?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            className="h-8 text-sm"
          />
        </CompactField>
        {children}
      </div>

      <DialogFooter className="m-0 rounded-none px-4 py-2.5 sm:justify-between">
        <p className="hidden text-xs text-muted-foreground sm:block">Due date powers Today, Plan and Review.</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!canSave}>{submitLabel}</Button>
        </div>
      </DialogFooter>
    </form>
  )
}
