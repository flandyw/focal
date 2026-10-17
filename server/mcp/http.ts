import { handleMcp } from "./index"

// Bun serves a default export with `fetch`. Bind to localhost and put a TLS reverse proxy in front.
export default {
  hostname: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4174),
  fetch: (request: Request) => new URL(request.url).pathname === "/mcp" ? handleMcp(request) : new Response("Not found", { status: 404 }),
}
