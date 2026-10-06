import { createOpenAI } from "@ai-sdk/openai"
import { useCallback, useEffect, useSyncExternalStore } from "react"
import { AI_ENABLED, CHATGPT_ENDPOINT as CHATGPT_BASE_PATH } from "./host"

// Talks to the local Sign in with ChatGPT service (server/chatgpt.ts, run by the desktop sidecar).
// Credentials stay in that process; the browser only sees session state and model output.

type ChatGPTSession = {
  status: "disconnected" | "connecting" | "connected" | "reauth_required"
  sharing: boolean
  identity?: { name?: string; email?: string }
  error?: { code: string; message: string }
}

class ChatGPTRequestError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "ChatGPTRequestError"
    this.status = status
    this.code = code
  }
}

async function failure(response: Response) {
  const body = await response.json().catch(() => undefined) as { error?: { message?: string; code?: string } } | undefined
  return new ChatGPTRequestError(body?.error?.message ?? `ChatGPT request failed (${response.status}).`, response.status, body?.error?.code)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CHATGPT_BASE_PATH}/${path}`, init)
  if (!response.ok) throw await failure(response)
  return response.json() as Promise<T>
}

/** AI SDK provider for the user's ChatGPT plan. `provider(model)` is a language model. */
export function createChatGPTProvider() {
  const openai = createOpenAI({ baseURL: `${CHATGPT_BASE_PATH}/v1`, apiKey: "local" })
  return Object.assign((model: string) => openai.responses(model), {
    listModels: () => request<string[]>("models"),
  })
}

type Store = { session: ChatGPTSession | null; unavailable: boolean; connecting: boolean; error: string | null }
let store: Store = { session: null, unavailable: false, connecting: false, error: null }
const listeners = new Set<() => void>()
const set = (next: Partial<Store>) => { store = { ...store, ...next }; listeners.forEach((listener) => listener()) }

async function refresh() {
  // The desktop sidecar can still be starting when the first view mounts.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      set({ session: await request<ChatGPTSession>("session"), unavailable: false })
      return
    } catch (error) {
      if (error instanceof ChatGPTRequestError && error.status !== 404) { set({ error: error.message }); return }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  set({ unavailable: true })
}

async function act(path: string, body?: unknown) {
  set({ error: null, ...(path === "signin" ? { connecting: true } : {}) })
  try {
    set({ session: await request<ChatGPTSession>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }) })
  } catch (error) {
    if (!(error instanceof ChatGPTRequestError && error.code === "cancelled")) set({ error: error instanceof Error ? error.message : "ChatGPT could not be reached." })
    await refresh()
  } finally {
    set({ connecting: false })
  }
}

export function useChatGPT() {
  const state = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => store)
  useEffect(() => { if (AI_ENABLED && !store.session && !store.unavailable) void refresh() }, [])
  const connect = useCallback((reconsent = false) => act("signin", { reconsent }), [])
  const cancel = useCallback(() => act("cancel"), [])
  const disconnect = useCallback(() => act("disconnect"), [])
  const session = state.session
  const status = state.unavailable ? "unavailable" as const : !session ? "loading" as const : state.connecting ? "connecting" as const : session.status
  return {
    status,
    sharing: session?.sharing ?? false,
    identity: session?.identity,
    /** Signed in and permitted to spend the user's plan. */
    isAuthenticated: session?.status === "connected" && session.sharing,
    error: state.error,
    connect, cancel, disconnect, refresh,
  }
}
