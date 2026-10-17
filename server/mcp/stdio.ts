import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMcpServer } from "./index"
import { useStdioToken } from "./store"

await useStdioToken(process.env.FOCAL_MCP_TOKEN)
await createMcpServer().connect(new StdioServerTransport())
