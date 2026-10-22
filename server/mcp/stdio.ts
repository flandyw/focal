import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMcpServer } from "./index"
import { authenticateStdioToken } from "./store"

await authenticateStdioToken(process.env.FOCAL_MCP_TOKEN)
await createMcpServer().connect(new StdioServerTransport())
