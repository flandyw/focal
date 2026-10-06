import { Output, jsonSchema, streamText } from "ai"
import { ChatGPTRequestError, createChatGPTProvider } from "../../../web/src/lib/chatgpt-client"
import { getChatGPTModel } from "@/lib/settings"
import { toChatGPTPrompt } from "@/lib/providers/chatgpt-prompt"
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ModelInfo,
  Provider,
  ProviderHealthcheck,
  ReasoningConfig,
} from "@/lib/providers/types"
import { logLlmExchange } from "@/lib/providers/shared"

type ChatGPTReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh"

function normalizeChatGPTReasoningEffort(model?: string, reasoning?: ReasoningConfig): ChatGPTReasoningEffort | undefined {
  if (!reasoning?.effort) return undefined
  if (model === "gpt-6-astra" && reasoning.effort === "none") return "low"
  return reasoning.effort === "minimal" ? "low" : reasoning.effort
}

function toTools(tools: ChatCompletionRequest["tools"]) {
  return Object.fromEntries(
    (tools ?? []).map((tool) => [
      tool.function.name,
      {
        description: tool.function.description,
        inputSchema: jsonSchema(tool.function.parameters),
      },
    ]),
  )
}

function toolArguments(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input)
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Leave malformed tool input for the caller to handle as an empty object.
    }
  }
  return {}
}

function modelInfo(id: string): ModelInfo {
  const name = id === "gpt-6-astra" ? "GPT-6 Astra"
    : id === "gpt-6-sol" ? "GPT-6 Sol"
    : id === "gpt-6-luna" ? "GPT-6 Luna"
    : id === "gpt-5.6-luna" ? "GPT-5.6 Luna"
    : id === "gpt-5.6-terra" ? "GPT-5.6 Terra"
    : id === "gpt-5.6-sol" ? "GPT-5.6 Sol"
    : id
  return {
    id,
    name,
    capabilities: ["chat"],
    supportsStructuredOutput: true,
  }
}

export const chatgptProvider: Provider = {
  id: "chatgpt",
  displayName: "ChatGPT",
  summary: "Sign in with ChatGPT to use your own plan (no API key).",
  requiresApiKey: false,
  configFields: [{ key: "model", label: "Model", kind: "text", required: true }],
  supportsReasoning: true,
  supportsToolCalling: true,

  isConfigured(): boolean {
    return Boolean(getChatGPTModel())
  },

  async listModels(): Promise<ModelInfo[]> {
    return (await createChatGPTProvider().listModels()).map(modelInfo)
  },

  async healthcheck(): Promise<ProviderHealthcheck> {
    try {
      const models = await this.listModels()
      return { ok: true, modelCount: models.length }
    } catch (error) {
      if (error instanceof ChatGPTRequestError && error.status === 401) {
        return { ok: false, error: "Connect a ChatGPT account first." }
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const prompt = toChatGPTPrompt(req.messages)
    const effort = normalizeChatGPTReasoningEffort(req.model, req.reasoning)
    const result = streamText({
      // ponytail: web/ and the root resolve separate copies of the AI SDK types; the runtime object is the same shape.
      model: createChatGPTProvider()(req.model) as unknown as Parameters<typeof streamText>[0]["model"],
      messages: prompt.messages,
      ...(prompt.instructions
        ? { providerOptions: { openai: { instructions: prompt.instructions } } }
        : {}),
      ...(req.tools?.length ? { tools: toTools(req.tools) } : {}),
      ...(req.jsonSchema
        ? {
            output: Output.object({
              name: req.jsonSchema.name,
              schema: jsonSchema(req.jsonSchema.schema),
            }),
          }
        : {}),
      ...(effort ? { headers: { "x-focal-reasoning-effort": effort } } : {}),
      ...(typeof req.maxTokens === "number" ? { maxOutputTokens: req.maxTokens } : {}),
      ...(req.signal ? { abortSignal: req.signal } : {}),
    })
    const content = req.jsonSchema
      ? JSON.stringify(await result.output)
      : await result.text
    const toolCalls = (await result.toolCalls).map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      arguments: toolArguments(call.input),
    }))
    const finishReason = await result.finishReason
    logLlmExchange({
      provider: "chatgpt",
      model: req.model,
      requestAttempt: 1,
      rawResponse: { finishReason },
      resolvedContent: content,
      toolCallCount: toolCalls.length,
      finishReason,
    })
    return {
      content,
      ...(toolCalls.length ? { toolCalls } : {}),
      finishReason,
    }
  },
}
