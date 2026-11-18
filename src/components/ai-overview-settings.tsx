import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { clearOverviews } from "../lib/ai-overview"
import { saveOverviewSettings, useOverviewSettings } from "../lib/ai-overview-state"
import { loadChatSettings, saveChatSettings, type ChatSettings } from "../lib/chat-history"
import { CHAT_ENDPOINT, chatHeaders, gatewayCatalogSchema, type GatewayCatalog } from "../lib/gateway-client"
import { Button } from "./ui/button"
import { Skeleton } from "./ui/skeleton"
import { Switch } from "./ui/switch"
import { ModelSelector } from "./model-selector"

/** Settings → AI: turn overviews on or off and pick their model (favourites are shared with Chat). */
export function AIOverviewSettings({ userId }: { userId: string }) {
  const settings = useOverviewSettings()
  const [catalog, setCatalog] = useState<GatewayCatalog | null>(null)
  const [error, setError] = useState("")
  const [chat, setChat] = useState<ChatSettings | null>(null)
  const [cleared, setCleared] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!CHAT_ENDPOINT) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(CHAT_ENDPOINT, { headers: await chatHeaders(userId), signal: controller.signal })
        if (!response.ok) throw new Error(await response.text())
        const next = gatewayCatalogSchema.parse(await response.json())
        if (!controller.signal.aborted) setCatalog(next)
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error && failure.message.length < 200 ? failure.message : "Could not load models.") }
    })()
    return () => controller.abort()
  }, [userId, attempt])
  useEffect(() => { void loadChatSettings(userId).then(setChat, () => setChat(null)) }, [userId])
  const model = settings.model || catalog?.defaultModel || ""
  const update = (changes: Partial<typeof settings>) => saveOverviewSettings({ ...settings, ...changes })
  const toggleFavourite = (id: string) => {
    if (!chat) return
    const next = { ...chat, favourites: chat.favourites.includes(id) ? chat.favourites.filter((entry) => entry !== id) : [...chat.favourites, id] }
    setChat(next)
    void saveChatSettings(next).catch(() => toast.error("Chat preferences could not be saved. Changes apply for this visit only."))
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
          {error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm"><p className="text-destructive">{error}</p><Button size="sm" variant="outline" onClick={() => { setError(""); setAttempt((value) => value + 1) }}><RefreshCw />Retry</Button></div> : null}
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
