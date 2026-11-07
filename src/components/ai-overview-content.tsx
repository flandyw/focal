import { useContext, useEffect, useState } from "react"
import { RefreshCw, Sparkles } from "lucide-react"
import { generateOverview, needsRefresh, readOverview, type OverviewArea } from "../lib/ai-overview"
import { AIOverviewContext, type OverviewSettings } from "../lib/ai-overview-state"
import { CHAT_ENDPOINT } from "../lib/gateway-client"
import { localDate } from "../lib/learning-workspace"
import { Button } from "./ui/button"
import { Skeleton } from "./ui/skeleton"

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

/** A short AI read of the page's data with next steps. `fingerprint` should change only when the data the overview is about does. */
export function AIOverviewContent({ area, subject = "all", fingerprint, settings }: { area: OverviewArea; subject?: string; fingerprint: string; settings: OverviewSettings }) {
  const { userId, onAction } = useContext(AIOverviewContext)
  const active = Boolean(settings.enabled && userId && CHAT_ENDPOINT)
  const [entry, setEntry] = useState(() => userId ? readOverview(userId, area, subject) : null)
  const [loading, setLoading] = useState(false)

  function generate(force = false) {
    if (!userId) return
    const day = localDate(new Date())
    const cached = readOverview(userId, area, subject)
    setEntry(cached)
    if (!force && !needsRefresh(cached, day, fingerprint)) return
    setLoading(true)
    void generateOverview(userId, area, subject, settings.model, day, fingerprint).then((next) => {
      setEntry(next)
      setLoading(false)
    })
  }
  // Generation follows the page scope and its data fingerprint; the cache makes repeat visits free.
  // oxlint-disable-next-line react/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (active) generate() }, [active, userId, area, subject, fingerprint])

  if (!active) return null
  const overview = entry?.overview
  if (!overview && !loading && !entry?.error) return null
  return (
    <section aria-label="AI overview" aria-busy={loading} className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><Sparkles aria-hidden className="size-3.5 text-primary" />AI overview{overview ? ` · ${ago(overview.createdAt)}` : ""}</span>
        {overview ? <Button size="icon-sm" variant="ghost" aria-label="Regenerate AI overview" disabled={loading} onClick={() => generate(true)}><RefreshCw aria-hidden className={loading ? "animate-spin motion-reduce:animate-none" : undefined} /></Button> : null}
      </div>
      {overview ? <>
        <p className="mt-1 font-medium">{overview.headline}</p>
        <p className="mt-1 text-sm text-muted-foreground">{overview.body}</p>
        {overview.actions.length ? <div className="mt-3 flex flex-wrap gap-2">
          {overview.actions.map((action, index) => <Button key={index} size="sm" variant={index ? "ghost" : "outline"} onClick={() => onAction(action)}>{action.label}</Button>)}
        </div> : null}
      </> : !loading && entry?.error ? <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p role="alert" className="text-sm text-muted-foreground">{entry.error}</p>
        <Button size="sm" variant="outline" onClick={() => generate(true)}>Try again</Button>
      </div> : <div className="mt-2 grid gap-2" role="status"><span className="sr-only">Writing your overview…</span><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /></div>}
    </section>
  )
}
