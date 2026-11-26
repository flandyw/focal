import { X } from "lucide-react"

import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./ui/select"
import { sameStudySubject } from "../lib/studySubjects"
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
  const options = items.filter((item) => (!subject || sameStudySubject(item.subject, subject)) && !value.includes(item.id))
  const groups = groupBy(options, (item) => `${subject ? "" : `${item.subject} · `}${itemGroup(item)}`)
  // Links to archived or deleted items still count toward the cap, so keep them visible and removable.
  const missing = value.filter((itemId) => !items.some((item) => item.id === itemId))
  const chosen = value.map((itemId) => {
    const item = items.find((candidate) => candidate.id === itemId)
    const index = missing.indexOf(itemId)
    return { id: itemId, name: item?.name ?? `Unavailable item${missing.length > 1 ? ` ${index + 1}` : ""}`, missing: !item }
  })
  return (
    <div className="grid gap-2">
      {chosen.length ? <div className="flex flex-wrap gap-1.5">{chosen.map((item) => (
        <Badge key={item.id} variant={item.missing ? "outline" : "secondary"} className="h-auto max-w-full gap-1 whitespace-normal" title={item.missing ? "This item was archived or removed" : undefined}>
          <span className={item.missing ? "min-w-0 break-words text-left text-muted-foreground" : "min-w-0 break-words text-left"}>{item.name}</span>
          <Button type="button" variant="ghost" size="icon-xs" className="size-4" aria-label={`Remove ${item.name}`} onClick={() => onChange(value.filter((itemId) => itemId !== item.id))}><X /></Button>
        </Badge>
      ))}</div> : null}
      {value.length >= 3 ? <p className="text-xs text-muted-foreground">Three items linked. Remove one to choose another.</p> : !options.length ? <p className="text-xs text-muted-foreground">{chosen.length ? "All available items are linked." : "No stoplight items for this subject. Add them in Stoplight first."}</p> : null}
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
