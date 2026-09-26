import { cn } from "@/lib/utils"
import type { SyncStatusSnapshot } from "@/lib/sync/types"

interface SupabaseSyncIndicatorProps {
  sync: SyncStatusSnapshot
  signedIn: boolean
}

type DotStatus = "idle" | "syncing" | "pending" | "error" | "success"

function SupabaseLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 109 113"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" />
      <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" />
    </svg>
  )
}

function StatusDot({ status }: { status: DotStatus }) {
  return (
    <span className="absolute bottom-0 right-0 flex h-2 w-2">
      {status === "syncing" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
      )}
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full border border-background",
          status === "idle" && "bg-muted-foreground/40",
          status === "syncing" && "bg-primary",
          status === "pending" && "bg-amber-500",
          status === "error" && "bg-destructive",
          status === "success" && "bg-emerald-500",
        )}
      />
    </span>
  )
}

function formatTableStats(stats: NonNullable<SyncStatusSnapshot["tableStats"]>) {
  if (stats.length === 0) return null
  return stats
    .map((s) => {
      const parts: string[] = []
      if (s.pulled) parts.push(`${s.pulled} pulled`)
      if (s.pushed) parts.push(`${s.pushed} pushed`)
      if (s.failed) parts.push(`${s.failed} failed`)
      return `${s.table}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`
    })
    .join("\n")
}

function formatFailedItems(items: NonNullable<SyncStatusSnapshot["failedItems"]>) {
  return items.map((item) => `${item.table} ${item.rowId.slice(0, 8)}: ${item.error}`).join("\n")
}

/**
 * The numbers behind the dot. A spinner cannot be debugged; a lag, a round-trip time and
 * a snapshot count can, and they are what tells you whether sync is actually healthy.
 */
function formatMetrics(metrics: SyncStatusSnapshot["metrics"]): string[] {
  const lines: string[] = []
  if (metrics.cursorLag > 0) lines.push(`Behind by ${metrics.cursorLag} change${metrics.cursorLag === 1 ? "" : "s"}`)
  if (metrics.lastPushMs !== null) lines.push(`Last push: ${metrics.lastPushMs} ms`)
  if (metrics.lastPullMs !== null) lines.push(`Last pull: ${metrics.lastPullMs} ms`)
  if (metrics.snapshots > 0) lines.push(`Snapshots: ${metrics.snapshots}`)
  if (metrics.failures > 0) lines.push(`Failed attempts: ${metrics.failures}`)
  return lines
}

export function SupabaseSyncIndicator({ sync, signedIn }: SupabaseSyncIndicatorProps) {
  const isOffline = signedIn && !sync.isOnline
  const dotStatus: DotStatus = !signedIn
    ? "idle"
    : isOffline
      ? "error"
      : sync.status === "syncing"
        ? "syncing"
        : sync.status === "error"
          ? "error"
          : sync.status === "pending"
            ? "pending"
            : "success"

  const label = !signedIn
    ? "Supabase signed out"
    : isOffline
      ? "Offline — sync paused"
      : sync.status === "syncing"
        ? sync.details ?? "Supabase syncing"
        : sync.status === "error"
          ? sync.error ?? "Supabase sync error"
          : sync.status === "pending"
            ? `${sync.pendingCount} pending sync change${sync.pendingCount === 1 ? "" : "s"}`
            : "Supabase synced"

  const tooltipLines = [label]
  if (sync.lastSuccessfulSyncAt) {
    const date = new Date(sync.lastSuccessfulSyncAt)
    if (Number.isFinite(date.getTime())) tooltipLines.push(`Last sync: ${date.toLocaleString()}`)
  }
  const metrics = formatMetrics(sync.metrics)
  if (metrics.length > 0) tooltipLines.push(...metrics)
  if (sync.tableStats && sync.tableStats.length > 0) {
    const stats = formatTableStats(sync.tableStats)
    if (stats) tooltipLines.push("", stats)
  }
  if (sync.failedItems && sync.failedItems.length > 0) {
    tooltipLines.push("", "Failed items:", formatFailedItems(sync.failedItems))
  }
  if (sync.details && sync.details !== label) {
    tooltipLines.push("", sync.details)
  }

  const tooltip = tooltipLines.join("\n")

  return (
    <div
      className={cn(
        "relative flex h-7 w-7 items-center justify-center rounded-lg p-1.5 transition-all duration-200 motion-reduce:transition-none",
        isOffline
          ? "text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
          : sync.status === "syncing"
            ? "text-primary"
            : sync.status === "error"
              ? "text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
              : sync.status === "pending"
                ? "text-amber-600 dark:text-amber-400"
                : signedIn
                  ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                  : "text-muted-foreground/50 opacity-55",
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
      title={tooltip}
    >
      <SupabaseLogo className={cn("h-4 w-4", sync.status === "syncing" && !isOffline && "animate-pulse motion-reduce:animate-none")} />
      <StatusDot status={dotStatus} />
    </div>
  )
}
