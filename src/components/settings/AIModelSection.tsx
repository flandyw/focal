import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { motion, useReducedMotion, AnimatePresence } from "framer-motion"
import { invoke } from "@tauri-apps/api/core"
import { ChatGPTConnection } from "../../../web/src/components/chatgpt-connection"
import { useChatGPT } from "../../../web/src/lib/chatgpt-client"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Loader2,
  ExternalLink,
  Search,
  Sparkles,
  Check,
  FileText,
  Brain,
  HelpCircle,
  RefreshCw,
  Server,
  KeyRound,
  Download,
  X,
} from "lucide-react"
import { cn, isRecord } from "@/lib/utils"
import {
  getApiKey,
  setApiKey,
  getOllamaBaseUrl,
  setOllamaBaseUrl,
  getReasoningEffort,
  setReasoningEffort,
  getReasoningMaxTokens,
  setReasoningMaxTokens,
  getReasoningExclude,
  setReasoningExclude,
  ASSISTANT_PERSONALITIES,
  getAssistantPersonality,
  setAssistantPersonality,
  getAssistantCustomInstructions,
  setAssistantCustomInstructions,
} from "@/lib/settings"
import {
  getActiveProvider,
  getEffectiveModel,
  setEffectiveModel,
  listProviders,
  setActiveProvider,
  chatgptProvider,
  ollamaProvider,
  openrouterProvider,
  type Provider,
  type ModelInfo,
} from "@/lib/providers"
import { chooseOllamaModel, pullOllamaModel } from "@/lib/providers/ollama"
import { notifyUserSettingsChanged } from "@/lib/sync/engine"
import type { AssistantPersonality, ReasoningEffort } from "@/lib/settings"

interface OpenRouterCredits {
  total_credits: number
  total_usage: number
}

interface OpenRouterErrorPayload {
  code: string
  message: string
}

interface OpenRouterCreditsWrapper {
  data?: OpenRouterCredits
  error?: OpenRouterErrorPayload
}

interface OpenRouterFetchError extends Error {
  code?: string
}

const REASONING_BLURB: Record<ReasoningEffort, string> = {
  xhigh: "Maximum thinking, slowest. Best for hard problems.",
  high: "Deep reasoning, slower. For multi-step tasks.",
  medium: "Balanced. Most tasks.",
  low: "Light thinking, fast.",
  minimal: "Quick checks, no real planning.",
  none: "No reasoning. Cheapest and fastest.",
}

function isCredits(value: unknown): value is OpenRouterCredits {
  return (
    isRecord(value) &&
    typeof value.total_credits === "number" &&
    typeof value.total_usage === "number"
  )
}

function isErrorPayload(value: unknown): value is OpenRouterErrorPayload {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  )
}

function isCreditsWrapper(value: unknown): value is OpenRouterCreditsWrapper {
  return (
    isRecord(value) &&
    (value.data === undefined || isCredits(value.data)) &&
    (value.error === undefined || isErrorPayload(value.error))
  )
}

function createOpenRouterError(message: string, code?: string): OpenRouterFetchError {
  const error = new Error(message) as OpenRouterFetchError
  error.code = code
  return error
}

async function fetchCredits(apiKey: string): Promise<OpenRouterCredits> {
  const res = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    if (res.status === 401) throw new Error("A Management key is required to view credits")
    throw new Error("Failed to fetch credits")
  }
  const data: unknown = await res.json()
  const credits = (data as { data?: OpenRouterCredits }).data
  if (!credits) throw new Error("Invalid response")
  return credits
}

async function fetchCreditsWithBackend(apiKey: string): Promise<OpenRouterCredits> {
  try {
    const res = await invoke<unknown>("get_credits", { api_key: apiKey })
    if (isCredits(res)) return res
    if (isCreditsWrapper(res)) {
      if (res.data) return res.data
      if (res.error) throw createOpenRouterError(res.error.message, res.error.code)
    }
  } catch {
    // ignore and fallback to direct fetch in non-Tauri environments
  }
  return fetchCredits(apiKey)
}

