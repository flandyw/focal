import { useRef } from "react"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import type { Subject } from "@/lib/types"

interface SubjectPickerProps {
  variant: "focus" | "sidebar"
  subjects: Subject[]
  selectedSubjectIds: string[]
  activeSessionId: string | null
  disabled?: boolean
  onSubjectClick: (subjectId: string) => void
  onManageSubjects?: () => void
}

export function SubjectPicker({
  variant,
  subjects,
  selectedSubjectIds,
  activeSessionId,
  disabled = false,
  onSubjectClick,
  onManageSubjects,
}: SubjectPickerProps) {
  const sidebarViewportRef = useRef<HTMLDivElement>(null)

  if (subjects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-center">
        <p className="text-xs text-muted-foreground">Add a subject before starting focus.</p>
        {onManageSubjects && (
          <Button className="mt-2" variant="outline" size="xs" onClick={onManageSubjects}>
            Manage subjects
          </Button>
        )}
      </div>
    )
  }

  if (variant === "sidebar") {
    return (
      <div className="min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">Subject</span>
          {activeSessionId && (
            <span className="text-micro text-muted-foreground">Logging now</span>
          )}
        </div>
        <ScrollArea
          className="w-full min-w-0 whitespace-nowrap"
          viewportRef={sidebarViewportRef}
          onWheel={(event) => {
            if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
            event.preventDefault()
            sidebarViewportRef.current?.scrollBy({ left: event.deltaY })
          }}
        >
          <div className="flex w-max gap-1 pb-1">
            {subjects.map((subject) => {
              const selected = selectedSubjectIds.includes(subject.id)
              return (
                <Button
                  key={subject.id}
                  variant={selected ? "secondary" : "ghost"}
                  size="xs"
                  aria-pressed={selected}
                  aria-label={`${selected ? "Selected" : "Select"} ${subject.name}`}
                  onClick={() => onSubjectClick(subject.id)}
                  disabled={disabled}
                  style={selected ? {
                    backgroundColor: `${subject.color}18`,
                  } : undefined}
                  title={activeSessionId && selected ? `${subject.name} is logged for this session` : subject.name}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: subject.color }}
                  />
                  {subject.shortCode}
                </Button>
              )
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-micro font-semibold uppercase tracking-normal text-muted-foreground">Subjects</p>
        <span className="text-micro font-medium text-muted-foreground">{selectedSubjectIds.length} selected</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {subjects.map((subject) => {
          const selected = selectedSubjectIds.includes(subject.id)
          return (
            <Button
              key={subject.id}
              variant={selected ? "secondary" : "outline"}
              size="sm"
              aria-pressed={selected}
              aria-label={`${selected ? "Selected" : "Select"} ${subject.name}`}
              onClick={() => onSubjectClick(subject.id)}
              disabled={disabled}
              style={selected ? {
                backgroundColor: `${subject.color}18`,
                borderColor: `${subject.color}40`,
                color: subject.color,
              } : undefined}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: subject.color }} />
              {subject.shortCode}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
