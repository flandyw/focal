import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { TIMETABLE_SCREENSHOT_PROMPT } from "../../src/lib/class-timetable"
import { buildProgressionPrompt } from "../../src/lib/exam-progression"
import { asUser, resolveToken } from "./store"
import { registerTools } from "./tools"

const INSTRUCTIONS = `Focal is a VCE (Victoria, Australia) study app: practice exams, mistakes with spaced repetition, SACs, calendar, study timer, stoplight skill checklists, goals and predictions.
Start with get_overview. Records are addressed by the ids that list_* tools return. Dates are YYYY-MM-DD in the account's local time zone; instants carry a UTC offset.
Use add_mistakes to record mistakes and update_mistake to edit them. Mistake difficulty is an optional integer from 1 (easy) to 5 (very hard); omit it when unknown. This is separate from recall ratings used by review_mistake.
Writes are applied to the same synced data the web and desktop apps use, so they appear there within seconds. Subjects are free text but should match the account's subject names (get_settings).`

export function createMcpServer() {
  const server = new McpServer({ name: "focal", version: "1.0.0" }, { instructions: INSTRUCTIONS })
  registerTools(server)
  const format = (name: string, uri: string, description: string, text: string) =>
    server.registerResource(name, uri, { description, mimeType: "text/plain" }, (url) => ({ contents: [{ uri: url.href, text }] }))
  format("timetable-format", "focal://formats/timetable", "Format for import_class_timetable (and how to extract it from a timetable screenshot).", TIMETABLE_SCREENSHOT_PROMPT)
  format("progression-format", "focal://formats/progression", "Format for import_exam_progression.", buildProgressionPrompt([], ""))
  return server
}

/**
 * Stateless Streamable HTTP: a fresh server per request, nothing held between calls, so it runs anywhere
 * `fetch` does. The bearer token is a personal access token created in Focal's settings; the request runs as its owner.
 */
export async function handleMcp(request: Request): Promise<Response> {
  // The token is a bearer header, or the last URL segment (/mcp/<token>) for connectors that cannot send headers.
  const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? new URL(request.url).pathname.split("/")[2] ?? ""
  const unauthorized = (why: string) => { console.warn(`mcp 401: ${why}`); return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } }) }
  if (!token.startsWith("focal_")) return unauthorized(token ? "bearer token without focal_ prefix" : "no Bearer authorization header")
  let userId: string | null
  try { userId = await resolveToken(token) } catch (error) { return new Response(error instanceof Error ? error.message : "Token lookup failed", { status: 503 }) }
  if (!userId) return unauthorized("unknown or revoked token")
  return asUser(userId, async () => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await createMcpServer().connect(transport)
    return transport.handleRequest(request)
  })
}
