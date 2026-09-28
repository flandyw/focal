import { resolve, sep } from "node:path"
import { createChatGPTAuth } from "./server/chatgpt"
import { handleMistakesPdf } from "./server/mistakes-pdf"

const dist = resolve(import.meta.dir, "dist")
const chatgptAuth = createChatGPTAuth()

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4173),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith("/api/chatgpt/")) return chatgptAuth.handler(request)
    if (url.pathname === "/api/mistakes-pdf") return handleMistakesPdf(request)

    const path = resolve(dist, `.${url.pathname}`)
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) return new Response("Bad request", { status: 400 })

    const file = Bun.file(path === dist ? resolve(dist, "index.html") : path)
    return new Response(await file.exists() ? file : Bun.file(resolve(dist, "index.html")))
  },
})

console.log(`ExamTrack running at ${server.url}`)
