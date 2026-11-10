import { resolve, sep } from "node:path"
import { handleMcp } from "./server/mcp"
import { handleMistakesPdf } from "./server/mistakes-pdf"
import { handleChat } from "./server/chat"
import { handlePush } from "./server/push"

const dist = resolve(import.meta.dir, "dist")
const COMPRESSIBLE = /\.(?:js|css|json|svg|html|webmanifest)$/
const gzipped = new Map<string, Uint8Array<ArrayBuffer>>()

// Same lifetimes as vercel.json, so the two deployments behave alike.
function cacheControl(pathname: string) {
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable"
  if (pathname.startsWith("/fonts/")) return "public, max-age=2592000"
  if (/^\/(?:vcaa-|vce-|vtac-).*\.json$/.test(pathname)) return "public, max-age=3600, stale-while-revalidate=604800"
  return "no-cache"
}

async function serveFile(request: Request, path: string, pathname: string) {
  const file = Bun.file(path)
  const headers = new Headers({
    "Cache-Control": cacheControl(pathname), "Content-Type": file.type, Vary: "Accept-Encoding",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  })
  if (!COMPRESSIBLE.test(path) || !request.headers.get("accept-encoding")?.includes("gzip")) return new Response(file, { headers })
  // shortcut: compressed copies stay in memory, keyed by build; fine while dist holds one deploy, restart after many rebuilds.
  const key = `${path}:${file.lastModified}`
  const body = gzipped.get(key) ?? Bun.gzipSync(await file.bytes())
  gzipped.set(key, body)
  headers.set("Content-Encoding", "gzip")
  return new Response(body, { headers })
}

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

    if (path !== dist && await Bun.file(path).exists()) return serveFile(request, path, url.pathname)
    // A chunk from an old deploy must fail as a chunk, so the client's reload recovery runs, not parse the app shell as JavaScript.
    if (url.pathname.startsWith("/assets/")) return new Response("Not found", { status: 404 })
    return serveFile(request, resolve(dist, "index.html"), "/")
  },
})

console.log(`Focal running at ${server.url}`)
