import { useContext, useEffect, useState, useSyncExternalStore } from "react"
import { RefreshCw, Sparkles } from "lucide-react"
import { AIOverviewContext, clearOverviews, generateOverview, loadOverviewSettings, needsRefresh, readOverview, saveOverviewSettings, type OverviewArea } from "../lib/ai-overview"
import { loadChatSettings, saveChatSettings, type ChatSettings } from "../lib/chat-history"
import { CHAT_ENDPOINT, chatHeaders, gatewayCatalogSchema, type GatewayCatalog } from "../lib/gateway-client"
import { localDate } from "../lib/learning-workspace"
import { Button } from "./ui/button"
import { Skeleton } from "./ui/skeleton"
import { Switch } from "./ui/switch"
import { ModelSelector } from "./model-selector"

const subscribe = (change: () => void) => {
  window.addEventListener("focal:ai-overviews", change)
  return () => window.removeEventListener("focal:ai-overviews", change)
}
let snapshot = loadOverviewSettings()
const readSettings = () => {
  const next = loadOverviewSettings()
  if (next.enabled !== snapshot.enabled || next.model !== snapshot.model) snapshot = next
  return snapshot
}
const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

/** A short AI read of the page's data with next steps. `fingerprint` should change only when the data the overview is about does. */
export function AIOverview({ area, subject = "all", fingerprint }: { area: OverviewArea; subject?: string; fingerprint: string }) {
  const { userId, onAction } = useContext(AIOverviewContext)
  const settings = useSyncExternalStore(subscribe, readSettings)
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

/** Settings → AI: turn overviews on or off and pick their model (favourites are shared with Chat). */
export function AIOverviewSettings({ userId }: { userId: string }) {
  const settings = useSyncExternalStore(subscribe, readSettings)
  const [catalog, setCatalog] = useState<GatewayCatalog | null>(null)
  const [error, setError] = useState("")
  const [chat, setChat] = useState<ChatSettings | null>(null)
  const [cleared, setCleared] = useState(false)
  useEffect(() => {
    if (!CHAT_ENDPOINT) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(CHAT_ENDPOINT, { headers: await chatHeaders(userId), signal: controller.signal })
        if (!response.ok) throw new Error(await response.text())
        setCatalog(gatewayCatalogSchema.parse(await response.json()))
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error && failure.message.length < 200 ? failure.message : "Could not load models.") }
    })()
    void loadChatSettings(userId).then(setChat, () => setChat(null))
    return () => controller.abort()
  }, [userId])
  const model = settings.model || catalog?.defaultModel || ""
  const update = (changes: Partial<typeof settings>) => saveOverviewSettings({ ...settings, ...changes })
  const toggleFavourite = (id: string) => {
    if (!chat) return
    const next = { ...chat, favourites: chat.favourites.includes(id) ? chat.favourites.filter((entry) => entry !== id) : [...chat.favourites, id] }
    setChat(next)
    void saveChatSettings(next)
  }
  if (!CHAT_ENDPOINT) return <p className="py-4 text-sm text-muted-foreground">AI overviews are not connected in this build.</p>
  return (
    <div className="grid gap-0">
      <label className="flex items-center justify-between gap-6 border-b py-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Show AI overviews</span>
          <span className="block text-sm text-muted-foreground">On Today, Mistakes, Practice, Progress and subject pages. Each one is written at most about once a day, using your Gateway key.</span>
        </span>
        <Switch checked={settings.enabled} onCheckedChange={(enabled) => update({ enabled })} />
      </label>
      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Overview model</h3>
          <p className="text-sm text-muted-foreground">{catalog && !catalog.hasKey ? "Save a Gateway key above to turn overviews on." : "A small, cheap model is plenty. New overviews use it."}</p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        {catalog ? <ModelSelector catalog={catalog} value={model} onValueChange={(value) => update({ model: value })} favourites={chat?.favourites ?? []} onToggleFavourite={toggleFavourite} disabled={!settings.enabled} /> : error ? null : <Skeleton className="h-8 w-40" />}
      </div>
      <div className="flex flex-col gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Refresh overviews</h3>
          <p className="text-sm text-muted-foreground">{cleared ? "Cleared. Each page writes a new overview when you next open it." : "Discard saved overviews and any retry wait, so each page writes a new one."}</p>
        </div>
        <Button size="sm" variant="outline" disabled={!settings.enabled} onClick={() => { clearOverviews(userId); setCleared(true) }}>Refresh all</Button>
      </div>
    </div>
  )
}
