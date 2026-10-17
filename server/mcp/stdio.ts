import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createMcpServer } from "./index"

await createMcpServer().connect(new StdioServerTransport())
