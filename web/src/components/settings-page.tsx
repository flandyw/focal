import { useEffect, useState } from "react"
import { createChatGPTProxyProvider } from "@opencoredev/loginwithchatgpt-ai"
import { useLoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react"
import { ArrowDown, ArrowUp, CheckCircle2, Cloud, Copy, ExternalLink, LogOut, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, X } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { SubjectCombobox } from "@/components/subject-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  loadAISettings,
  saveAISettings,
  supportsStreamedAnalysis,
  type AISettings,
  type ReasoningEffort,
} from "@/lib/ai-settings"
import type { useSupabaseSync } from "@/lib/sync"
import type { useFocalAccount } from "@/hooks/use-focal-account"
import { DEFAULT_PROVIDER_DIFFICULTY, MATHEMATICS_PROVIDER_DIFFICULTY, resolveDifficultySettings, type ExamDifficultySettings } from "@/lib/exam-difficulty"

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
export function SettingsPage({ sync, focal, subjects, selectedSubjects, providers, examDifficulty, onSubjectsChange, onExamDifficultyChange }: {
  sync: ReturnType<typeof useSupabaseSync>
  focal: ReturnType<typeof useFocalAccount>
  subjects: string[]
  selectedSubjects: string[]
  providers: string[]
  examDifficulty?: ExamDifficultySettings
  onSubjectsChange: (subjects: string[]) => void
  onExamDifficultyChange: (settings: ExamDifficultySettings) => void
}) {
  const auth = useLoginWithChatGPT()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountMessage, setAccountMessage] = useState<string | null>(null)
  const [focalEmail, setFocalEmail] = useState("")
  const [focalPassword, setFocalPassword] = useState("")
  const [focalMessage, setFocalMessage] = useState<string | null>(null)
  const [settings, setSettings] = useState<AISettings>(() => loadAISettings())
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [subjectToAdd, setSubjectToAdd] = useState("")
  const [customSubject, setCustomSubject] = useState("")
  const [providerToAdd, setProviderToAdd] = useState("")
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
      setModels(await createChatGPTProxyProvider().listModels())
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

  const identity = auth.user?.name ?? auth.user?.email ?? "ChatGPT account"
  const modelOptions = models.filter(supportsStreamedAnalysis)
  const selectedModel = modelOptions.includes(settings.model) ? settings.model : modelOptions[0]
  const selectedEffort = settings.reasoningEffort === "none" ? "low" : settings.reasoningEffort
  const fillPercent = ((REASONING_OPTIONS.indexOf(selectedEffort) + 0.5) / REASONING_OPTIONS.length) * 100

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" description="Manage sync, the ChatGPT connection, and mistake analysis." />

      <Card>
        <CardHeader>
          <CardTitle>My subjects</CardTitle>
          <CardDescription>Your first subject is the default. Selected subjects appear first and bold in subject searches.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <SubjectCombobox
            subjects={subjects.filter((subject) => !selectedSubjects.includes(subject))}
            preferredSubjects={[]}
            value={subjectToAdd}
            onValueChange={(subject) => {
              if (!subject) return
              onSubjectsChange([...selectedSubjects, subject])
              setSubjectToAdd("")
            }}
            className="w-full max-w-md"
            placeholder="Search and add a subject"
          />
          <form className="flex w-full max-w-md gap-2" onSubmit={(event) => {
            event.preventDefault()
            const next = customSubject.trim()
            if (!next || selectedSubjects.some((subject) => subject.toLowerCase() === next.toLowerCase())) return
            onSubjectsChange([...selectedSubjects, next])
            setCustomSubject("")
          }}>
            <Input value={customSubject} onChange={(event) => setCustomSubject(event.target.value)} placeholder="Add a custom subject" aria-label="Custom subject name" />
            <Button type="submit" variant="outline" disabled={!customSubject.trim()}><Plus />Add</Button>
          </form>
          {selectedSubjects.length ? (
            <ol className="grid max-w-xl gap-2">
              {selectedSubjects.map((subject, index) => (
                <li key={subject} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="w-6 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
                  <strong className="min-w-0 flex-1 truncate text-sm">{subject}</strong>
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
          ) : <p className="text-sm text-muted-foreground">Add your subjects in priority order.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Focal timer connection</CardTitle>
          <CardDescription>Connect your separate Focal account to mirror only exam and SAC timer activity.</CardDescription>
          {focal.user ? <CardAction><Badge variant="secondary"><CheckCircle2 />Connected</Badge></CardAction> : null}
        </CardHeader>
        <CardContent>
          {!focal.configured ? (
            <p className="text-sm text-muted-foreground">Add Focal's Supabase URL and publishable key to the ExamTrack deployment. No ExamTrack database migration is required.</p>
          ) : focal.user ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-medium">{focal.user.email}</p><p className="text-sm text-muted-foreground">Authenticated directly with Focal; its row-level security owns every timer write.</p></div>
              <Button variant="outline" disabled={focal.loading} onClick={() => void focal.signOut()}><LogOut />Disconnect</Button>
            </div>
          ) : (
            <form className="grid max-w-md gap-3" onSubmit={async (event) => {
              event.preventDefault()
              setFocalMessage(null)
              try {
                await focal.signIn(focalEmail, focalPassword)
                setFocalPassword("")
              } catch (error) {
                setFocalMessage(error instanceof Error ? error.message : "Could not connect Focal.")
              }
            }}>
              <Input type="email" value={focalEmail} onChange={(event) => setFocalEmail(event.target.value)} placeholder="Focal email" aria-label="Focal email address" autoComplete="username" required />
              <Input type="password" value={focalPassword} onChange={(event) => setFocalPassword(event.target.value)} placeholder="Focal password" aria-label="Focal password" autoComplete="current-password" minLength={8} required />
              <div><Button type="submit" disabled={focal.loading}><Cloud />{focal.loading ? "Connecting…" : "Connect Focal"}</Button></div>
            </form>
          )}
          {focalMessage ? <p role="status" className="mt-3 text-sm text-muted-foreground">{focalMessage}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider difficulty calibration</CardTitle>
          <CardDescription>Order the providers you use from hardest to easiest. VCAA is the zero-adjustment baseline; tailor the list to your subjects.</CardDescription>
          <CardAction>
            <Button type="button" size="sm" variant={difficulty.enabled ? "default" : "outline"} aria-pressed={difficulty.enabled} onClick={() => updateDifficulty({ enabled: !difficulty.enabled })}>
              {difficulty.enabled ? "Enabled" : "Disabled"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field className="w-full max-w-xs">
              <FieldLabel htmlFor="difficulty-strength">Adjustment strength</FieldLabel>
              <Select value={difficulty.strength} onValueChange={(value) => updateDifficulty({ strength: (value ?? "balanced") as ExamDifficultySettings["strength"] })} disabled={!difficulty.enabled}>
                <SelectTrigger id="difficulty-strength" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light · 1 point per rank</SelectItem>
                  <SelectItem value="balanced">Balanced · 1.5 points per rank</SelectItem>
                  <SelectItem value="strong">Strong · 2 points per rank</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>Adjustments are capped at ±8 points. VCAA stays unchanged.</FieldDescription>
            </Field>
            <Button type="button" variant="outline" disabled={difficulty.providerOrder.join("|") === DEFAULT_PROVIDER_DIFFICULTY.join("|")} onClick={() => updateDifficulty({ providerOrder: [...DEFAULT_PROVIDER_DIFFICULTY] })}>
              <RotateCcw />Broad preset
            </Button>
            <Button type="button" variant="outline" disabled={difficulty.providerOrder.join("|") === MATHEMATICS_PROVIDER_DIFFICULTY.join("|")} onClick={() => updateDifficulty({ providerOrder: [...MATHEMATICS_PROVIDER_DIFFICULTY] })}>Mathematics preset</Button>
          </div>
          <form className="flex w-full max-w-xl gap-2" onSubmit={(event) => {
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
          <ol className="grid max-w-xl gap-2">
            {difficulty.providerOrder.map((provider, index) => {
              const vcaaIndex = difficulty.providerOrder.indexOf("VCAA")
              const adjustment = Math.max(-8, Math.min(8, (vcaaIndex - index) * ({ light: 1, balanced: 1.5, strong: 2 }[difficulty.strength])))
              return (
                <li key={provider} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="w-6 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
                  <strong className="min-w-0 flex-1 truncate text-sm">{provider}</strong>
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
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">The starter order is only a broad guide. Paper difficulty varies by subject and year, so remove irrelevant providers and reorder the ones you use. Non-VCAA papers receive less influence the further they sit from the baseline. This is a planning estimate, not an official conversion.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ExamTrack account</CardTitle>
          <CardDescription>Sign in with your email and password to sync exams, SACs, and mistakes across devices.</CardDescription>
          {sync.user ? <CardAction><Badge variant="secondary"><Cloud />{sync.status === "syncing" ? "Syncing" : sync.status === "error" ? "Sync failed" : "Synced"}</Badge></CardAction> : null}
        </CardHeader>
        <CardContent>
          {!sync.configured ? (
            <p className="text-sm text-muted-foreground">Add the Supabase URL and publishable key to enable account sync.</p>
          ) : sync.user ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-medium">{sync.user.email}</p><p className="text-sm text-muted-foreground">Local changes continue saving if sync is temporarily unavailable.</p></div>
              <Button variant="outline" onClick={() => void sync.signOut()}><LogOut />Sign out</Button>
            </div>
          ) : (
            <form className="grid max-w-md gap-3" onSubmit={async (event) => {
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
          {accountMessage ? <p role="status" className="mt-3 text-sm text-muted-foreground">{accountMessage}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ChatGPT connection</CardTitle>
          <CardDescription>AI requests use the connected account's ChatGPT plan.</CardDescription>
          <CardAction>
            {auth.isAuthenticated ? <Badge variant="secondary"><CheckCircle2 />Connected</Badge> : null}
          </CardAction>
        </CardHeader>
        <CardContent>
          {auth.status === "loading" ? <Skeleton className="h-16 w-full" /> : null}

          {auth.isAuthenticated ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{identity}</p>
                <p className="text-sm text-muted-foreground">
                  {auth.user?.email && auth.user.email !== identity ? auth.user.email : "Ready for mistake analysis"}
                  {auth.user?.plan ? ` · ${auth.user.plan} plan` : ""}
                </p>
              </div>
              <Button variant="outline" onClick={() => void auth.logout()}><LogOut />Disconnect</Button>
            </div>
          ) : null}

          {auth.status === "pending" ? (
            <div className="grid gap-3">
              <p className="text-sm">Enter code <strong className="font-mono">{auth.userCode}</strong> in the ChatGPT authorization window.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void auth.copyCode()}><Copy />{auth.copied ? "Copied" : "Copy code"}</Button>
                <Button variant="outline" render={<a href={auth.verificationUrl} target="_blank" rel="noopener noreferrer" />}><ExternalLink />Reopen authorization</Button>
              </div>
            </div>
          ) : null}

          {auth.status !== "loading" && !auth.isAuthenticated && auth.status !== "pending" ? (
            <div className="grid gap-4">
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Connecting lets ExamTrack spend from your ChatGPT plan for AI requests. Prompts and mistake photos pass through this server; ExamTrack never receives your password. Disconnecting deletes the server session.
              </p>
              <div>
                <Button disabled={auth.isConnecting} onClick={() => void auth.login({ popup: window.open("about:blank", "_blank") })}>
                  <Sparkles />{auth.isConnecting ? "Connecting…" : "I understand, connect ChatGPT"}
                </Button>
              </div>
              {auth.error ? <p role="alert" className="text-sm text-destructive">{auth.error}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Analysis</CardTitle>
          <CardDescription>These preferences apply the next time you use Fill with AI.</CardDescription>
          {auth.isAuthenticated ? <CardAction><Button size="sm" variant="ghost" disabled={loadingModels} onClick={() => void refreshModels()}><RefreshCw className={loadingModels ? "animate-spin" : ""} />Refresh</Button></CardAction> : null}
        </CardHeader>
        <CardContent>
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
                  {modelOptions.map((model) => {
                    const selected = model === selectedModel
                    const accent = getModelAccent(model)
                    return (
                      <button
                        key={model}
                        type="button"
                        aria-pressed={selected}
                        className="h-12 truncate rounded-md px-2 text-left text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                        style={{ color: selected ? accent : undefined, fontWeight: selected ? 700 : undefined }}
                        onClick={() => update({ model, reasoningEffort: selectedEffort })}
                      >
                        {model === "auto" ? "Automatic" : model}
                      </button>
                    )
                  })}
                </div>
                <div className="grid rounded-xl bg-muted/80 p-1 ring-1 ring-border/60">
                {modelOptions.map((model) => {
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
                          aria-label={`${model === "auto" ? "Automatic" : model} reasoning level`}
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
        </CardContent>
      </Card>
    </div>
  )
}
