import { useEffect, useMemo, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai"
import { ArrowUp, Check, LoaderCircle, Plus, Square } from "lucide-react"
import { CHAT_ENDPOINT, chatHeaders, gatewayCatalogSchema, type GatewayCatalog } from "../lib/gateway-client"
import { PageHeader } from "./page-header"
import { MarkdownPreview } from "./markdown-preview"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Bubble, BubbleContent } from "./ui/bubble"
import { Button } from "./ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "./ui/input-group"
import { ModelSelector } from "./model-selector"
import { Message, MessageContent } from "./ui/message"
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem,
  MessageScrollerProvider, MessageScrollerViewport,
} from "./ui/message-scroller"

export function ChatPage({ userId, subject, onSignIn, onSettings }: { userId?: string; subject: string; onSignIn: () => void; onSettings: () => void }) {
  const [input, setInput] = useState("")
  const [catalog, setCatalog] = useState<GatewayCatalog | null>(null)
  const [model, setModel] = useState("")
  const [catalogError, setCatalogError] = useState("")
  const [catalogVersion, setCatalogVersion] = useState(0)
  const [stopped, setStopped] = useState(false)
  const transport = useMemo(() => new DefaultChatTransport({
    api: CHAT_ENDPOINT,
    headers: () => chatHeaders(userId),
  }), [userId])
  const { messages, setMessages, sendMessage, status, error, clearError, stop } = useChat({ transport, throttle: 50 })
  const busy = status === "submitted" || status === "streaming"
  const available = Boolean(userId && CHAT_ENDPOINT && catalog?.hasKey && catalog.models.some((entry) => entry.id === model))
  useEffect(() => () => { void stop() }, [stop])
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
        setModel((current) => data.models.some((entry) => entry.id === current) ? current : data.defaultModel)
        setCatalogError("")
      } catch (error) {
        if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : "Could not load chat settings.")
      }
    })()
    return () => controller.abort()
  }, [userId, catalogVersion])

  function send(text = input) {
    if (busy || !available || !text.trim()) return
    clearError()
    setStopped(false)
    setInput("")
    void sendMessage({ text: text.trim() }, { body: { model, context: { subject, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } } })
  }

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[36rem] flex-col gap-4 lg:h-[calc(100dvh-4rem)]">
      <PageHeader title="Chat" description="Work through your study with an assistant that can read and update your synced Focal data.">
        <Button variant="outline" disabled={busy || messages.length === 0} onClick={() => { setMessages([]); clearError(); setStopped(false) }}><Plus aria-hidden />New chat</Button>
      </PageHeader>
      <MessageScrollerProvider autoScroll={messages.length > 0}>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto max-w-3xl px-1 py-4">
              {messages.length === 0 ? (
                <Empty className="bg-transparent p-4">
                  <EmptyHeader>
                    <EmptyTitle>{!userId ? "Sign in to chat" : !CHAT_ENDPOINT ? "Chat is not connected" : !catalog ? catalogError ? "Chat is unavailable" : "Loading chat…" : !catalog.hasKey ? "Add your Gateway key in Settings" : "What would help you study?"}</EmptyTitle>
                    <EmptyDescription>{!userId ? "Connect your account so the assistant can work with your study data." : !CHAT_ENDPOINT ? "The chat service has not been configured for this desktop build." : !catalog ? catalogError || "Loading your saved key status and available models." : !catalog.hasKey ? "Open Settings > AI to securely save your Vercel AI Gateway key." : "Review your progress, find what needs attention, or plan your next session."}</EmptyDescription>
                  </EmptyHeader>
                  {!userId ? <Button onClick={onSignIn}>Open sign-in settings</Button> : catalog && !catalog.hasKey ? <Button onClick={onSettings}>Open AI settings</Button> : available ? <div className="flex flex-col items-center gap-2">
                    {["What should I focus on today?", "Where am I losing marks?", "Help me plan my study for this week."].map((prompt) => (
                      <Button key={prompt} variant="outline" className="h-auto whitespace-normal py-2 text-left" disabled={!available} onClick={() => send(prompt)}>{prompt}</Button>
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
                          <details key={part.toolCallId} className="max-w-full rounded-md border px-3 py-2 text-sm">
                            <summary className="cursor-pointer text-muted-foreground">
                              <span className="inline-flex items-center gap-2">
                                {finished ? <Check aria-hidden className="size-3.5" /> : !failed && working ? <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" /> : null}
                                {getToolName(part).replaceAll("_", " ")} · {finished ? "Done" : failed ? "Failed" : working ? "Working…" : "Outcome unknown"}
                              </span>
                            </summary>
                            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ input: part.input, ...(finished ? { result: part.output } : failed ? { error: part.errorText } : {}) }, null, 2)}</pre>
                          </details>
                        )
                      })}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
              {busy ? <p role="status" className="text-sm text-muted-foreground">{status === "submitted" ? "Connecting…" : "Working on your request…"}</p> : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          {messages.length > 0 ? <MessageScrollerButton /> : null}
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="mx-auto w-full max-w-3xl space-y-3">
        {catalogError ? <p role="alert" className="text-sm text-destructive">{catalogError} <Button size="sm" variant="outline" disabled={busy} onClick={() => setCatalogVersion((current) => current + 1)}>Retry</Button></p> : null}
        {catalog ? <ModelSelector catalog={catalog} value={model} onValueChange={setModel} disabled={busy} /> : null}
        {error ? <Alert variant="destructive"><AlertTitle>Chat could not finish</AlertTitle><AlertDescription>{error.message} Check your records before repeating a change.</AlertDescription></Alert> : null}
        {stopped ? <p role="status" className="text-sm text-muted-foreground">Response stopped. Changes may have saved; check your records before retrying.</p> : null}
        <form onSubmit={(event) => { event.preventDefault(); send() }}>
          <InputGroup>
            <InputGroupTextarea aria-label="Message Focal" placeholder="Ask about your study, or ask for a change…" value={input} onChange={(event) => setInput(event.target.value)} disabled={!available || busy} maxLength={12000} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
            }} />
            <InputGroupAddon align="block-end" className="justify-between">
              <span className="text-xs">{subject === "all" ? "All subjects" : subject}</span>
              {busy ? <InputGroupButton size="icon-sm" aria-label="Stop response" onClick={() => { setStopped(true); void stop() }}><Square aria-hidden /></InputGroupButton> : <InputGroupButton type="submit" size="icon-sm" variant="default" aria-label="Send message" disabled={!available || !input.trim()}><ArrowUp aria-hidden /></InputGroupButton>}
            </InputGroupAddon>
          </InputGroup>
        </form>
        <p className="text-xs text-muted-foreground">Uses synced account data. Requested changes save to your account. Chats clear when you leave this page.</p>
      </div>
    </div>
  )
}
