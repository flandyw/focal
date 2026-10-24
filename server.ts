import { resolve, sep } from "node:path"
import { handleMcp } from "./server/mcp"
import { handleMistakesPdf } from "./server/mistakes-pdf"
import { handleChat } from "./server/chat"
import { handlePush } from "./server/push"

const dist = resolve(import.meta.dir, "dist")

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4173),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/mistakes-pdf") return handleMistakesPdf(request)
    if (url.pathname === "/api/chat") return handleChat(request)
    if (url.pathname === "/api/push") return handlePush(request)
    if (url.pathname === "/api/mcp") return handleMcp(request)

    const path = resolve(dist, `.${url.pathname}`)
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) return new Response("Bad request", { status: 400 })

    const file = Bun.file(path === dist ? resolve(dist, "index.html") : path)
    if (!await file.exists()) return new Response(Bun.file(resolve(dist, "index.html")))
    // Vite content-hashes everything under /assets, so it can be cached forever.
    return new Response(file, url.pathname.startsWith("/assets/") ? { headers: { "Cache-Control": "public, max-age=31536000, immutable" } } : undefined)
  },
})

console.log(`Focal running at ${server.url}`)
