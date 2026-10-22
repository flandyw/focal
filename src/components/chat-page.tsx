import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai"
import { ArrowUp, CalendarDays, Check, ChevronRight, Copy, LoaderCircle, PanelLeft, Plus, Square, Target, TrendingDown, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { CHAT_ENDPOINT, chatHeaders, gatewayCatalogSchema, type GatewayCatalog } from "../lib/gateway-client"
import { chatMetadataSchema, deleteLocalChat, loadLocalChats, newLocalChat, saveChatSettings, saveLocalChat, type ChatMessage, type ChatSettings, type LocalChat } from "../lib/chat-history"
import { useIsMobile } from "../hooks/use-mobile"
import { ChatSidebar } from "./chat-sidebar"
import { MarkdownPreview } from "./markdown-preview"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Bubble, BubbleContent } from "./ui/bubble"
import { Button } from "./ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "./ui/input-group"
import { ModelSelector } from "./model-selector"
import { Message, MessageContent, MessageFooter } from "./ui/message"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet"
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem,
  MessageScrollerProvider, MessageScrollerViewport,
} from "./ui/message-scroller"

export function ChatPage({ userId, subject, onSignIn, onSettings }: { userId?: string; subject: string; onSignIn: () => void; onSettings: () => void }) {
  const owner = userId ?? "guest"
  const compact = useIsMobile()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [chats, setChats] = useState<LocalChat[]>([])
  const [active, setActive] = useState<LocalChat | null>(null)
  const [settings, setSettings] = useState<ChatSettings>({ owner, favourites: [], model: "", activeId: "" })
  const [historyError, setHistoryError] = useState("")
  const [historyVersion, setHistoryVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [catalog, setCatalog] = useState<GatewayCatalog | null>(null)
  const [catalogError, setCatalogError] = useState("")
  const [catalogVersion, setCatalogVersion] = useState(0)
  const deleted = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    void loadLocalChats(owner).then(({ chats, settings }) => {
      if (cancelled) return
      setChats(chats)
      setSettings(settings)
      setActive(chats.find((chat) => chat.id === settings.activeId) ?? chats[0] ?? newLocalChat(owner, settings.model))
      setHistoryError("")
    }).catch(() => { if (!cancelled) setHistoryError("Could not open local chat history. Your saved chats have been kept. Retry to open them.") })
    return () => { cancelled = true }
  }, [owner, historyVersion])
  useEffect(() => {
    if (!userId || !CHAT_ENDPOINT) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(CHAT_ENDPOINT, { headers: await chatHeaders(userId), signal: controller.signal })
        if (!response.ok) throw new Error(await response.text())
        const data = gatewayCatalogSchema.parse(await response.json())
        if (controller.signal.aborted) return
        setCatalog(data)
        setCatalogError("")
      } catch (error) {
        if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : "Could not load chat settings.")
      }
    })()
    return () => controller.abort()
  }, [userId, catalogVersion])

  const saveChat = useCallback(async (chat: LocalChat) => {
    if (deleted.current.has(chat.id)) return
    setChats((current) => [chat, ...current.filter((entry) => entry.id !== chat.id)].sort((a, b) => b.updatedAt - a.updatedAt))
    await saveLocalChat(chat)
  }, [])

  function updateSettings(next: ChatSettings) {
    setSettings(next)
    void saveChatSettings(next).catch(() => toast.error("Chat preferences could not be saved. Changes apply for this visit only."))
  }
  function selectChat(chat: LocalChat) {
    if (busy) return
    setActive(chat)
    setHistoryOpen(false)
    updateSettings({ ...settings, activeId: chat.id })
  }
  function newChat() { selectChat(newLocalChat(owner, settings.model || catalog?.defaultModel || "")) }

  const currentChat = chats.find((chat) => chat.id === active?.id) ?? active
  const history = currentChat ? <ChatSidebar chats={chats} activeId={currentChat.id} disabled={busy} onNew={newChat} onSelect={selectChat} onRename={async (chat, title) => {
    const next = { ...chat, title }
    await saveLocalChat(next)
    setChats((current) => current.map((entry) => entry.id === chat.id ? next : entry))
  }} onDelete={async (chat) => {
    deleted.current.add(chat.id)
    try { await deleteLocalChat(owner, chat.id) }
    catch (error) { deleted.current.delete(chat.id); throw error }
    setChats((current) => current.filter((entry) => entry.id !== chat.id))
    if (currentChat.id === chat.id) selectChat(newLocalChat(owner, settings.model || catalog?.defaultModel || ""))
  }} /> : null

  return <div className="flex h-[calc(100dvh-7rem)] min-h-96 overflow-hidden rounded-lg border bg-card lg:h-[calc(100dvh-4rem)]">
    {!compact && sidebarVisible ? <aside aria-label="Conversations" className="w-56 shrink-0 border-r bg-muted/40">{history}</aside> : null}
    {compact ? <Sheet open={historyOpen} onOpenChange={setHistoryOpen}><SheetContent side="left" className="gap-0">
      <SheetHeader><SheetTitle>Chats</SheetTitle><SheetDescription>Conversations saved on this device.</SheetDescription></SheetHeader>
      {history}
    </SheetContent></Sheet> : null}
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-3">
        <Button size="icon" variant="ghost" aria-label={compact || !sidebarVisible ? "Open chat history" : "Hide chat history"} aria-expanded={compact ? historyOpen : sidebarVisible} onClick={() => compact ? setHistoryOpen(true) : setSidebarVisible(!sidebarVisible)}><PanelLeft aria-hidden /></Button>
        <h1 className="min-w-0 flex-1 truncate font-sans text-sm font-medium">{currentChat?.title ?? "Chat"}</h1>
        {compact || !sidebarVisible ? <Button size="icon" variant="ghost" aria-label="New chat" disabled={busy || !currentChat} onClick={newChat}><Plus aria-hidden /></Button> : null}
      </header>
      {historyError ? <div role="alert" className="p-4 text-sm text-destructive">{historyError} <Button variant="outline" size="sm" onClick={() => setHistoryVersion((version) => version + 1)}>Retry</Button></div> : currentChat ? <ChatConversation key={currentChat.id} chat={currentChat} userId={userId} subject={subject} onSignIn={onSignIn} onSettings={onSettings} catalog={catalog} catalogError={catalogError} onRetryCatalog={() => setCatalogVersion((version) => version + 1)} favourites={settings.favourites} onToggleFavourite={(id) => updateSettings({ ...settings, favourites: settings.favourites.includes(id) ? settings.favourites.filter((entry) => entry !== id) : [...settings.favourites, id] })} onModelChange={(model) => updateSettings({ ...settings, model })} onSave={saveChat} onBusyChange={setBusy} /> : <div role="status" className="m-6 h-24 animate-pulse rounded-md bg-muted motion-reduce:animate-none"><span className="sr-only">Opening local chats…</span></div>}
    </div>
  </div>
}

