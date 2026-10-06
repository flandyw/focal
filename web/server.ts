import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"
import { createChatGPTService } from "./server/chatgpt"
import { handleMistakesPdf } from "./server/mistakes-pdf"

const dist = resolve(import.meta.dir, "dist")
const dataDirectory = process.env.FOCAL_DATA_DIR ?? join(homedir(), ".focal")
await mkdir(dataDirectory, { recursive: true })
const chatgpt = createChatGPTService({ storageDir: dataDirectory })

const server = Bun.serve({
  hostname: "127.0.0.1",
  idleTimeout: 0,
  port: Number(process.env.PORT ?? 4173),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith("/api/chatgpt/")) return chatgpt(request)
    if (url.pathname === "/api/mistakes-pdf") return handleMistakesPdf(request)

    const path = resolve(dist, `.${url.pathname}`)
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) return new Response("Bad request", { status: 400 })

    const file = Bun.file(path === dist ? resolve(dist, "index.html") : path)
    return new Response(await file.exists() ? file : Bun.file(resolve(dist, "index.html")))
  },
})

console.log(`Focal running at ${server.url}`)
