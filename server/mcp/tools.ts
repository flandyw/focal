import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { z } from "zod"
import { insightTools } from "./insights.js"
import { recordTools } from "./records.js"
import { studyTools } from "./study.js"

type Hint = "read" | "write" | "delete"

export type Define = <S extends z.ZodRawShape>(
  name: string, description: string, shape: S, hint: Hint, run: (args: z.infer<z.ZodObject<S>>) => unknown,
) => void

export function defineTools(define: Define) {
  recordTools(define)
  studyTools(define)
  insightTools(define)
}

/** Every tool returns JSON text; a thrown Error becomes a tool error the model can read and correct. */
export function registerTools(server: McpServer) {
  // The SDK types tool arguments from the zod shape; `define` already does that for callers, so register loosely.
  const register = server.registerTool.bind(server) as (name: string, config: object, handler: (args: unknown) => Promise<CallToolResult>) => void
  const define: Define = (name, description, shape, hint, run) => {
    register(name, {
      description,
      inputSchema: shape,
      annotations: { readOnlyHint: hint === "read", destructiveHint: hint === "delete", openWorldHint: false },
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
