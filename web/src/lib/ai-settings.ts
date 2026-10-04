// Desktop uses the same sidecar connection as the main app's AI settings.
export const chatGPTOptions = {
  basePath: import.meta.env.VITE_CHATGPT_BASE_PATH?.trim().replace(/\/+$/, "")
    ?? (import.meta.env.VITE_EMBEDDED_EXAMS ? "http://localhost:41731/api/chatgpt" : "/api/chatgpt"),
  credentials: "include" as const,
  fetch: ((input, init) => fetch(input, { ...init, credentials: "include" })) as typeof fetch,
}

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

/** Planning is a cheap, high-volume job, so it gets its own model choice. */
export const CHEAPEST_MODEL = "gpt-6-luna"

export function isCheapestModel(model: string) {
  return model === CHEAPEST_MODEL || model.endsWith("-luna")
}

/** Falls back to the cheapest model this account actually offers, so a stored
 *  preference never points at a model that stopped being available. */
export function pickPlannerModel(models: string[], preferred: string): string | null {
  const supported = models.filter(supportsStreamedAnalysis)
  if (supported.includes(preferred)) return preferred
  return supported.find(isCheapestModel) ?? supported[0] ?? null
}

const PLANNER_MODEL_KEY = "examtrack:ai-settings:planner-model:v1"

export function loadPlannerModel(): string {
  if (typeof localStorage === "undefined") return CHEAPEST_MODEL
  return localStorage.getItem(PLANNER_MODEL_KEY) || CHEAPEST_MODEL
}

export function savePlannerModel(model: string) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(PLANNER_MODEL_KEY, model)
  } catch {
    // A blocked or full storage must not stop planning.
  }
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
