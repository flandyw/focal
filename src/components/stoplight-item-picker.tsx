import { X } from "lucide-react"

import { Badge } from "./ui/badge"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./ui/select"
import { groupBy, itemGroup } from "../lib/stoplight"
import type { CurriculumArea } from "../lib/learning-workspace"

/** Links a record to up to three stoplight items; `subject` narrows the list when known. */
export function StoplightItemPicker({ id, items, subject, value, onChange }: {
  id?: string
  items: CurriculumArea[]
  subject?: string
  value: string[]
  onChange: (value: string[]) => void
}) {
  const options = items.filter((item) => item.group && (!subject || item.subject.toLowerCase() === subject.toLowerCase()) && !value.includes(item.id))
  const groups = groupBy(options, (item) => `${subject ? "" : `${item.subject} · `}${itemGroup(item)}`)
  const chosen = value.flatMap((itemId) => items.find((item) => item.id === itemId) ?? [])
  return (
    <div className="grid gap-2">
      {chosen.length ? <div className="flex flex-wrap gap-1.5">{chosen.map((item) => (
        <Badge key={item.id} variant="secondary" className="gap-1">
          {item.name}
          <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onChange(value.filter((itemId) => itemId !== item.id))}><X className="size-3" /></button>
        </Badge>
      ))}</div> : null}
      {value.length < 3 && options.length ? (
        <Select value="" onValueChange={(next) => next && onChange([...value, next])}>
          <SelectTrigger id={id} className="w-full"><SelectValue>Add a stoplight item</SelectValue></SelectTrigger>
          <SelectContent>{[...groups].map(([group, groupItems]) => (
            <SelectGroup key={group}><SelectLabel>{group}</SelectLabel>{groupItems.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup>
          ))}</SelectContent>
        </Select>
      ) : null}
    </div>
  )
}
