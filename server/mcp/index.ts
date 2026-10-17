import { createHash, timingSafeEqual } from "node:crypto"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { TIMETABLE_SCREENSHOT_PROMPT } from "../../src/lib/class-timetable"
import { buildProgressionPrompt } from "../../src/lib/exam-progression"
import { registerTools } from "./tools"

const INSTRUCTIONS = `Focal is a VCE (Victoria, Australia) study app: practice exams, mistakes with spaced repetition, SACs, calendar, study timer, stoplight skill checklists, goals and predictions.
Start with get_overview. Records are addressed by the ids that list_* tools return. Dates are YYYY-MM-DD in the account's local time zone; instants carry a UTC offset.
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

const digest = (value: string) => createHash("sha256").update(value).digest()

/**
 * Stateless Streamable HTTP: a fresh server per request, nothing held between calls, so it runs anywhere
 * `fetch` does. The endpoint is closed unless FOCAL_MCP_TOKEN is set, and then needs it as a bearer token.
 */
export async function handleMcp(request: Request): Promise<Response> {
  const token = process.env.FOCAL_MCP_TOKEN
  if (!token) return new Response("MCP is disabled: set FOCAL_MCP_TOKEN.", { status: 503 })
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? ""
  if (!timingSafeEqual(digest(given), digest(token))) return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await createMcpServer().connect(transport)
  return transport.handleRequest(request)
}
