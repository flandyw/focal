import { useEffect, useMemo, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai"
import { ArrowUp, Check, LoaderCircle, Plus, Square } from "lucide-react"
import { isSecureEndpoint, supabase } from "../lib/supabase"
import { PageHeader } from "./page-header"
import { MarkdownPreview } from "./markdown-preview"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Bubble, BubbleContent } from "./ui/bubble"
import { Button } from "./ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "./ui/input-group"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Message, MessageContent } from "./ui/message"
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem,
  MessageScrollerProvider, MessageScrollerViewport,
} from "./ui/message-scroller"

export function ChatPage({ userId, subject, onSignIn }: { userId?: string; subject: string; onSignIn: () => void }) {
  const [input, setInput] = useState("")
  const [gatewayKey, setGatewayKey] = useState("")
  const [stopped, setStopped] = useState(false)
  const endpoint = import.meta.env.VITE_CHAT_API_URL?.trim() || (import.meta.env.VITE_DESKTOP && !import.meta.env.DEV ? "" : "/api/chat")
  const transport = useMemo(() => new DefaultChatTransport({
    api: endpoint,
    headers: async () => {
      if (!isSecureEndpoint(new URL(endpoint, window.location.href).href)) throw new Error("Chat needs an HTTPS endpoint or localhost.")
      const apiKey = gatewayKey.trim()
      if (!apiKey || !/^[\x21-\x7e]+$/.test(apiKey)) throw new Error("Enter a valid Vercel AI Gateway API key to chat.")
      const session = await supabase?.auth.getSession()
      if (session?.error || !session?.data.session || session.data.session.user.id !== userId) {
        throw new Error("Sign in to Focal again to chat.")
      }
      return { Authorization: `Bearer ${session.data.session.access_token}`, "x-ai-gateway-api-key": apiKey }
    },
  }), [endpoint, userId, gatewayKey])
  const { messages, setMessages, sendMessage, status, error, clearError, stop } = useChat({ transport, throttle: 50 })
  const busy = status === "submitted" || status === "streaming"
  const available = Boolean(userId && endpoint && gatewayKey.trim())
  useEffect(() => () => { void stop() }, [stop])

  function send(text = input) {
    if (busy || !available || !text.trim()) return
    clearError()
    setStopped(false)
    setInput("")
    void sendMessage({ text: text.trim() }, { body: { context: { subject, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } } })
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
                    <EmptyTitle>{!userId ? "Sign in to chat" : !endpoint ? "Chat is not connected" : !gatewayKey.trim() ? "Add your Gateway key" : "What would help you study?"}</EmptyTitle>
                    <EmptyDescription>{!userId ? "Connect your account so the assistant can work with your study data." : !endpoint ? "The chat service has not been configured for this desktop build." : !gatewayKey.trim() ? "Enter your own Vercel AI Gateway API key below to start. Usage is billed to your Gateway account." : "Review your progress, find what needs attention, or plan your next session."}</EmptyDescription>
                  </EmptyHeader>
                  {!userId ? <Button onClick={onSignIn}>Open sign-in settings</Button> : available ? <div className="flex flex-col items-center gap-2">
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
        {userId && endpoint ? <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Gateway API key · {gatewayKey.trim() ? "Provided" : "Required"}</summary>
          <div className="mt-3 space-y-2">
            <Label htmlFor="chat-gateway-key">Vercel AI Gateway API key</Label>
            <div className="flex gap-2">
              <Input id="chat-gateway-key" type="password" autoComplete="off" spellCheck={false} value={gatewayKey} onChange={(event) => setGatewayKey(event.target.value)} maxLength={4096} disabled={busy} aria-describedby="chat-gateway-key-help" placeholder="Paste your API key" />
              <Button variant="outline" disabled={busy || !gatewayKey} onClick={() => { setGatewayKey(""); clearError() }}>Clear key</Button>
            </div>
            <p id="chat-gateway-key-help" className="text-xs text-muted-foreground">Kept in memory until you leave Chat. Sent to the chat server to call Gateway on your behalf.</p>
          </div>
        </details> : null}
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
