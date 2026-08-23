import { type FormEvent, useId } from"react"
import { Archive, CalendarDays, CheckCircle2, Star } from"lucide-react"
import { DialogBody, DialogFooter } from"@/components/ui/dialog"
import { Button } from"@/components/ui/button"
import { Input } from"@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
 DatePickerField,
 EmojiPicker,
 FormField,
 SelectField,
 ToggleChip,
} from"@/components/ui/form-controls"
import { ASSESSMENT_ICONS, VCE_UNITS } from"@/lib/assessmentOptions"
import { type DeadlineType, type Subject, type Unit } from"@/lib/types"
import { cn } from"@/lib/utils"
import {
 useAssessmentForm,
 type AssessmentFormInitialValues,
 type AssessmentFormValues,
} from"@/hooks/useAssessmentForm"

export type { AssessmentFormValues }

interface AssessmentFormProps {
 customSubjects?: Subject[]
 availableSubjects?: Subject[]
 initialValues?: AssessmentFormInitialValues
 submitLabel: string
 onCancel: () => void
 onSubmit: (values: AssessmentFormValues) => void
 showStatusControls?: boolean
}

export function AssessmentForm({
 customSubjects = [],
 availableSubjects,
 initialValues,
 submitLabel,
 onCancel,
 onSubmit,
 showStatusControls = false,
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
 } = useAssessmentForm({
 customSubjects,
 availableSubjects,
 initialValues,
 onSubmit,
 })

 const handleSubmit = (event: FormEvent) => {
 event.preventDefault()
 submitForm()
 }

 const deadlineDate = deadline ? new Date(deadline) : undefined
 const handleDeadlineChange = (date: Date | undefined) => {
   if (!date) {
     setDeadline("")
     return
   }
   const deadlineAtEndOfDay = new Date(date)
   deadlineAtEndOfDay.setHours(23, 59, 59, 999)
   setDeadline(deadlineAtEndOfDay.toISOString())
 }

 return (
 <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
 <DialogBody className="flex max-h-[min(68vh,38rem)]">
 <ScrollArea className="min-h-0 flex-1">
 <div className="grid gap-5 py-1 pr-1">
 <div className="grid gap-4 sm:grid-cols-2">
 <FormField
 label="Name"
 controlId={`${formId}-name`}
 labelAccessory={<span className="text-micro font-normal tabular-nums text-muted-foreground">{name.length}/120</span>}
 >
 <Input
 id={`${formId}-name`}
 placeholder="e.g. Methods SAC 2"
 value={name}
 onChange={(event) => setName(event.target.value)}
 maxLength={120}
 autoComplete="off"
 aria-required="true"
 autoFocus
 />
 </FormField>
 <FormField
 label="Description"
 controlId={`${formId}-description`}
 labelAccessory={<span className="text-micro font-normal tabular-nums text-muted-foreground">{description.length}/500</span>}
 >
 <Input
 id={`${formId}-description`}
 placeholder="Optional — brief description"
 value={description}
 onChange={(event) => setDescription(event.target.value)}
 maxLength={500}
 />
 </FormField>
 </div>

 <div className="grid gap-4 sm:grid-cols-2">
 <SelectField
 label="Assessment type"
 value={deadlineType}
 onValueChange={(value) => setDeadlineType(value as DeadlineType)}
 options={[
 { value:"assignment", label:"Assignment" },
 { value:"sac", label:"SAC" },
 { value:"exam", label:"Exam" },
 ]}
 />

 <DatePickerField
 label="Due date"
 date={deadlineDate}
 onDateChange={handleDeadlineChange}
 placeholder="Choose due date"
 clearLabel="Clear due date"
 />
 </div>

 <div className="grid gap-4 sm:grid-cols-2">
 <SelectField
 label="Subject"
 value={subjectId ||"_none"}
 onValueChange={(value) => setSubjectId(value ==="_none" ?"" : value)}
 placeholder="No subject"
 options={[
 { value:"_none", label:"No subject" },
 ...subjects.map((subject) => ({ value: subject.id, label: `${subject.icon} ${subject.name}${customSubjects.some((item) => item.id === subject.id) ?" (custom)" :""}` })),
 ]}
 />

 <SelectField
 label="Unit"
 value={unit ||"_none"}
 onValueChange={(value) => setUnit(value ==="_none" ?"" : value as Unit |"")}
 placeholder="None"
 options={[
 { value:"_none", label:"None" },
 ...VCE_UNITS.map((item) => ({ value: item.value, label: item.label })),
 ]}
 />
 </div>

 {showStatusControls && (
 <EmojiPicker
 label="Icon"
 options={ASSESSMENT_ICONS}
 value={icon}
 onChange={setIcon}
 />
 )}

 {!showStatusControls && (
 <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
 <CalendarDays className="h-4 w-4" />
 The due date powers Today, Plan, and Review recommendations.
 </div>
 )}

 {showStatusControls && (
 <div className="flex flex-wrap items-center gap-2">
 <ToggleChip
 active={isFavorite}
 onToggle={() => setIsFavorite((current) => !current)}
 icon={<Star className={cn("h-3.5 w-3.5", isFavorite &&"fill-yellow-400")} />}
 activeClassName="border-yellow-300 bg-yellow-50 text-yellow-700 dark:border-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400"
 >
 Favorite
 </ToggleChip>
 <ToggleChip
 active={isFinished}
 onToggle={() => {
 setIsFinished((current) => !current)
 if (!isFinished) setIsArchived(false)
 }}
 icon={<CheckCircle2 className={cn("h-3.5 w-3.5", isFinished &&"text-green-500")} />}
 activeClassName="border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/20 dark:text-green-400"
 >
 Finished
 </ToggleChip>
 <ToggleChip
 active={isArchived}
 onToggle={() => setIsArchived((current) => !current)}
 icon={<Archive className="h-3.5 w-3.5" />}
 activeClassName="border-muted-foreground/30 bg-muted text-muted-foreground"
 >
 Archived
 </ToggleChip>
 </div>
 )}
 </div>
 </ScrollArea>
 </DialogBody>

 <DialogFooter className="mt-5">
 <Button type="button" variant="outline" onClick={onCancel}>
 Cancel
 </Button>
 <Button type="submit" disabled={!canSave}>
 {submitLabel}
 </Button>
 </DialogFooter>
 </form>
 )
}
