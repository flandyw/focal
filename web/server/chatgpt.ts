import { join } from "node:path"
import { ChatGPTError, createChatGPT } from "../../vendor/siwc/local/src/index.js"
import { createOsCredentialEncryption } from "./keystore.js"

// Sign in with ChatGPT runs on the user's own machine: this service owns the credentials and
// exposes only a narrow HTTP surface to the app UI. Tokens never leave this process.
const REDIRECT_PORT = Number(process.env.FOCAL_CHATGPT_REDIRECT_PORT ?? 8787)
const MAX_REQUEST_BYTES = 4_400_000
const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"])

export type ChatGPTServiceOptions = {
  storageDir: string
  /** Browser origins allowed to call the service cross-origin (the desktop webview). */
  allowedOrigins?: string[]
}

const json = (value: unknown, status = 200, headers?: Record<string, string>) =>
  Response.json(value, { status, headers: { "cache-control": "no-store", ...headers } })

function errorResponse(error: unknown) {
  const typed = error instanceof ChatGPTError ? error : new ChatGPTError("internal_error", "ChatGPT could not complete the request.")
  const status = ["sign_in_required", "reauth_required", "sharing_not_enabled"].includes(typed.code) ? 401
    : typed.code === "cancelled" ? 499
    : typed.code === "connection_busy" ? 409
    : typed.status && typed.status >= 400 && typed.status < 600 ? typed.status
    : typed.retryable ? 503 : 400
  // The `error` object matches the OpenAI error shape the AI SDK client already parses.
  return json({ error: { message: typed.message, type: typed.code, code: typed.code, retryable: typed.retryable } }, status)
}

export function createChatGPTService({ storageDir, allowedOrigins = [] }: ChatGPTServiceOptions) {
  const allowed = new Set(allowedOrigins)
  const chatgpt = createChatGPT({
    appName: "Focal",
    appId: "focal",
    redirectPort: REDIRECT_PORT,
    storageDir: join(storageDir, "chatgpt"),
    credentialEncryption: createOsCredentialEncryption(storageDir),
  })

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const route = url.pathname.replace(/^\/api\/chatgpt\/?/, "")
    // Any web page can reach a loopback port, so only the app's own origins may call it.
    const origin = request.headers.get("origin")
    const trusted = origin ? allowed.has(origin) || origin === url.origin : request.headers.get("sec-fetch-site") === "same-origin"
    if (!trusted) return json({ error: { message: "Forbidden", type: "forbidden", code: "forbidden" } }, 403)
    const cors: Record<string, string> = origin && allowed.has(origin) ? {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": request.headers.get("access-control-request-headers") ?? "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      vary: "Origin",
    } : {}
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })

    const respond = async (): Promise<Response> => {
      try {
        if (route === "session" && request.method === "GET") return json(await chatgpt.getSession())
        if (route === "models" && request.method === "GET") return json((await chatgpt.listModels({ signal: request.signal })).map((model) => model.slug))
        if (route === "signin" && request.method === "POST") {
          const body = await request.json().catch(() => ({})) as { reconsent?: unknown }
          return json(await chatgpt.signIn({ reconsent: body.reconsent === true }))
        }
        if (route === "cancel" && request.method === "POST") { chatgpt.cancelSignIn(); return json(await chatgpt.getSession()) }
        if (route === "disconnect" && request.method === "POST") { await chatgpt.disconnect(); return json(await chatgpt.getSession()) }
        if (route === "v1/responses" && request.method === "POST") {
          const text = await request.text()
          if (text.length > MAX_REQUEST_BYTES) return json({ error: { message: "The request is too large.", type: "responses_request_too_large", code: "responses_request_too_large" } }, 413)
          const body = JSON.parse(text) as Record<string, unknown>
          const effort = request.headers.get("x-focal-reasoning-effort")
          if (effort && REASONING_EFFORTS.has(effort)) body.reasoning = { ...(body.reasoning as object | undefined), effort }
          // Responses are never stored upstream.
          const upstream = await chatgpt.proxyResponses(JSON.stringify({ ...body, store: false }), request.signal)
          const headers = new Headers({ "cache-control": "no-store" })
          const type = upstream.headers.get("content-type")
          if (type) headers.set("content-type", type)
          return new Response(upstream.body, { status: upstream.status, headers })
        }
        return json({ error: { message: "Not found", type: "not_found", code: "not_found" } }, 404)
      } catch (error) {
        if (error instanceof SyntaxError) return json({ error: { message: "Invalid request body.", type: "invalid_request", code: "invalid_request" } }, 400)
        return errorResponse(error)
      }
    }
    const response = await respond()
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(cors)) headers.set(key, value)
    return new Response(response.body, { status: response.status, headers })
  }
}
