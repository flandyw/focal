/// <reference types="node" />

import {
  createChatGPTHandler,
  type ChatGPTHandler,
  type KeyValueStore,
  type RateLimitBucket,
  type StoredSession,
} from "@opencoredev/loginwithchatgpt-server"

export interface ChatGPTAuthStores {
  sessionStore?: KeyValueStore<StoredSession>
  rateLimitStore?: KeyValueStore<RateLimitBucket>
}

export function parseEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

const configuredOrigins = () => parseEnvList(process.env.LWC_ALLOWED_ORIGINS)
const DEFAULT_CHATGPT_CLIENT_VERSION = "0.157.1"

/**
 * Build the server-side handler. Mount `handleChatGPTRequest` at `/api/chatgpt/*`
 * in Bun, Next, Hono, or another Web-standard runtime.
 */
export function createChatGPTAuth(stores: ChatGPTAuthStores = {}): ChatGPTHandler {
  const secret = process.env.LWC_SECRET
  if (process.env.NODE_ENV === "production" && (!secret || !stores.sessionStore)) {
    throw new Error("LWC_SECRET and a shared sessionStore are required in production.")
  }
  const allowedOrigins = configuredOrigins()
  const allowedModels = parseEnvList(process.env.LWC_ALLOWED_MODELS)

  return createChatGPTHandler({
    ...(secret ? { secret } : {}),
    ...(stores.sessionStore ? { sessionStore: stores.sessionStore } : {}),
    clientVersion: process.env.LWC_CLIENT_VERSION ?? DEFAULT_CHATGPT_CLIENT_VERSION,
    ...(allowedOrigins.length ? { allowedOrigins, cookie: { sameSite: "None", secure: true } } : {}),
    responsesProxy: {
      ...(allowedModels.length ? { allowedModels } : {}),
      maxRequestBytes: 4_400_000,
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
        ...(stores.rateLimitStore ? { store: stores.rateLimitStore } : {}),
      },
    },
  })
}

/** Add the CORS headers needed by the packaged Tauri app's cross-origin fetches. */
export async function handleChatGPTRequest(
  request: Request,
  auth: ChatGPTHandler = createChatGPTAuth(),
): Promise<Response> {
  const origin = request.headers.get("origin")
  const allowed = origin && configuredOrigins().includes(origin) ? origin : undefined
  if (request.method === "OPTIONS") {
    if (!allowed) return new Response(null, { status: 403 })
    return new Response(null, {
      status: 204,
      headers: corsHeaders(allowed),
    })
  }
  const response = await normalizeChatGPTErrorResponse(await auth.handler(request))
  if (!allowed) return response
  const headers = new Headers(response.headers)
  for (const [key, value] of corsHeaders(allowed)) headers.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function corsHeaders(origin: string): Headers {
  return new Headers({
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "accept, authorization, content-type, x-login-with-chatgpt-reasoning-effort",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  })
}

async function normalizeChatGPTErrorResponse(response: Response): Promise<Response> {
  if (response.status < 400 || !response.headers.get("content-type")?.includes("application/json")) {
    return response
  }
  const body = await response.text()
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return responseWithBody(response, body)
    const record = parsed as Record<string, unknown>
    if (typeof record.error !== "string" || typeof record.detail !== "string") return responseWithBody(response, body)
    return responseWithBody(response, JSON.stringify({
      ...record,
      error: {
        message: record.detail,
        type: record.error,
        code: record.error,
      },
    }))
  } catch {
    return responseWithBody(response, body)
  }
}

function responseWithBody(response: Response, body: string): Response {
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
