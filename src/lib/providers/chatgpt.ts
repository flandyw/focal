import { Output, jsonSchema, streamText } from "ai"
import {
  ChatGPTProxyError,
  createChatGPTProxyProvider,
} from "@opencoredev/loginwithchatgpt-ai"
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

const configuredBasePath = import.meta.env.VITE_CHATGPT_BASE_PATH
const CHATGPT_BASE_PATH = configuredBasePath === undefined
  ? "http://localhost:41731/api/chatgpt"
  : configuredBasePath.trim().replace(/\/+$/, "")

/** Public endpoint only; the handler keeps ChatGPT tokens behind its session cookie. */
export function getChatGPTBasePath(): string {
  return CHATGPT_BASE_PATH
}

/** The desktop app needs credentialed cookies when the handler is hosted elsewhere. */
export const chatGPTFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  credentials: "include",
})

type ChatGPTReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh"

function normalizeChatGPTReasoningEffort(model?: string, reasoning?: ReasoningConfig): ChatGPTReasoningEffort | undefined {
  if (!reasoning?.effort) return undefined
  if (model === "gpt-6-astra" && reasoning.effort === "none") return "low"
  return reasoning.effort === "minimal" ? "low" : reasoning.effort
}

function getProxy(model?: string, reasoning?: ReasoningConfig) {
  if (!CHATGPT_BASE_PATH) {
    throw new Error("ChatGPT is not configured for this build. Set VITE_CHATGPT_BASE_PATH and rebuild Focal.")
  }
  const effort = normalizeChatGPTReasoningEffort(model, reasoning)
  const fetchWithReasoning: typeof fetch = (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString()
    if (effort && new URL(url, CHATGPT_BASE_PATH).pathname.endsWith("/responses")) {
      headers.set("x-login-with-chatgpt-reasoning-effort", effort)
    }
    return chatGPTFetch(input, { ...init, headers })
  }
  return createChatGPTProxyProvider({
    basePath: CHATGPT_BASE_PATH,
    credentials: "include",
    fetch: fetchWithReasoning,
    ...(model ? { defaultModel: model } : {}),
  })
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
  summary: "Use your own ChatGPT plan through Focal’s secure proxy (no API key).",
  requiresApiKey: false,
  configFields: [{ key: "model", label: "Model", kind: "text", required: true }],
  supportsReasoning: true,
  supportsToolCalling: true,

  isConfigured(): boolean {
    return Boolean(CHATGPT_BASE_PATH && getChatGPTModel())
  },

  async listModels(): Promise<ModelInfo[]> {
    return (await getProxy().listModels()).map(modelInfo)
  },

  async healthcheck(): Promise<ProviderHealthcheck> {
    try {
      const models = await this.listModels()
      return { ok: true, modelCount: models.length }
    } catch (error) {
      if (error instanceof ChatGPTProxyError && error.status === 401) {
        return { ok: false, error: "Connect a ChatGPT account first." }
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const prompt = toChatGPTPrompt(req.messages)
    const result = streamText({
      model: getProxy(req.model, req.reasoning)(req.model),
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