function ChatConversation({ chat, userId, subject, onSignIn, onSettings, catalog, catalogError, onRetryCatalog, favourites, onToggleFavourite, onModelChange, onSave, onBusyChange }: {
  chat: LocalChat; userId?: string; subject: string; onSignIn: () => void; onSettings: () => void
  catalog: GatewayCatalog | null; catalogError: string; onRetryCatalog: () => void
  favourites: string[]; onToggleFavourite: (id: string) => void; onModelChange: (model: string) => void
  onSave: (chat: LocalChat) => Promise<void>; onBusyChange: (busy: boolean) => void
}) {
  const { id, owner, title } = chat
  const [input, setInput] = useState(chat.draft)
  const [model, setModel] = useState(chat.model)
  const [stopped, setStopped] = useState(chat.interrupted)
  const [saveError, setSaveError] = useState("")
  const [copied, setCopied] = useState("")
  const latest = useRef(chat)
  const transport = useMemo(() => new DefaultChatTransport<ChatMessage>({
    api: CHAT_ENDPOINT, headers: () => chatHeaders(userId),
    prepareSendMessagesRequest: ({ messages, body, id }) => {
      const recent = messages.slice(-59)
      const requestBody = { ...body, id, messages: recent }
      while (recent.length > 1 && new TextEncoder().encode(JSON.stringify(requestBody)).length > 250_000) recent.shift()
      return { body: requestBody }
    },
  }), [userId])
  const { messages, sendMessage, status, error, clearError, stop } = useChat<ChatMessage>({
    id: chat.id, messages: chat.messages, transport, throttle: 100, messageMetadataSchema: chatMetadataSchema,
  })
  const busy = status === "submitted" || status === "streaming"
  const available = Boolean(userId && CHAT_ENDPOINT && catalog?.hasKey && catalog.models.some((entry) => entry.id === model))

  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  // The saved model stays selected even when it leaves the catalogue; the user can choose a replacement.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (!model && catalog) setModel(catalog.defaultModel) }, [model, catalog])

  const persist = useCallback(async () => {
    if (!latest.current.messages.length && !latest.current.draft.trim()) return
    try { await onSave(latest.current); setSaveError("") }
    catch { setSaveError("This chat could not be saved on this device. Keep it open and retry saving.") }
  }, [onSave])
  useEffect(() => {
    const firstText = messages.find((message) => message.role === "user")?.parts.find((part) => part.type === "text")?.text
    latest.current = { id, owner, title: title === "New chat" && firstText ? firstText.replace(/\s+/g, " ").slice(0, 80) : title, model, draft: input, messages, updatedAt: Date.now(), interrupted: busy || stopped || Boolean(error) }
    // Synchronize edits with IndexedDB and surface write failures in the composer.
    // oxlint-disable-next-line react/set-state-in-effect
    if (!busy) void persist()
  }, [id, owner, title, messages, input, model, busy, stopped, error, persist])
  useEffect(() => {
    if (!busy) return
    // shortcut: streaming replies checkpoint once a second; shorten this if crash recovery needs finer granularity.
    const timer = window.setInterval(() => { void persist() }, 1000)
    return () => window.clearInterval(timer)
  }, [busy, persist])
  useEffect(() => () => {
    void stop()
    if (latest.current.messages.length || latest.current.draft.trim()) void onSave(latest.current).catch(() => toast.error("The last chat changes could not be saved on this device."))
    onBusyChange(false)
  }, [stop, onSave, onBusyChange])

  async function copy(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n\n"))
      setCopied(message.id)
    } catch { toast.error("Could not copy this response. Select the text and copy it manually.") }
  }

  function send(text = input) {
    if (busy || !available || !text.trim()) return
    clearError()
    setStopped(false)
    setInput("")
    void sendMessage({ text: text.trim() }, { body: { model, context: { subject, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } } })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll={messages.length > 0}>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
              {messages.length === 0 ? (
                <Empty className="min-h-[50dvh] bg-transparent p-4">
                  <EmptyHeader>
                    <EmptyTitle className="text-xl font-semibold tracking-tight">{!userId ? "Sign in to chat" : !CHAT_ENDPOINT ? "Chat is not connected" : !catalog ? catalogError ? "Chat is unavailable" : "Loading chat…" : !catalog.hasKey ? "Add your Gateway key in Settings" : "What would help you study?"}</EmptyTitle>
                    <EmptyDescription>{!userId ? "Connect your account so the assistant can work with your study data." : !CHAT_ENDPOINT ? "The chat service has not been configured for this desktop build." : !catalog ? catalogError || "Loading your saved key status and available models." : !catalog.hasKey ? "Open Settings > AI to securely save your Vercel AI Gateway key." : "Review your progress, find what needs attention, or plan your next session."}</EmptyDescription>
                  </EmptyHeader>
                  {!userId ? <Button onClick={onSignIn}>Open sign-in settings</Button> : catalog && !catalog.hasKey ? <Button onClick={onSettings}>Open AI settings</Button> : available ? <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-3">
                    {([[Target, "What should I focus on today?"], [TrendingDown, "Where am I losing marks?"], [CalendarDays, "Help me plan my study for this week."]] as const).map(([Icon, prompt]) => (
                      <Button key={prompt} variant="outline" className="h-auto flex-col items-start gap-3 whitespace-normal p-3 text-left font-normal" onClick={() => send(prompt)}>
                        <Icon aria-hidden className="text-primary" />{prompt}
                      </Button>
                    ))}
                  </div> : null}
                </Empty>
              ) : null}
              {messages.map((message) => (
                <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                  <Message align={message.role === "user" ? "end" : "start"}>
                    <MessageContent>
                      <span className="sr-only">{message.role === "user" ? "You" : "Focal assistant"}</span>
                      {message.parts.map((part, index) => {
                        if (part.type === "text") return (
                          <Bubble key={index} align={message.role === "user" ? "end" : "start"} variant={message.role === "user" ? "muted" : "ghost"}>
                            <BubbleContent>{message.role === "user" ? <p className="whitespace-pre-wrap">{part.text}</p> : <MarkdownPreview unframed>{part.text}</MarkdownPreview>}</BubbleContent>
                          </Bubble>
                        )
                        if (!isToolUIPart(part)) return null
                        const finished = part.state === "output-available"
                        const failed = part.state === "output-error"
                        const working = busy && message.id === messages.at(-1)?.id
                        return (
                          <details key={part.toolCallId} className="group/tool w-fit max-w-full text-xs text-muted-foreground open:w-full">
                            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 hover:text-foreground [&::-webkit-details-marker]:hidden">
                              {finished ? <Check aria-hidden className="size-3.5" /> : failed ? <TriangleAlert aria-hidden className="size-3.5 text-destructive" /> : working ? <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" /> : null}
                              <span className="first-letter:uppercase">{getToolName(part).replaceAll("_", " ")}</span>
                              <span>· {finished ? "Done" : failed ? "Failed" : working ? "Working…" : "Outcome unknown"}</span>
                              <ChevronRight aria-hidden className="size-3.5 transition-transform group-open/tool:rotate-90 motion-reduce:transition-none" />
                            </summary>
                            <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted/40 p-3 font-mono whitespace-pre-wrap break-words">{JSON.stringify({ input: part.input, ...(finished ? { result: part.output } : failed ? { error: part.errorText } : {}) }, null, 2)}</pre>
                          </details>
                        )
                      })}
                      {message.role === "assistant" && !(busy && message.id === messages.at(-1)?.id) ? <MessageFooter className={`flex-wrap gap-x-3 gap-y-1 font-normal transition-opacity motion-reduce:transition-none ${message.id === messages.at(-1)?.id ? "" : "pointer-fine:opacity-0 pointer-fine:group-hover/message:opacity-100 pointer-fine:group-focus-within/message:opacity-100"}`}>
                        {message.parts.some((part) => part.type === "text" && part.text) ? <Button size="icon-sm" variant="ghost" aria-label={copied === message.id ? "Response copied" : "Copy response"} onClick={() => { void copy(message) }}>{copied === message.id ? <Check aria-hidden /> : <Copy aria-hidden />}</Button> : null}
                        <span>{catalog?.models.find((model) => model.id === message.metadata?.model)?.name ?? message.metadata?.model}</span>
                        {message.metadata?.latencyMs != null ? <span title="Time to first model output, including reasoning or a tool call">{(message.metadata.latencyMs / 1000).toFixed(2)}s latency</span> : null}
                        {message.metadata?.tokensPerSecond != null ? <span title="Output tokens per second for the final model step">{message.metadata.tokensPerSecond.toFixed(1)} tok/s</span> : null}
                        {message.metadata?.outputTokens != null ? <span>{message.metadata.outputTokens.toLocaleString()} tokens</span> : null}
                      </MessageFooter> : null}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
              {busy ? <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />{status === "submitted" ? "Connecting…" : "Working on your request…"}</p> : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          {messages.length > 0 ? <MessageScrollerButton /> : null}
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="mx-auto w-full max-w-3xl shrink-0 space-y-2 px-4 pb-3 sm:px-6 sm:pb-4">
        {catalogError ? <p role="alert" className="text-sm text-destructive">{catalogError} <Button size="sm" variant="outline" disabled={busy} onClick={onRetryCatalog}>Retry</Button></p> : null}
        {saveError ? <p role="alert" className="text-sm text-destructive">{saveError} <Button size="sm" variant="outline" onClick={() => { void persist() }}>Retry save</Button></p> : null}
        {catalog?.hasKey && model && !catalog.models.some((entry) => entry.id === model) ? <p role="status" className="text-sm text-muted-foreground">The saved model is unavailable. Choose another model to continue this chat.</p> : null}
        {error ? <Alert variant="destructive"><AlertTitle>Chat could not finish</AlertTitle><AlertDescription>{error.message} Check your records before repeating a change.</AlertDescription></Alert> : null}
        {stopped ? <p role="status" className="text-xs text-muted-foreground">Response interrupted. Changes may have saved; check your records before continuing.</p> : null}
        <form onSubmit={(event) => { event.preventDefault(); send() }}>
          <InputGroup className="rounded-xl shadow-xs">
            <InputGroupTextarea autoFocus aria-label="Message Focal" placeholder="Ask about your study…" className="max-h-48 min-h-14 px-3.5 pt-3" value={input} onChange={(event) => setInput(event.target.value)} disabled={!available} maxLength={12000} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
            }} />
            <InputGroupAddon align="block-end" className="gap-1 pr-2">
              {catalog ? <ModelSelector catalog={catalog} value={model} onValueChange={(value) => { setModel(value); onModelChange(value) }} favourites={favourites} onToggleFavourite={onToggleFavourite} disabled={busy} /> : null}
              <span className="mr-auto truncate text-xs font-normal">{subject === "all" ? "All subjects" : subject}</span>
              {busy ? <InputGroupButton size="icon-sm" aria-label="Stop response" onClick={() => { setStopped(true); void stop() }}><Square aria-hidden /></InputGroupButton> : <InputGroupButton type="submit" size="icon-sm" variant="default" aria-label="Send message" disabled={!available || !input.trim()}><ArrowUp aria-hidden /></InputGroupButton>}
            </InputGroupAddon>
          </InputGroup>
        </form>
        <p className="text-center text-xs text-muted-foreground">Chats stay on this device. Requested study changes save to your account.{messages.length > 59 ? " Only the most recent turns are sent to the model." : ""}</p>
      </div>
    </div>
  )
}