function formatContextLength(n: number | undefined): string | null {
  if (!n) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatBytes(n: number | undefined): string | null {
  if (!n || n < 0) return null
  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / 1024 ** index).toFixed(index < 3 ? 0 : 1)} ${units[index]}`
}

function localModelMeta(model: ModelInfo): string[] {
  if (!model.sizeBytes && !model.parameterSize && !model.quantization && !model.family && !model.capabilities) return []
  return [
    model.parameterSize,
    model.quantization,
    formatBytes(model.sizeBytes),
    formatContextLength(model.contextLength) ? `${formatContextLength(model.contextLength)} context` : null,
    model.capabilities?.includes("tools") ? "tools" : null,
    model.capabilities?.includes("vision") ? "vision" : null,
  ].filter((value): value is string => Boolean(value))
}

function ModelRow({
  model,
  isSelected,
  onSelect,
}: {
  model: ModelInfo
  isSelected: boolean
  onSelect: () => void
}) {
  const contextLength = formatContextLength(model.contextLength)
  const localMeta = localModelMeta(model)
  return (
    <Button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      variant="ghost"
      className={cn(
        "h-auto w-full justify-start gap-2.5 px-2.5 py-1.5 text-left whitespace-normal",
        isSelected
          ? "bg-primary/10 text-primary"
          : undefined,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
          isSelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30",
        )}
      >
        {isSelected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate leading-tight">{model.name}</p>
        {localMeta.length > 0 ? (
          <p className="mt-0.5 truncate text-micro text-muted-foreground/60">
            {localMeta.join(" · ")}
          </p>
        ) : contextLength && (
          <p className="mt-0.5 flex items-center gap-2 text-micro text-muted-foreground/60">
            <span className="inline-flex items-center gap-0.5">
              <Brain className="h-2.5 w-2.5" />
              {contextLength}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <FileText className="h-2.5 w-2.5" />
              files
            </span>
          </p>
        )}
      </div>
    </Button>
  )
}

function CreditsGauge({ credits }: { credits: OpenRouterCredits }) {
  const reduceMotion = useReducedMotion()
  const remaining = Math.max(0, credits.total_credits - credits.total_usage)
  const usedRatio =
    credits.total_credits > 0
      ? Math.min(1, credits.total_usage / credits.total_credits)
      : 0
  const usedPct = Math.round(usedRatio * 100)
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-micro font-medium uppercase tracking-wider text-muted-foreground/65">
            Credits remaining
          </p>
          <p className="mt-0.5 font-heading text-lg font-semibold tabular-nums">
            ${remaining.toFixed(2)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-micro text-muted-foreground/60 tabular-nums">
            of ${credits.total_credits.toFixed(2)}
          </p>
          <p
            className={cn(
              "mt-0.5 text-caption font-medium tabular-nums",
              usedRatio > 0.85
                ? "text-destructive"
                : usedRatio > 0.6
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {usedPct}% used
          </p>
        </div>
      </div>
      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/8">
        <motion.div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            usedRatio > 0.85
              ? "bg-destructive"
              : usedRatio > 0.6
                ? "bg-amber-500"
                : "bg-success",
          )}
          initial={false}
          animate={{ width: `${usedRatio * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  )
}

function SelectedModelCard({ modelId, models }: { modelId: string; models: ModelInfo[] }) {
  const reduceMotion = useReducedMotion()
  const model = useMemo(() => models.find((m) => m.id === modelId), [models, modelId])
  if (!model) return null
  const prompt = model.pricing ? Number.parseFloat(model.pricing.prompt) : undefined
  const completion = model.pricing ? Number.parseFloat(model.pricing.completion) : undefined
  const contextLength = formatContextLength(model.contextLength)
  const localMeta = localModelMeta(model)
  return (
    <motion.div
      key={modelId}
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-2.5 rounded-lg border border-primary/25 bg-primary/[0.05] p-2.5"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-caption font-medium leading-tight">{model.name}</p>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground/65">
          {model.pricing && contextLength
            ? `${contextLength} context · $${prompt?.toFixed(3) ?? "?"} in · $${completion?.toFixed(3) ?? "?"} out`
            : localMeta.length > 0 ? localMeta.join(" · ") : `Local model tag: ${model.id}`}
        </p>
      </div>
    </motion.div>
  )
}

