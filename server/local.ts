/// <reference types="bun-types" />

import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { createChatGPTService } from "./chatgpt"
import { handleMistakesPdf } from "./mistakes-pdf"

const DEFAULT_PORT = 41_731
const ALLOWED_ORIGINS = [
  "http://localhost:1420",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]

function localPort(): number {
  const value = Number(process.env.FOCAL_CHATGPT_PORT ?? DEFAULT_PORT)
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error("FOCAL_CHATGPT_PORT must be an integer between 1024 and 65535")
  }
  return value
}

const dataDirectory = process.env.FOCAL_CHATGPT_DATA_DIR ?? join(process.cwd(), ".focal-chatgpt")
await mkdir(dataDirectory, { recursive: true })
const chatgpt = createChatGPTService({ storageDir: dataDirectory, allowedOrigins: ALLOWED_ORIGINS })

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: localPort(),
  idleTimeout: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === "/health") return new Response("ok", { headers: { "cache-control": "no-store" } })
    if (pathname.startsWith("/api/chatgpt/")) return chatgpt(request)
    if (pathname === "/api/mistakes-pdf") {
      const origin = request.headers.get("origin")
      if (!origin || !ALLOWED_ORIGINS.includes(origin)) return new Response("Forbidden", { status: 403 })
      const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" }
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
      const response = await handleMistakesPdf(request)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(cors)) headers.set(key, value)
      return new Response(response.body, { status: response.status, headers })
    }
    return new Response("Not found", { status: 404 })
  },
})

console.warn(`[focal-chatgpt] listening on http://localhost:${server.port}`)

async function shutdown() {
  await server.stop(true)
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

if (process.env.FOCAL_CHATGPT_MANAGED === "1") {
  // Tauri owns stdin's write end; EOF means the desktop process is gone.
  process.stdin.on("end", shutdown)
  process.stdin.resume()
}
