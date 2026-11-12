import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { z } from "zod"
import { attachmentTools } from "./attachments.js"
import { appTools } from "./app.js"
import { friendTools } from "./friends.js"
import { insightTools } from "./insights.js"
import { recordTools } from "./records.js"
import { studyTools } from "./study.js"

type Hint = "read" | "write" | "delete"

export type Define = <S extends z.ZodRawShape>(
  name: string, description: string, shape: S, hint: Hint, run: (args: z.infer<z.ZodObject<S>>) => unknown,
) => void

export function defineTools(define: Define) {
  attachmentTools(define)
  appTools(define)
  friendTools(define)
  recordTools(define)
  studyTools(define)
  insightTools(define)
  define("get_capabilities", "Discover all available tools and the boundary between synced account data and device-local features.", {}, "read", () => {
    const tools: { name: string; description: string; access: Hint }[] = []
    const collect: Define = (name, description, _shape, access) => { tools.push({ name, description, access }) }
    attachmentTools(collect)
    appTools(collect)
    friendTools(collect)
    recordTools(collect)
    studyTools(collect)
    insightTools(collect)
    return { tools, limitations: ["Device-local chat history, appearance, navigation, notification permissions and native dialogs require the app on that device.", "Historical desktop-only SQLite sessions are not uploaded by MCP.", "Authentication, token creation/revocation and ChatGPT sidecar login stay in the app."] }
  })
}

/** Every tool returns JSON text; a thrown Error becomes a tool error the model can read and correct. */
export function registerTools(server: McpServer) {
  // The SDK types tool arguments from the zod shape; `define` already does that for callers, so register loosely.
  const register = server.registerTool.bind(server) as (name: string, config: object, handler: (args: unknown) => Promise<CallToolResult>) => void
  const define: Define = (name, description, shape, hint, run) => {
    register(name, {
      description,
      inputSchema: shape,
      annotations: { readOnlyHint: hint === "read", destructiveHint: hint === "delete", openWorldHint: ["export_mistake_worksheet", "friends_add", "friends_cheer", "friend_study_create", "friend_study_invite"].includes(name) },
    }, async (args) => {
      try {
        const result = await run(args as z.infer<z.ZodObject<typeof shape>>)
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? { ok: true }) }] }
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] }
      }
    })
  }
  defineTools(define)
}
