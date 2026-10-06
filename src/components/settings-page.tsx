import "./settings-page.css"
import { createChatGPTProvider, useChatGPT, type ChatGPTModel } from "../lib/chatgpt-client"
import { ChatGPTConnection } from "./chatgpt-connection"
import { AI_ENABLED } from "../lib/host"
import { useEffect, useState, type ReactNode } from "react"
import { Download, ArrowDown, ArrowUp, BookOpen, CheckCircle2, Cloud, LogOut, Plus, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, Trash2, UserRound, X } from "lucide-react"
import { PageHeader } from "./page-header"
import { SubjectCombobox } from "./subject-combobox"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Field, FieldDescription, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Progress } from "./ui/progress"
import { updateActions, useUpdateState } from "../lib/update-store"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import {
  loadAISettings,
  saveAISettings,
  type AISettings,
  type ReasoningEffort,
} from "../lib/ai-settings"
import type { useSupabaseSync } from "../lib/sync"
import { DEFAULT_PROVIDER_DIFFICULTY, MATHEMATICS_PROVIDER_DIFFICULTY, resolveDifficultySettings, type ExamDifficultySettings } from "../lib/exam-difficulty"

const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
}

const REASONING_OPTIONS = ["low", "medium", "high", "xhigh"] as const

function getModelAccent(model: string) {
  if (model.endsWith("-sol")) return "var(--chart-5)"
  if (model.endsWith("-luna")) return "var(--chart-3)"
  return "var(--chart-2)"
}
export function SettingsPage({ sync, subjects, selectedSubjects, providers, examDifficulty, onSubjectsChange, onExamDifficultyChange }: {
  sync: ReturnType<typeof useSupabaseSync>
  subjects: string[]
  selectedSubjects: string[]
  providers: string[]
  examDifficulty?: ExamDifficultySettings
  onSubjectsChange: (subjects: string[]) => void
  onExamDifficultyChange: (settings: ExamDifficultySettings) => void
}) {
  const auth = useChatGPT()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountMessage, setAccountMessage] = useState<string | null>(null)
  const [settings, setSettings] = useState<AISettings>(() => loadAISettings())
  const [models, setModels] = useState<ChatGPTModel[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [subjectToAdd, setSubjectToAdd] = useState("")
  const [customSubject, setCustomSubject] = useState("")
  const [providerToAdd, setProviderToAdd] = useState("")
  const [section, setSection] = useState<string>("subjects")
  const difficulty = resolveDifficultySettings(examDifficulty)

  function updateDifficulty(changes: Partial<ExamDifficultySettings>) {
    onExamDifficultyChange({ ...difficulty, ...changes, updatedAt: new Date().toISOString() })
  }

  function update(next: AISettings) {
    setSettings(next)
    saveAISettings(next)
  }

  async function refreshModels() {
    setLoadingModels(true)
    setModelError(null)
    try {
      setModels(await createChatGPTProvider().listModelCatalog())
    } catch {
      setModels([])
      setModelError("Could not load models for this account.")
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    if (auth.isAuthenticated) void refreshModels()
    else setModels([])
  }, [auth.isAuthenticated])

  const selectedModel = models.some((model) => model.slug === settings.model) ? settings.model : models[0]?.slug
  const selectedEffort = settings.reasoningEffort === "none" ? "low" : settings.reasoningEffort
  const fillPercent = ((REASONING_OPTIONS.indexOf(selectedEffort) + 0.5) / REASONING_OPTIONS.length) * 100

  const sections = [
    { id: "subjects", label: "Subjects", icon: BookOpen },
    { id: "difficulty", label: "Difficulty", icon: SlidersHorizontal },
    { id: "account", label: "Account", icon: UserRound },
    ...(AI_ENABLED ? [{ id: "ai", label: "AI", icon: Sparkles }, { id: "updates", label: "Updates", icon: Download }] : []),
  ] as const
  const active = sections.some((item) => item.id === section) ? section : "subjects"

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" description={AI_ENABLED ? "Subjects, difficulty calibration, sync, and AI analysis." : "Subjects, difficulty calibration, and sync."} />

      <div className="grid gap-6 md:grid-cols-[11rem_minmax(0,1fr)] md:items-start lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 md:sticky md:top-4 md:mx-0 md:flex-col md:px-0">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={active === id ? "page" : undefined}
              onClick={() => setSection(id)}
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
            >
              <Icon className="size-4" />{label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {active === "subjects" ? (
            <Section title="Subjects" description="Your first subject is the default. Selected subjects appear first and bold in subject searches.">
              <div className="grid gap-2 py-4 sm:grid-cols-2">
                <SubjectCombobox
                  subjects={subjects.filter((subject) => !selectedSubjects.includes(subject))}
                  preferredSubjects={[]}
                  value={subjectToAdd}
                  onValueChange={(subject) => {
                    if (!subject) return
                    onSubjectsChange([...selectedSubjects, subject])
                    setSubjectToAdd("")
                  }}
                  className="w-full"
                  placeholder="Search and add a subject"
                />
                <form className="flex w-full gap-2" onSubmit={(event) => {
                  event.preventDefault()
                  const next = customSubject.trim()
                  if (!next || selectedSubjects.some((subject) => subject.toLowerCase() === next.toLowerCase())) return
                  onSubjectsChange([...selectedSubjects, next])
                  setCustomSubject("")
                }}>
                  <Input value={customSubject} onChange={(event) => setCustomSubject(event.target.value)} placeholder="Or add a custom subject" aria-label="Custom subject name" />
                  <Button type="submit" variant="outline" disabled={!customSubject.trim()}><Plus />Add</Button>
                </form>
              </div>
              {selectedSubjects.length ? (
                <ol className="divide-y">
                  {selectedSubjects.map((subject, index) => (
                    <li key={subject} className="flex items-center gap-2 py-2">
                      <span className="w-6 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{subject}</span>
                      {index === 0 ? <Badge variant="secondary">Default</Badge> : null}
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${subject} up`} disabled={index === 0} onClick={() => {
                        const next = [...selectedSubjects]
                        ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                        onSubjectsChange(next)
                      }}><ArrowUp /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${subject} down`} disabled={index === selectedSubjects.length - 1} onClick={() => {
                        const next = [...selectedSubjects]
                        ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                        onSubjectsChange(next)
                      }}><ArrowDown /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${subject}`} onClick={() => onSubjectsChange(selectedSubjects.filter((item) => item !== subject))}><X /></Button>
                    </li>
                  ))}
                </ol>
              ) : <p className="py-4 text-sm text-muted-foreground">Add your subjects in priority order.</p>}
            </Section>
          ) : null}

          {active === "difficulty" ? (
            <Section
              title="Difficulty calibration"
              description="Order the providers you use from hardest to easiest. VCAA is the zero-adjustment baseline."
              action={<Button type="button" size="sm" variant={difficulty.enabled ? "default" : "outline"} aria-pressed={difficulty.enabled} onClick={() => updateDifficulty({ enabled: !difficulty.enabled })}>{difficulty.enabled ? "Enabled" : "Disabled"}</Button>}
            >
              <Row title="Adjustment strength" description="Adjustments are capped at ±8 points. VCAA stays unchanged.">
                <Select items={{ light: "Light · 1 point per rank", balanced: "Balanced · 1.5 points per rank", strong: "Strong · 2 points per rank" }} value={difficulty.strength} onValueChange={(value) => updateDifficulty({ strength: (value ?? "balanced") as ExamDifficultySettings["strength"] })} disabled={!difficulty.enabled}>
                  <SelectTrigger aria-label="Adjustment strength" className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light · 1 point per rank</SelectItem>
                    <SelectItem value="balanced">Balanced · 1.5 points per rank</SelectItem>
                    <SelectItem value="strong">Strong · 2 points per rank</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row title="Presets" description="Replace the order with a starting point.">
                <Button type="button" variant="outline" disabled={!difficulty.enabled || difficulty.providerOrder.join("|") === DEFAULT_PROVIDER_DIFFICULTY.join("|")} onClick={() => updateDifficulty({ providerOrder: [...DEFAULT_PROVIDER_DIFFICULTY] })}><RotateCcw />Broad</Button>
                <Button type="button" variant="outline" disabled={!difficulty.enabled || difficulty.providerOrder.join("|") === MATHEMATICS_PROVIDER_DIFFICULTY.join("|")} onClick={() => updateDifficulty({ providerOrder: [...MATHEMATICS_PROVIDER_DIFFICULTY] })}>Mathematics</Button>
              </Row>
              <form className="flex w-full gap-2 py-4" onSubmit={(event) => {
                event.preventDefault()
                const next = providerToAdd.trim()
                if (!next || difficulty.providerOrder.some((provider) => provider.toLowerCase() === next.toLowerCase())) return
                const baselineIndex = difficulty.providerOrder.indexOf("VCAA")
                const providerOrder = [...difficulty.providerOrder]
                providerOrder.splice(baselineIndex < 0 ? providerOrder.length : baselineIndex, 0, next)
                updateDifficulty({ providerOrder })
                setProviderToAdd("")
              }}>
                <Input list="known-exam-providers" value={providerToAdd} onChange={(event) => setProviderToAdd(event.target.value)} placeholder="Add a school or exam provider" aria-label="Exam provider name" disabled={!difficulty.enabled} />
                <datalist id="known-exam-providers">{providers.filter((provider) => !difficulty.providerOrder.some((item) => item.toLowerCase() === provider.toLowerCase())).map((provider) => <option key={provider} value={provider} />)}</datalist>
                <Button type="submit" variant="outline" disabled={!difficulty.enabled || !providerToAdd.trim()}><Plus />Add</Button>
              </form>
              <ol className="divide-y border-t">
                {difficulty.providerOrder.map((provider, index) => {
                  const vcaaIndex = difficulty.providerOrder.indexOf("VCAA")
                  const adjustment = Math.max(-8, Math.min(8, (vcaaIndex - index) * ({ light: 1, balanced: 1.5, strong: 2 }[difficulty.strength])))
                  return (
                    <li key={provider} className="flex items-center gap-2 py-2">
                      <span className="w-6 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{provider}</span>
                      <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{adjustment === 0 ? "baseline" : `${adjustment > 0 ? "+" : ""}${adjustment} pts`}</span>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${provider} up`} disabled={!difficulty.enabled || index === 0} onClick={() => {
                        const providerOrder = [...difficulty.providerOrder]
                        ;[providerOrder[index - 1], providerOrder[index]] = [providerOrder[index], providerOrder[index - 1]]
                        updateDifficulty({ providerOrder })
                      }}><ArrowUp /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${provider} down`} disabled={!difficulty.enabled || index === difficulty.providerOrder.length - 1} onClick={() => {
                        const providerOrder = [...difficulty.providerOrder]
                        ;[providerOrder[index], providerOrder[index + 1]] = [providerOrder[index + 1], providerOrder[index]]
                        updateDifficulty({ providerOrder })
                      }}><ArrowDown /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${provider}`} disabled={!difficulty.enabled || provider === "VCAA"} onClick={() => updateDifficulty({ providerOrder: difficulty.providerOrder.filter((item) => item !== provider) })}><Trash2 /></Button>
                    </li>
                  )
                })}
              </ol>
              <p className="max-w-[68ch] border-t pt-4 text-xs leading-5 text-muted-foreground text-pretty">The starter order is only a broad guide. Paper difficulty varies by subject and year, so remove irrelevant providers and reorder the ones you use. Non-VCAA papers receive less influence the further they sit from the baseline. This is a planning estimate, not an official conversion.</p>
            </Section>
          ) : null}

          {active === "account" ? (
            <Section
              title="Account"
              description="Sign in to sync exams, SACs, and mistakes across devices."
              action={sync.user ? <Badge variant="secondary"><Cloud />{sync.status === "syncing" ? "Syncing" : sync.status === "error" ? "Sync failed" : "Synced"}</Badge> : null}
            >
              {!sync.configured ? (
                <p className="py-4 text-sm text-muted-foreground">Add the Supabase URL and publishable key to enable account sync.</p>
              ) : sync.user ? (
                <Row title={sync.user.email ?? "Signed in"} description="Local changes continue saving if sync is temporarily unavailable.">
                  <Button variant="outline" onClick={() => void sync.signOut()}><LogOut />Sign out</Button>
                </Row>
              ) : (
                <form className="grid max-w-md gap-3 py-4" onSubmit={async (event) => {
                  event.preventDefault()
                  setAccountLoading(true)
                  setAccountMessage(null)
                  try {
                    await sync.signIn(email, password)
                  } catch (error) {
                    setAccountMessage(error instanceof Error ? error.message : "Could not sign in.")
                  } finally {
                    setAccountLoading(false)
                  }
                }}>
                  <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" aria-label="Email address" required />
                  <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" aria-label="Password" minLength={8} required />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={accountLoading}><Cloud />Sign in</Button>
                    <Button type="button" variant="outline" disabled={accountLoading} onClick={async (event) => {
                      if (!event.currentTarget.form?.reportValidity()) return
                      setAccountLoading(true)
                      setAccountMessage(null)
                      try {
                        const signedIn = await sync.signUp(email, password)
                        if (!signedIn) setAccountMessage("Disable Confirm email in Supabase Auth settings to create accounts without callbacks.")
                      } catch (error) {
                        setAccountMessage(error instanceof Error ? error.message : "Could not create the account.")
                      } finally {
                        setAccountLoading(false)
                      }
                    }}>Create account</Button>
                  </div>
                </form>
              )}
              {accountMessage ? <p role="status" className="pb-4 text-sm text-muted-foreground">{accountMessage}</p> : null}
            </Section>
          ) : null}

          {active === "updates" && AI_ENABLED ? <UpdatesSection /> : null}

          {active === "ai" && AI_ENABLED ? (
            <Section title="AI" description="AI requests use the connected account's ChatGPT plan." action={auth.isAuthenticated ? <Badge variant="secondary"><CheckCircle2 />Connected</Badge> : null}>
              <div className="py-4"><ChatGPTConnection /></div>
              <div className="grid gap-3 border-t py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">Analysis</h3>
                    <p className="text-sm text-muted-foreground">Applies the next time you use Fill with AI.</p>
                  </div>
                  {auth.isAuthenticated ? <Button size="sm" variant="ghost" disabled={loadingModels} onClick={() => void refreshModels()}><RefreshCw className={loadingModels ? "animate-spin" : ""} />Refresh</Button> : null}
                </div>
          <Field>
            <FieldLabel>Model and reasoning</FieldLabel>
            <div className="select-none overflow-x-auto pb-1">
              <div className="grid min-w-[38rem] grid-cols-[minmax(10rem,1fr)_minmax(22rem,4fr)] items-center">
                <span />
                <div className="grid grid-cols-4 pb-2">
                  {REASONING_OPTIONS.map((effort) => (
                    <span key={effort} className="px-2 text-center text-sm text-muted-foreground">{REASONING_LABELS[effort]}</span>
                  ))}
                </div>
                <div className="grid py-1">
                  {models.map(({ slug: model, displayName }) => {
                    const selected = model === selectedModel
                    const accent = getModelAccent(model)
                    return (
                      <button
                        key={model}
                        type="button"
                        aria-pressed={selected}
                        title={`${displayName} (${model})`}
                        className="h-12 truncate rounded-md px-2 text-left text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                        style={{ color: selected ? accent : undefined, fontWeight: selected ? 700 : undefined }}
                        onClick={() => update({ model, reasoningEffort: selectedEffort })}
                      >
                        {displayName}
                      </button>
                    )
                  })}
                </div>
                <div className="grid rounded-xl bg-muted/80 p-1 ring-1 ring-border/60">
                {models.map(({ slug: model, displayName }) => {
                  const selected = model === selectedModel
                  const accent = getModelAccent(model)
                  return (
                    <div key={model} className="relative grid h-12 grid-cols-4 items-center">
                        <span
                          aria-hidden="true"
                          className={`absolute inset-y-1 left-0 rounded-full transition-[width,opacity] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${selected ? "opacity-100" : "opacity-0"}`}
                          style={{ backgroundColor: accent, width: selected ? `${fillPercent}%` : 0 }}
                        />
                        {REASONING_OPTIONS.map((effort) => (
                          <span key={effort} aria-hidden="true" className={`relative z-10 mx-auto size-2 rounded-full transition-colors duration-200 motion-reduce:transition-none ${selected ? "bg-black/55" : "bg-muted-foreground/35"}`} />
                        ))}
                        <input
                          type="range"
                          min={0}
                          max={REASONING_OPTIONS.length - 1}
                          step={1}
                          value={REASONING_OPTIONS.indexOf(selectedEffort)}
                          data-selected={selected}
                          aria-label={`${displayName} reasoning level`}
                          aria-valuetext={REASONING_LABELS[selectedEffort]}
                          className="model-reasoning-slider z-20"
                          style={{ "--slider-accent": accent } as React.CSSProperties}
                          onPointerDown={() => {
                            if (!selected) update({ model, reasoningEffort: selectedEffort })
                          }}
                          onChange={(event) => update({ model, reasoningEffort: REASONING_OPTIONS[Number(event.currentTarget.value)] })}
                        />
                    </div>
                  )
                })}
                </div>
              </div>
            </div>
            <FieldDescription>Choose a model and reasoning level together. Higher reasoning can take longer. Saved on this device.</FieldDescription>
            {modelError ? <p role="alert" className="text-sm text-destructive">{modelError}</p> : null}
          </Field>
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Section({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <header className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground text-pretty">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

function Row({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

const formatBytes = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

function UpdatesSection() {
  const update = useUpdateState()
  const busy = update.status === "checking" || update.status === "downloading" || update.status === "installing"
  const percent = update.total ? Math.min(100, (update.downloaded / update.total) * 100) : null
  const description = {
    idle: "Check GitHub for a newer version of Focal.",
    checking: "Checking for updates…",
    uptodate: "Focal is up to date.",
    available: `Version ${update.version} is available.`,
    downloading: `Downloading version ${update.version}…`,
    ready: `Version ${update.version} is downloaded and ready to install.`,
    installing: "Installing and restarting…",
    error: update.error ?? "Update failed.",
  }[update.status]
  return (
    <Section title="Updates" description="Updates are downloaded in the background; you choose when to restart.">
      <Row title="Focal" description={description}>
        {update.status === "available" ? <Button size="sm" onClick={() => void updateActions.download?.()}><Download />Download</Button> : null}
        {update.status === "ready" ? <Button size="sm" onClick={() => void updateActions.install?.()}>Install and restart</Button> : null}
        <Button size="sm" variant="ghost" disabled={busy || update.status === "ready"} onClick={() => void updateActions.check?.()}>
          <RefreshCw className={update.status === "checking" ? "animate-spin" : ""} />Check for updates
        </Button>
      </Row>
      {update.status === "downloading" ? (
        <div className="grid gap-2 py-4">
          <Progress value={percent} />
          <p className="text-sm tabular-nums text-muted-foreground">
            {formatBytes(update.downloaded)}{update.total ? ` of ${formatBytes(update.total)}` : ""}{percent === null ? "" : ` · ${Math.round(percent)}%`}{update.speed ? ` · ${formatBytes(update.speed)}/s` : ""}
          </p>
        </div>
      ) : null}
    </Section>
  )
}
