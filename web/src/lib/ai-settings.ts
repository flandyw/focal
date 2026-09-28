export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh"] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export type AISettings = {
  model: string
  reasoningEffort: ReasoningEffort
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  model: "auto",
  reasoningEffort: "medium",
}

export function supportsStreamedAnalysis(model: string) {
  return model !== "auto"
    && model !== "codex-auto-review"
    && !/(?:^|-)pro(?:-|$)/.test(model)
}

const STORAGE_KEY = "examtrack:ai-settings:v1"

export function parseAISettings(value: string | null): AISettings {
  if (!value) return DEFAULT_AI_SETTINGS
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== "object") return DEFAULT_AI_SETTINGS
    const settings = parsed as Record<string, unknown>
    return {
      model: typeof settings.model === "string" && settings.model ? settings.model : "auto",
      reasoningEffort: REASONING_EFFORTS.includes(settings.reasoningEffort as ReasoningEffort)
        ? settings.reasoningEffort as ReasoningEffort
        : "medium",
    }
  } catch {
    return DEFAULT_AI_SETTINGS
  }
}

export function loadAISettings(): AISettings {
  return parseAISettings(localStorage.getItem(STORAGE_KEY))
}

export function saveAISettings(settings: AISettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
