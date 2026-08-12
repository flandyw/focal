import { CalendarPlus, ChevronRight, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getUrgencyClassName, getUrgencyLabel } from "@/lib/planning";
import type { PriorityItem } from "@/lib/types";
import { cn, getSubjectById } from "@/lib/utils";

interface StudyPrioritiesProps {
  items: PriorityItem[];
  onSelectItem: (item: PriorityItem) => void;
  onStartItem: (item: PriorityItem) => void;
  onPlanSession: () => void;
}

export function StudyPriorities({
  items,
  onSelectItem,
  onStartItem,
  onPlanSession,
}: StudyPrioritiesProps) {
  // ponytail: Home is a launchpad; Review remains the upgrade path for the full seven-item queue.
  const visibleItems = items.slice(0, 3);

  if (visibleItems.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-dashed bg-muted/20 px-4 py-5">
        <div>
          <p className="text-sm font-medium">Your study queue is clear.</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Put the next study block on the calendar while there is room.
          </p>
        </div>
        <Button type="button" size="sm" onClick={onPlanSession}>
          <CalendarPlus />
          Plan a session
        </Button>
      </div>
    );
  }

  return (
    <div>
      <ol className="grid gap-2 md:grid-cols-3">
        {visibleItems.map((item, index) => {
          const subjectLabels = item.subjectIds
            .map((subjectId) => getSubjectById(subjectId)?.shortCode ?? subjectId)
            .slice(0, 2);

          return (
            <li
              key={item.id}
              className={cn(
                "flex min-w-0 flex-col rounded-lg border bg-background p-3",
                index === 0 && "border-primary/30 bg-primary/[0.03]",
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium",
                    getUrgencyClassName(item.urgency),
                  )}
                >
                  {getUrgencyLabel(item.urgency)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onSelectItem(item)}
                className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="block truncate text-sm font-semibold">
                  {item.title}
                </span>
                <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">
                  {item.reason}
                </span>
                <span className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-primary">
                  {item.action}
                  <ChevronRight className="size-3" />
                </span>
              </button>

              <div className="mt-3 flex min-h-8 items-end gap-1 border-t border-border/60 pt-3">
                <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {subjectLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={item.subjectIds.length === 0}
                  onClick={() => onStartItem(item)}
                  aria-label={`Start focus for ${item.title}`}
                >
                  <Play />
                  Start focus
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {items.length > visibleItems.length && (
        <p className="mt-2 text-right text-xs text-muted-foreground tabular-nums">
          Showing the top {visibleItems.length} of {items.length}
        </p>
      )}
    </div>
  );
}