export function AIModelSection() {
  const providers = useMemo(() => listProviders(), [])
  const [providerId, setProviderIdState] = useState(() => getActiveProvider().id)
  const [key, setKeyState] = useState(() => getApiKey())
  const [ollamaBaseUrl, setOllamaBaseUrlState] = useState(() => getOllamaBaseUrl())
  const [model, setModelState] = useState(() => getEffectiveModel())
  const [reasoningEffort, setReasoningEffortState] = useState<ReasoningEffort>(() => getReasoningEffort())
  const [reasoningMaxTokens, setReasoningMaxTokensState] = useState(() => getReasoningMaxTokens())
  const [reasoningExclude, setReasoningExcludeState] = useState(() => getReasoningExclude())
  const [assistantPersonality, setAssistantPersonalityState] = useState<AssistantPersonality>(() => getAssistantPersonality())
  const [assistantCustomInstructions, setAssistantCustomInstructionsState] = useState(() => getAssistantCustomInstructions())

  const [saved, setSaved] = useState(false)
  const [credits, setCredits] = useState<OpenRouterCredits | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsError, setCreditsError] = useState<string | null>(null)

  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelSearch, setModelSearch] = useState("")
  const [pullName, setPullName] = useState("")
  const [pullStatus, setPullStatus] = useState<
    { status: "idle" | "pending" | "ok" | "error"; message?: string }
  >({ status: "idle" })
  const pullController = useRef<AbortController | null>(null)
  const [reasoningHelpOpen, setReasoningHelpOpen] = useState(false)
  const [healthStatus, setHealthStatus] = useState<
    { status: "idle" | "pending" | "ok" | "error"; error?: string; version?: string; modelCount?: number }
  >({ status: "idle" })

  const activeProvider: Provider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? providers[0],
    [providers, providerId],
  )
  const isOpenRouter = providerId === openrouterProvider.id
  const isOllama = providerId === ollamaProvider.id
  const isChatGPT = providerId === chatgptProvider.id

  useEffect(() => {
    let cancelled = false
    const timeout = setTimeout(() => {
      setModels([])
      setModelsLoading(true)
      setModelsError(null)
      setHealthStatus({ status: "idle" })
      activeProvider
        .listModels()
        .then((items) => {
          if (cancelled) return
          setModels(items)
          if (isOllama) {
            setHealthStatus({ status: "ok", modelCount: items.length })
            const nextModel = chooseOllamaModel(items, getEffectiveModel())
            if (nextModel) {
              setModelState(nextModel)
              setEffectiveModel(nextModel)
              notifyUserSettingsChanged()
            }
          }
          if (isChatGPT) {
            const currentModel = getEffectiveModel()
            const nextModel = items.some((item) => item.id === currentModel)
              ? currentModel
              : items[0]?.id
            if (nextModel && nextModel !== currentModel) {
              setModelState(nextModel)
              setEffectiveModel(nextModel)
              notifyUserSettingsChanged()
            }
          }
          setModelsLoading(false)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          const message = e instanceof Error ? e.message : String(e)
          setModelsError(message)
          if (isOllama) setHealthStatus({ status: "error", error: message })
          setModelsLoading(false)
        })
    }, isOllama ? 350 : 0)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [activeProvider, isChatGPT, isOllama, ollamaBaseUrl])

  useEffect(() => () => pullController.current?.abort(), [])

  useEffect(() => {
    if (!isOpenRouter) {
      queueMicrotask(() => {
        setCredits(null)
        setCreditsLoading(false)
        setCreditsError(null)
      })
      return
    }
    if (!key) {
      queueMicrotask(() => {
        setCredits(null)
        setCreditsLoading(false)
      })
      return
    }
    queueMicrotask(() => {
      setCreditsLoading(true)
      setCreditsError(null)
    })
    let cancelled = false
    fetchCreditsWithBackend(key)
      .then((c) => { if (!cancelled) { setCredits(c); setCreditsError(null) } })
      .catch((e) => { if (!cancelled) { setCredits(null); setCreditsError(e instanceof Error ? e.message : String(e)) } })
      .finally(() => { if (!cancelled) setCreditsLoading(false) })
    return () => { cancelled = true }
  }, [isOpenRouter, key])

  const filteredModels = useMemo(() => {
    const q = modelSearch.toLowerCase()
    if (!q) return models
    return models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
  }, [models, modelSearch])

  const handleProviderChange = useCallback((id: string) => {
    if (id === providerId) return
    setProviderIdState(id)
    setActiveProvider(id)
    setModelState(getEffectiveModel())
    notifyUserSettingsChanged()
  }, [providerId])

  const handleKeyChange = useCallback((value: string) => {
    setKeyState(value)
    setApiKey(value)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    notifyUserSettingsChanged()
  }, [])

  const handleOllamaBaseUrlChange = useCallback((value: string) => {
    setOllamaBaseUrlState(value)
    setOllamaBaseUrl(value)
    notifyUserSettingsChanged()
  }, [])

  const handleModelChange = useCallback((value: string) => {
    setModelState(value)
    setEffectiveModel(value)
    notifyUserSettingsChanged()
  }, [])

  const handleRefreshModels = useCallback(async () => {
    setModelsLoading(true)
    setModelsError(null)
    try {
      const items = await activeProvider.listModels()
      setModels(items)
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e))
    } finally {
      setModelsLoading(false)
    }
  }, [activeProvider])

  const chatgptConnected = useChatGPT().isAuthenticated
  useEffect(() => {
    if (isChatGPT && chatgptConnected) void handleRefreshModels()
  }, [isChatGPT, chatgptConnected, handleRefreshModels])

  const handleHealthcheck = useCallback(async () => {
    setHealthStatus({ status: "pending" })
    const result = await activeProvider.healthcheck()
    setHealthStatus(result.ok
      ? { status: "ok", version: result.version, modelCount: result.modelCount }
      : { status: "error", error: result.error })
  }, [activeProvider])

  const handlePullModel = useCallback(async () => {
    if (pullStatus.status === "pending") {
      pullController.current?.abort()
      return
    }
    const name = pullName.trim()
    if (!name) {
      setPullStatus({ status: "error", message: "Enter a model name, such as qwen3:8b." })
      return
    }
    const controller = new AbortController()
    pullController.current = controller
    setPullStatus({ status: "pending", message: `Pulling ${name}…` })
    try {
      await pullOllamaModel(name, controller.signal)
      const items = await activeProvider.listModels()
      setModels(items)
      setModelsError(null)
      const installed = items.find((item) => item.id === name || item.id === `${name}:latest`)
      if (installed) handleModelChange(installed.id)
      setPullName("")
      setPullStatus({ status: "ok", message: `${installed?.name ?? name} is ready.` })
    } catch (error) {
      if (controller.signal.aborted) {
        setPullStatus({ status: "idle" })
      } else {
        setPullStatus({ status: "error", message: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (pullController.current === controller) pullController.current = null
    }
  }, [activeProvider, handleModelChange, pullName, pullStatus.status])

  const modelRows = useMemo(() => filteredModels.map((m) => (
    <ModelRow
      key={m.id}
      model={m}
      isSelected={model === m.id}
      onSelect={() => handleModelChange(m.id)}
    />
  )), [filteredModels, model, handleModelChange])

  const handleReasoningEffortChange = useCallback((value: ReasoningEffort) => {
    setReasoningEffortState(value)
    setReasoningEffort(value)
    notifyUserSettingsChanged()
  }, [])

  const handleReasoningMaxTokensChange = useCallback((value: number) => {
    setReasoningMaxTokensState(value)
    setReasoningMaxTokens(value)
    notifyUserSettingsChanged()
  }, [])

  const handleReasoningExcludeChange = useCallback((checked: boolean) => {
    setReasoningExcludeState(checked)
    setReasoningExclude(checked)
    notifyUserSettingsChanged()
  }, [])

  const handleAssistantPersonalityChange = useCallback((value: AssistantPersonality) => {
    setAssistantPersonalityState(value)
    setAssistantPersonality(value)
    notifyUserSettingsChanged()
  }, [])

  const handleAssistantCustomInstructionsChange = useCallback((value: string) => {
    const bounded = value.slice(0, 500)
    setAssistantCustomInstructionsState(bounded)
    setAssistantCustomInstructions(bounded)
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <section className="border-t border-border/70 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">AI Provider</h2>
            <p className="mt-1 text-xs text-muted-foreground/70 text-wrap-balance">
              Choose where language-model requests go. Switch any time — provider choice syncs across your devices.
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {providers.map((provider) => {
            const selected = provider.id === providerId
            return (
              <Button
                key={provider.id}
                type="button"
                onClick={() => handleProviderChange(provider.id)}
                aria-pressed={selected}
                variant={selected ? "default" : "outline"}
                className="h-auto min-w-0 flex-1 basis-40 flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal"
              >
                <span className="flex items-center gap-1.5 text-caption font-semibold">
                  {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  {provider.displayName}
                </span>
                <span className="line-clamp-2 text-micro text-muted-foreground/70">
                  {provider.summary}
                </span>
              </Button>
            )
          })}
        </div>
      </section>

      {isChatGPT && (
        <section className="border-t border-border/70 pt-5">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">ChatGPT account</h2>
            <p className="mt-1 text-xs text-muted-foreground/70 text-wrap-balance">
              Sign in with ChatGPT to use your plan. Focal never receives your password; credentials stay encrypted on this device.
            </p>
          </div>
          <div className="mt-3"><ChatGPTConnection /></div>
        </section>
      )}

      {isOpenRouter && (
        <section className="border-t border-border/70 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-sm font-medium">
                <KeyRound className="h-3.5 w-3.5" />
                OpenRouter API Key
              </h2>
              <p className="mt-1 text-xs text-muted-foreground/70 text-wrap-balance">
                Used for AI file renaming and any features that need a language model.
              </p>
            </div>
            {saved && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/25 bg-success/10 px-1.5 py-0.5 text-caption font-medium text-success">
                <Check className="h-3 w-3" />
                Saved
              </span>
            )}
          </div>
          <Input
            id="openrouter-api-key"
            type="password"
            value={key ?? ""}
            onChange={(e) => handleKeyChange(e.target.value)}
            placeholder="sk-or-..."
            className="mt-3 h-9 font-mono text-xs"
            aria-label="OpenRouter API key"
          />
          <p className="mt-2 rounded-lg border border-border/70 bg-background/30 p-2.5 text-xs text-muted-foreground/70">
            API keys stay on this device and are not synced to your account.
          </p>
          <div className="mt-2 flex items-center justify-end">
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              Get a key
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <AnimatePresence initial={false}>
            {key && (
              <motion.div
                key="credits"
                initial={false}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-3">
                  {creditsLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2.5 text-caption text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading credits…
                    </div>
                  ) : creditsError ? (
                    <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
                      <p className="text-caption text-destructive">{creditsError}</p>
                      {creditsError.includes("Management key") && (
                        <a
                          href="https://openrouter.ai/settings/keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Create a Management key
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  ) : credits ? (
                    <CreditsGauge credits={credits} />
                  ) : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      {isOllama && (
        <section className="border-t border-border/70 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-sm font-medium">
                <Server className="h-3.5 w-3.5" />
                Ollama Server
              </h2>
              <p className="mt-1 text-xs text-muted-foreground/70 text-wrap-balance">
                Point Focal at a running Ollama instance. Default is <code className="font-mono text-[10px]">http://localhost:11434</code> if Ollama is installed locally.
              </p>
            </div>
            <Button
              type="button"
              onClick={handleHealthcheck}
              disabled={healthStatus.status === "pending"}
              variant="outline"
              size="sm"
            >
              {healthStatus.status === "pending"
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />}
              Test connection
            </Button>
          </div>
          <Input
            id="ollama-base-url"
            type="text"
            value={ollamaBaseUrl}
            onChange={(e) => handleOllamaBaseUrlChange(e.target.value)}
            placeholder="http://localhost:11434"
            className="mt-3 h-9 font-mono text-xs"
            aria-label="Ollama server URL"
          />
          <div className="mt-2 flex items-center justify-end">
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              Install Ollama
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <AnimatePresence initial={false}>
            {healthStatus.status === "ok" && (
              <motion.div
                key="health-ok"
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-caption text-emerald-700 dark:text-emerald-400"
              >
                <Check className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Connected{healthStatus.version ? ` to Ollama ${healthStatus.version}` : ""}.
                  {typeof healthStatus.modelCount === "number"
                    ? ` Found ${healthStatus.modelCount} installed model${healthStatus.modelCount === 1 ? "" : "s"}.`
                    : ""}
                </span>
              </motion.div>
            )}
            {healthStatus.status === "error" && (
              <motion.div
                key="health-err"
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-caption text-destructive"
              >
                <Server className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">{healthStatus.error ?? "Could not reach Ollama."} Make sure the server is running and the URL is reachable from this app.</span>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      <section className="border-t border-border/70 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">AI Model</h2>
            <p className="mt-1 text-xs text-muted-foreground/70 text-wrap-balance">
              {isOpenRouter
                ? "Showing only models that support structured output and file uploads."
                : isChatGPT
                  ? "Models available to the connected ChatGPT account."
                  : "Installed models on the local Ollama server. Use the refresh button to re-query after pulling new models."}
            </p>
          </div>
          {(isOllama || isChatGPT) && (
            <Button
              type="button"
              onClick={handleRefreshModels}
              disabled={modelsLoading}
              variant="outline"
              size="sm"
            >
              {modelsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh
            </Button>
          )}
        </div>
        {isOllama && (
          <div className="mt-3 rounded-lg border border-border/70 bg-background/30 p-2.5">
            <div className="flex gap-2">
              <Input
                value={pullName}
                onChange={(event) => {
                  setPullName(event.target.value)
                  if (pullStatus.status === "error") setPullStatus({ status: "idle" })
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && pullStatus.status !== "pending") void handlePullModel()
                }}
                disabled={pullStatus.status === "pending"}
                placeholder="Model to pull, e.g. qwen3:8b"
                className="h-8 min-w-0 font-mono text-xs"
                aria-label="Ollama model to pull"
              />
              <Button
                type="button"
                variant={pullStatus.status === "pending" ? "outline" : "default"}
                size="sm"
                onClick={() => { void handlePullModel() }}
                className="h-8 shrink-0 gap-1.5"
              >
                {pullStatus.status === "pending"
                  ? <><X className="h-3.5 w-3.5" /> Cancel</>
                  : <><Download className="h-3.5 w-3.5" /> Pull model</>}
              </Button>
            </div>
            <p
              role="status"
              aria-live="polite"
              className={cn(
                "mt-1.5 min-h-4 text-caption",
                pullStatus.status === "error" ? "text-destructive" : "text-muted-foreground/70",
              )}
            >
              {pullStatus.message ?? "Downloads from the Ollama library to this server."}
            </p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {model && models.some((m) => m.id === model) && (
            <motion.div
              key="selected-wrap"
              initial={false}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3">
                <SelectedModelCard key={model} modelId={model} models={models} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {modelsLoading ? (
          <div className="flex items-center gap-2 mt-2 text-caption text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading models…
          </div>
        ) : modelsError ? (
          <div className="mt-2">
            <p className="text-caption text-destructive">{modelsError}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshModels}
              className="mt-1 h-7 text-xs"
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/50" />
              <Input
                placeholder="Search models…"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <ScrollArea className="mt-2 h-56 rounded-lg border border-border/70">
              <div className="p-1">
                {filteredModels.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    {isOllama
                      ? "No installed models. Run `ollama pull <model>` and click refresh."
                      : isChatGPT
                        ? "Connect your ChatGPT account above to load its models."
                        : "No models match your search."}
                  </p>
                ) : (
                  modelRows
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </section>

      <section className="border-t border-border/70 pt-5">
        <div>
          <h2 className="text-sm font-medium">Assistant personality</h2>
          <p className="mt-1 text-xs text-muted-foreground/70 text-wrap-balance">
            Choose how the study assistant communicates. Accuracy and tool rules stay the same.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Assistant personality">
          {ASSISTANT_PERSONALITIES.map((option) => {
            const selected = assistantPersonality === option.id
            return (
              <Button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleAssistantPersonalityChange(option.id)}
                variant={selected ? "default" : "outline"}
                className="h-auto min-w-0 flex-1 basis-36 flex-col items-start px-3 py-2 text-left whitespace-normal"
              >
                <span className="block text-xs font-medium">{option.label}</span>
                <span className={cn("mt-0.5 block text-micro leading-relaxed", selected ? "text-primary-foreground/75" : "text-muted-foreground/70")}>{option.description}</span>
              </Button>
            )
          })}
        </div>
        <label className="mt-4 block text-caption text-muted-foreground/70" htmlFor="assistant-custom-instructions">
          Additional instructions <span className="text-muted-foreground/50">(optional)</span>
        </label>
        <Textarea
          id="assistant-custom-instructions"
          value={assistantCustomInstructions}
          maxLength={500}
          rows={3}
          onChange={(event) => handleAssistantCustomInstructionsChange(event.target.value)}
          onBlur={notifyUserSettingsChanged}
          placeholder="Example: Use Australian English and keep plans under five steps."
          className="mt-1.5 text-xs"
        />
        <p className="mt-1 text-right text-micro tabular-nums text-muted-foreground/60">
          {assistantCustomInstructions.length}/500
        </p>
      </section>

      {activeProvider.supportsReasoning && (
        <section className="border-t border-border/70 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">Reasoning Tokens</h2>
              <p className="mt-1 text-xs text-muted-foreground/70 text-wrap-balance">
                {isChatGPT
                  ? "Choose the reasoning effort sent to ChatGPT's Codex models."
                  : "Enable step-by-step reasoning for supported models (OpenAI o-series, Anthropic Claude, Gemini, DeepSeek R1)."}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setReasoningHelpOpen((v) => !v)}
              variant="ghost"
              size="icon-xs"
              aria-label="What do these levels mean?"
              aria-expanded={reasoningHelpOpen}
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
          </div>
          <AnimatePresence initial={false}>
            {reasoningHelpOpen && (
              <motion.div
                key="help"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <ul className="mt-3 grid gap-1 rounded-lg border border-border/60 bg-background/30 p-2.5 text-caption">
                  {(["xhigh", "high", "medium", "low", "minimal", "none"] as const).map((level) => (
                    <li key={level} className="flex items-baseline gap-2">
                      <span className="w-14 shrink-0 font-medium capitalize text-foreground/80">
                        {level === "xhigh" ? "Max" : level}
                      </span>
                      <span className="text-muted-foreground/80">{REASONING_BLURB[level]}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="mt-3 block text-caption text-muted-foreground/70">Effort Level</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(["xhigh", "high", "medium", "low", "minimal", "none"] as const).map((level) => (
              <Button
                type="button"
                key={level}
                onClick={() => handleReasoningEffortChange(level)}
                aria-pressed={reasoningEffort === level}
                title={REASONING_BLURB[level]}
                variant={reasoningEffort === level ? "default" : "outline"}
                size="sm"
              >
                {level === "xhigh" ? "Max" : level.charAt(0).toUpperCase() + level.slice(1)}
              </Button>
            ))}
          </div>

          {!isChatGPT && reasoningEffort !== "none" && (
            <>
              <label className="mt-3 block text-caption text-muted-foreground/70" htmlFor="reasoning-max-tokens">
                Max Tokens (Anthropic models)
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="reasoning-max-tokens"
                  type="range"
                  min={1024}
                  max={32000}
                  step={1024}
                  value={reasoningMaxTokens}
                  onChange={(e) => handleReasoningMaxTokensChange(Number(e.target.value))}
                  className="flex-1 accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                  {reasoningMaxTokens >= 1000 ? `${(reasoningMaxTokens / 1000).toFixed(1)}k` : reasoningMaxTokens}
                </span>
              </div>

              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/70 bg-background/30 p-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 hover:border-muted-foreground/30">
                <Checkbox
                  checked={reasoningExclude}
                  onCheckedChange={(checked) => handleReasoningExcludeChange(checked === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <p className="text-sm">Exclude reasoning from response</p>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">
                    Model still uses reasoning internally but will not include it in output.
                  </p>
                </div>
              </label>
            </>
          )}
        </section>
      )}
    </div>
  )
}
