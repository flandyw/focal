import { useMemo } from "react"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { isPreferredSubject, prioritiseSubjects } from "@/lib/subjects"

const ALL_SUBJECTS = "All subjects"

export function SubjectCombobox({
  subjects,
  preferredSubjects,
  value,
  onValueChange,
  id,
  className,
  includeAll = false,
  allowCustom = false,
  required = false,
  placeholder = "Search subjects",
}: {
  subjects: string[]
  preferredSubjects: string[]
  value: string
  onValueChange: (value: string) => void
  id?: string
  className?: string
  includeAll?: boolean
  allowCustom?: boolean
  required?: boolean
  placeholder?: string
}) {
  const items = useMemo(() => [
    ...(includeAll ? [ALL_SUBJECTS] : []),
    ...prioritiseSubjects(subjects, preferredSubjects),
  ], [includeAll, preferredSubjects, subjects])
  const displayValue = includeAll && value === "all" ? ALL_SUBJECTS : value

  return (
    <Combobox
      items={items}
      value={items.includes(displayValue) ? displayValue : null}
      inputValue={allowCustom ? displayValue : undefined}
      onInputValueChange={allowCustom ? (next) => onValueChange(next === ALL_SUBJECTS ? "all" : next) : undefined}
      onValueChange={(next) => onValueChange(next === ALL_SUBJECTS ? "all" : (next ?? ""))}
      autoHighlight
    >
      <ComboboxInput id={id} className={className} placeholder={placeholder} showClear={allowCustom} required={required} />
      <ComboboxContent>
        <ComboboxEmpty>No matching subjects.</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem
              key={item}
              value={item}
              className={item !== ALL_SUBJECTS && isPreferredSubject(item, preferredSubjects) ? "font-semibold" : undefined}
            >
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
