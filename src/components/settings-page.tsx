import "./settings-page.css"
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Bell, BookOpen, ChevronLeft, ChevronRight, Cloud, Compass, Database, Download, Eye, EyeOff, LogOut, Plus, RefreshCw, RotateCcw, SlidersHorizontal, Smartphone, Sparkles, Sun, Trash2, Upload, UserRound, X, type LucideIcon } from "lucide-react"
import { sameStudySubject } from "../lib/studySubjects"
import { validCompletionYear } from "@/lib/subject-completion"
import { createChatGPTProvider, useChatGPT, type ChatGPTModel } from "../lib/chatgpt-client"
import { AI_ENABLED } from "../lib/host"
import { canPromptInstall, onInstallChange, promptInstall } from "../lib/pwa"
import { updateActions, useUpdateState } from "../lib/update-store"
import { loadAISettings, saveAISettings, type AISettings, type ReasoningEffort } from "../lib/ai-settings"
import type { useSupabaseSync } from "../lib/sync"
import { DEFAULT_PROVIDER_DIFFICULTY, MATHEMATICS_PROVIDER_DIFFICULTY, resolveDifficultySettings, type ExamDifficultySettings } from "../lib/exam-difficulty"
import { ChatGPTConnection } from "./chatgpt-connection"
import { McpTokens } from "./mcp-tokens"
import { GatewaySettings } from "./gateway-settings"
import { AIOverviewSettings } from "./ai-overview-settings"
import { AppearanceSettings } from "./appearance-settings"
import { PushSettings } from "./push-settings"
import { PageHeader } from "./page-header"
import { SubjectCombobox } from "./subject-combobox"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Checkbox } from "./ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Progress } from "./ui/progress"
import { Switch } from "./ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { VortexAngularSpinLoader } from "./ui/vortex-angular-spin-loader"

type SectionId = "account" | "subjects" | "difficulty" | "notifications" | "appearance" | "ai" | "app" | "updates" | "data"

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly ReasoningEffort[]
const EFFORT_LABELS: Record<(typeof EFFORTS)[number], string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }
const STRENGTHS = { light: ["Light", 1], balanced: ["Balanced", 1.5], strong: ["Strong", 2] } as const

export function SettingsPage({ sync, subjects, selectedSubjects, completedSubjects, subjectCompletionYears, onSubjectCompletion, onCompleteYear, providers, examDifficulty, onSubjectsChange, onExamDifficultyChange, onExport, onImport, onReplayOnboarding, onStartTour, initialSection, recovery }: {
  recovery: ReactNode
  initialSection?: "ai" | "account"
  sync: ReturnType<typeof useSupabaseSync>
  subjects: string[]
  selectedSubjects: string[]
  completedSubjects: string[]
  subjectCompletionYears: Record<string, number>
  onSubjectCompletion: (subject: string, year: number | null) => void
  onCompleteYear: (year: number, subjects: string[]) => void
  providers: string[]
  examDifficulty?: ExamDifficultySettings
  onSubjectsChange: (subjects: string[]) => void
  onExamDifficultyChange: (settings: ExamDifficultySettings) => void
  onExport: () => void
  onImport: (file: File) => Promise<void>
  onReplayOnboarding: () => void
  onStartTour: () => void
}) {
  const { theme } = useTheme()
  const chatgpt = useChatGPT()
  const update = useUpdateState()
  const signedIn = Boolean(sync.user) && sync.status !== "sign-in-required"
  // null shows the overview list on phones; wider screens always show a section beside it.
  const [open, setOpen] = useState<SectionId | null>(initialSection ?? (sync.configured && !signedIn ? "account" : null))
  const difficulty = resolveDifficultySettings(examDifficulty)
  const current = selectedSubjects.filter((subject) => !completedSubjects.some((name) => sameStudySubject(name, subject)))
  const syncLabel = sync.status === "synced" ? "Synced" : sync.status === "syncing" ? "Syncing"
    : sync.status === "sign-in-required" ? "Sign in again" : sync.status === "reconnecting" || sync.status === "restoring" ? "Reconnecting"
    : sync.status === "pending" ? sync.pendingCount ? `${sync.pendingCount} queued` : "Sync pending" : "Sync failed"

  const sections: { id: SectionId; group: string; label: string; icon: LucideIcon; summary: string }[] = [
    { id: "account", group: "You", label: "Account", icon: UserRound, summary: !sync.configured ? "Saved on this device" : signedIn ? syncLabel : "Not signed in" },
    { id: "notifications", group: "You", label: "Notifications", icon: Bell, summary: "Reminders and timer alerts" },
    { id: "subjects", group: "Study", label: "Subjects", icon: BookOpen, summary: current.length ? `${current.length} current · ${current[0]} first` : "None added" },
    { id: "difficulty", group: "Study", label: "Difficulty calibration", icon: SlidersHorizontal, summary: difficulty.enabled ? `${STRENGTHS[difficulty.strength][0]} · ${difficulty.providerOrder.length} providers` : "Off" },
    { id: "appearance", group: "App", label: "Appearance", icon: Sun, summary: theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Follows system" },
    { id: "ai", group: "App", label: "AI", icon: Sparkles, summary: AI_ENABLED && chatgpt.isAuthenticated ? "ChatGPT connected" : "Study chat and overviews" },
    ...(!import.meta.env.VITE_DESKTOP ? [{ id: "app" as const, group: "App", label: "Phone app", icon: Smartphone, summary: "Add Focal to your Home Screen" }] : []),
    ...(AI_ENABLED ? [{ id: "updates" as const, group: "App", label: "Updates", icon: Download, summary: update.status === "available" || update.status === "ready" ? `Version ${update.version} available` : `Version ${import.meta.env.VITE_APP_VERSION}` }] : []),
    { id: "data", group: "Data", label: "Backup and recovery", icon: Database, summary: "Export, import, restore" },
  ]
  const active: SectionId = sync.passwordRecovery ? "account" : sections.find((item) => item.id === open)?.id ?? (sync.configured && !signedIn ? "account" : "subjects")
  const showDetail = Boolean(open || sync.passwordRecovery)
  const activeSection = sections.find((item) => item.id === active)!

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" />
      <div className="grid gap-8 md:grid-cols-[17rem_minmax(0,1fr)] md:items-start lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="Settings sections" className={`grid gap-6 md:sticky md:top-4 ${showDetail ? "max-md:hidden" : ""}`}>
          {[...new Set(sections.map((item) => item.group))].map((group) => (
            <div key={group} className="grid gap-1.5">
              <h2 className="px-1 text-xs font-medium text-muted-foreground">{group}</h2>
              <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                {sections.filter((item) => item.group === group).map(({ id, label, icon: Icon, summary }) => (
                  <li key={id}>
                    <button type="button" aria-current={active === id && showDetail ? "page" : undefined} onClick={() => setOpen(id)} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none ${active === id ? "md:bg-primary/10" : ""}`}>
                      <span className={`grid size-8 shrink-0 place-items-center rounded-md ${active === id ? "md:bg-primary md:text-primary-foreground" : ""} bg-muted text-foreground`}><Icon className="size-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-medium ${active === id ? "md:text-primary" : ""}`}>{label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{summary}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground md:hidden" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="px-1 text-xs text-muted-foreground">
            Focal v{import.meta.env.VITE_APP_VERSION} · <span className="font-mono">{import.meta.env.VITE_COMMIT_HASH}</span> · <a href="https://github.com/flandyw/focal" target="_blank" rel="noopener noreferrer" className="rounded-xs underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">GitHub</a>
          </p>
        </nav>

        <section className={`min-w-0 max-w-3xl ${showDetail ? "" : "max-md:hidden"}`} aria-labelledby="settings-section-title">
          <Button variant="ghost" size="sm" className="-ml-2 mb-3 text-muted-foreground md:hidden" onClick={() => setOpen(null)}><ChevronLeft />Settings</Button>
          <header className="mb-6">
            <h2 id="settings-section-title" className="focal-page-title">{activeSection.label}</h2>
          </header>
          {active === "account" ? <AccountSection sync={sync} syncLabel={syncLabel} /> : null}
          {active === "notifications" ? <Panel description="Choose which alerts reach you and when. Preferences apply to this device."><Group padded><PushSettings key={sync.status === "sign-in-required" ? "signed-out" : sync.user?.id ?? "signed-out"} userId={sync.status === "sign-in-required" ? undefined : sync.user?.id} /></Group></Panel> : null}
          {active === "subjects" ? <SubjectsSection {...{ subjects, selectedSubjects, completedSubjects, subjectCompletionYears, onSubjectCompletion, onCompleteYear, onSubjectsChange, current }} /> : null}
          {active === "difficulty" ? <DifficultySection difficulty={difficulty} providers={providers} onChange={onExamDifficultyChange} /> : null}
          {active === "appearance" ? <AppearanceSettings /> : null}
          {active === "ai" ? <AISection sync={sync} signedIn={signedIn} /> : null}
          {active === "app" ? <PhoneSection onNotifications={() => setOpen("notifications")} /> : null}
          {active === "updates" ? <UpdatesSection /> : null}
          {active === "data" ? <DataSection {...{ onExport, onImport, onReplayOnboarding, onStartTour, recovery }} /> : null}
        </section>
      </div>
    </div>
  )
}

function Panel({ description, children }: { description: string; children?: ReactNode }) {
  return <div className="grid gap-8"><p className="-mt-4 max-w-[62ch] text-sm text-muted-foreground text-pretty">{description}</p>{children}</div>
}

/** A titled block of settings; `padded` hosts self-contained components instead of rows. */
function Group({ title, description, action, padded, children }: { title?: string; description?: string; action?: ReactNode; padded?: boolean; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      {title ? (
        <div className="flex items-end justify-between gap-4 px-1">
          <div><h3 className="text-sm font-medium">{title}</h3>{description ? <p className="mt-0.5 max-w-[62ch] text-sm text-muted-foreground text-pretty">{description}</p> : null}</div>
          {action}
        </div>
      ) : null}
      <div className={`rounded-lg border bg-card ${padded ? "px-4 [&>*]:border-t-0 [&>:last-child]:border-b-0" : "divide-y"}`}>{children}</div>
    </section>
  )
}

function Row({ title, description, children }: { title: ReactNode; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}

function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-md bg-muted p-0.5">
      {options.map(([option, text]) => <Button key={option} type="button" size="sm" variant="ghost" disabled={disabled} aria-pressed={value === option} onClick={() => onChange(option)} className="h-7 aria-pressed:bg-background aria-pressed:shadow-xs">{text}</Button>)}
    </div>
  )
}

function swap<T>(list: T[], a: number, b: number) {
  const next = [...list]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

function AccountSection({ sync, syncLabel }: { sync: ReturnType<typeof useSupabaseSync>; syncLabel: string }) {
  const [email, setEmail] = useState(sync.user?.email ?? "")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [resetRequested, setResetRequested] = useState(false)
  const [loading, setLoading] = useState<"sign-in" | "create" | "reset" | "update" | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const recovering = sync.passwordRecovery === "ready"
  const resetting = !recovering && (resetRequested || sync.passwordRecovery === "invalid")

  function clear() { setMessage(null); setError(null) }

  async function submit() {
    if (loading) return
    setLoading(recovering ? "update" : resetting ? "reset" : "sign-in")
    clear()
    try {
      if (recovering) {
        if (password !== confirmPassword) throw new Error("Passwords do not match.")
        await sync.updatePassword(password)
        setResetRequested(false)
        setConfirmPassword("")
        setMessage("Password updated. You can use it to sign in on your other devices.")
      } else if (resetting) {
        await sync.resetPassword(email.trim())
        setMessage("If an account exists for this email, you’ll receive a password reset link. Check your inbox and spam folder.")
      } else await sync.signIn(email.trim(), password)
      setPassword("")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not complete the request. Try again.")
    } finally {
      setLoading(null)
    }
  }

  async function create(form: HTMLFormElement | null) {
    if (!form?.reportValidity() || loading) return
    setLoading("create")
    clear()
    try {
      if (!await sync.signUp(email.trim(), password)) setMessage("Check your email to confirm your account, then sign in.")
      else setPassword("")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the account. Try again.")
    } finally {
      setLoading(null)
    }
  }

  const feedback = <>
    {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </>

  if (!sync.configured) return <Panel description="Account sync is not available in this build. Your data stays on this device." />
  if (sync.passwordRecovery === "checking") return <p role="status" className="text-sm text-muted-foreground">Checking your password reset link…</p>

  if (sync.user && sync.status !== "sign-in-required" && !recovering && !resetting) return (
    <Panel description="Exams, SACs and mistakes sync across your devices. Local changes keep saving if sync is briefly unavailable.">
      <Group>
        <div className="flex flex-wrap items-center gap-4 p-4">
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-base font-semibold text-primary-foreground uppercase">{sync.user.email?.[0] ?? "?"}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{sync.user.email ?? "Signed in"}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Cloud className="size-3.5" aria-hidden />{syncLabel}</p>
          </div>
          <Button variant="outline" onClick={() => { void sync.signOut().catch(() => setError("Could not sign out. Try again.")) }}><LogOut />Sign out</Button>
        </div>
      </Group>
      {feedback}
      <Group title="MCP access" description="Let an AI client such as Claude Code read and change your Focal data. Anyone with a token has full access to your account; revoke it here at any time." padded><McpTokens /></Group>
    </Panel>
  )

  return (
    <Panel description={recovering ? "Choose a new password for your account." : resetting ? "Enter your account email to receive a password reset link." : "Sign in to sync exams, SACs and mistakes across devices."}>
      <Group padded>
        <form aria-busy={Boolean(loading)} className="grid max-w-md gap-4 py-5" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          {sync.passwordRecovery === "invalid" ? <p role="alert" className="text-sm text-destructive">This reset link is invalid or has expired. Request a new link below.</p> : null}
          {!recovering && !resetting && (sync.status === "sign-in-required" ? <p role="status" className="text-sm text-destructive">Your session ended. Sign in again to resume sync. Saved work and queued changes are kept on this device.</p>
            : sync.status === "restoring" || sync.status === "reconnecting" ? <p role="status" className="text-sm text-muted-foreground">Reconnecting to your saved account. Changes stay on this device.</p> : null)}
          {!recovering ? <Field><FieldLabel htmlFor="account-email">Email address</FieldLabel><Input id="account-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></Field> : null}
          {!resetting ? <Field>
            <FieldLabel htmlFor="account-password">{recovering ? "New password" : "Password"}</FieldLabel>
            <div className="relative">
              <Input id="account-password" name="password" type={showPassword ? "text" : "password"} autoComplete={recovering ? "new-password" : "current-password"} minLength={recovering ? 6 : undefined} className="pr-12" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <Button type="button" variant="ghost" size="icon-sm" className="absolute right-1 top-1/2 -translate-y-1/2" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff /> : <Eye />}</Button>
            </div>
            {recovering ? <FieldDescription>Use at least 6 characters.</FieldDescription> : null}
          </Field> : null}
          {recovering ? <Field><FieldLabel htmlFor="account-confirm-password">Confirm new password</FieldLabel><Input id="account-confirm-password" name="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></Field> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={Boolean(loading)}>{loading && loading !== "create" ? <VortexAngularSpinLoader dotSize={2} gap={1} /> : <Cloud />}{recovering ? loading === "update" ? "Updating password…" : "Update password" : resetting ? loading === "reset" ? "Sending link…" : "Send reset link" : loading === "sign-in" ? "Signing in…" : "Sign in"}</Button>
            {!recovering && !resetting
              ? <Button type="button" variant="outline" disabled={Boolean(loading)} onClick={(event) => void create(event.currentTarget.form)}>{loading === "create" ? <><VortexAngularSpinLoader dotSize={2} gap={1} />Creating account…</> : "Create account"}</Button>
              : <Button type="button" variant="outline" disabled={Boolean(loading)} onClick={() => { sync.finishPasswordRecovery(); setResetRequested(false); setPassword(""); setConfirmPassword(""); clear() }}>Cancel</Button>}
          </div>
          {!recovering && !resetting ? <Button type="button" variant="link" className="w-fit px-0" disabled={Boolean(loading)} onClick={() => { setResetRequested(true); setPassword(""); setShowPassword(false); clear() }}>Forgot password?</Button> : null}
        </form>
      </Group>
      {feedback}
    </Panel>
  )
}

function SubjectsSection({ subjects, selectedSubjects, completedSubjects, subjectCompletionYears, onSubjectCompletion, onCompleteYear, onSubjectsChange, current }: {
  subjects: string[]
  selectedSubjects: string[]
  completedSubjects: string[]
  subjectCompletionYears: Record<string, number>
  onSubjectCompletion: (subject: string, year: number | null) => void
  onCompleteYear: (year: number, subjects: string[]) => void
  onSubjectsChange: (subjects: string[]) => void
  current: string[]
}) {
  const [custom, setCustom] = useState("")
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [finishing, setFinishing] = useState<string[]>([])
  const years = [...new Set(completedSubjects.map((subject) => subjectCompletionYears[subject]))].sort((a, b) => b - a)

  function add(subject: string) {
    if (selectedSubjects.some((name) => sameStudySubject(name, subject))) { toast(`${subject} is already in your subjects`); return }
    onSubjectsChange([...selectedSubjects, subject])
  }
  // Move within the visible list; archived subjects keep their place in the stored order.
  const move = (index: number, direction: number) => onSubjectsChange(swap(selectedSubjects, selectedSubjects.indexOf(current[index]), selectedSubjects.indexOf(current[index + direction])))

  return (
    <Panel description="Your subjects in priority order. The first is the default across Focal. Archive a subject when you finish it to keep its records and ATAR context.">
      <Group title="Current subjects">
        {current.length ? current.map((subject, index) => (
          <div key={subject} className="flex items-center gap-2 py-1.5 pr-2 pl-4">
            <span className="w-5 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={subject}>{subject}</span>
            {index === 0 ? <Badge variant="secondary">Default</Badge> : null}
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${subject} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${subject} down`} disabled={index === current.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
            <Button variant="ghost" size="sm" onClick={() => onSubjectCompletion(subject, new Date().getFullYear())}>Archive</Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${subject}`} onClick={() => { const previous = selectedSubjects; onSubjectsChange(previous.filter((item) => !sameStudySubject(item, subject))); toast(`${subject} removed`, { duration: 8000, action: { label: "Undo", onClick: () => onSubjectsChange(previous) } }) }}><X /></Button>
          </div>
        )) : <p className="px-4 py-3 text-sm text-muted-foreground">No subjects yet. Add them below in priority order.</p>}
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          <SubjectCombobox subjects={subjects.filter((subject) => !selectedSubjects.some((name) => sameStudySubject(name, subject)))} preferredSubjects={[]} value="" onValueChange={(subject) => { if (subject) add(subject) }} className="w-full" placeholder="Search VCE subjects" />
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const next = custom.trim(); if (!next) return; add(next); setCustom("") }}>
            <Input autoComplete="off" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Custom subject" aria-label="Custom subject name" />
            <Button type="submit" variant="outline" disabled={!custom.trim()}><Plus />Add</Button>
          </form>
        </div>
      </Group>

      {current.length ? (
        <Group title="Finish a year" description="Archive every subject you completed in one go. Leave continuing subjects unticked.">
          <div className="grid gap-1 px-4 py-3">
            {current.map((subject) => (
              <Label key={subject} className="flex min-h-9 items-center gap-3 text-sm font-normal">
                <Checkbox checked={finishing.some((name) => sameStudySubject(name, subject))} onCheckedChange={(checked) => setFinishing(checked ? [...finishing, subject] : finishing.filter((item) => !sameStudySubject(item, subject)))} />{subject}
              </Label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Label htmlFor="completion-year" className="text-sm">Completed in</Label>
            <Input id="completion-year" className="w-24" type="number" min={1900} max={9999} value={year} onChange={(event) => setYear(Number(event.target.value))} />
            <Button className="ml-auto" variant="outline" disabled={!validCompletionYear(year) || !finishing.length} onClick={() => { onCompleteYear(year, finishing.filter((subject) => current.some((name) => sameStudySubject(name, subject)))); setFinishing([]) }}>Archive {finishing.length || ""} {finishing.length === 1 ? "subject" : "subjects"}</Button>
          </div>
        </Group>
      ) : null}

      {years.map((completed) => (
        <Group key={completed} title={`Completed in ${completed}`}>
          {completedSubjects.filter((subject) => subjectCompletionYears[subject] === completed).map((subject) => (
            <div key={subject} className="flex items-center gap-2 py-1.5 pr-2 pl-4">
              <span className="min-w-0 flex-1 truncate text-sm">{subject}</span>
              <Input className="h-8 w-24" aria-label={`Completion year for ${subject}`} type="number" min={1900} max={9999} defaultValue={completed} onBlur={(event) => { const next = Number(event.target.value); if (validCompletionYear(next)) onSubjectCompletion(subject, next); else event.target.value = String(completed) }} />
              <Button variant="ghost" size="sm" onClick={() => onSubjectCompletion(subject, null)}>Resume</Button>
            </div>
          ))}
        </Group>
      ))}
    </Panel>
  )
}

function DifficultySection({ difficulty, providers, onChange }: { difficulty: ExamDifficultySettings; providers: string[]; onChange: (settings: ExamDifficultySettings) => void }) {
  const [provider, setProvider] = useState("")
  const set = (changes: Partial<ExamDifficultySettings>) => onChange({ ...difficulty, ...changes, updatedAt: new Date().toISOString() })
  const order = difficulty.providerOrder
  const baseline = order.indexOf("VCAA")
  const off = !difficulty.enabled

  return (
    <Panel description="Rank the exam providers you use from hardest to easiest so scores on harder papers count for a little more. VCAA is the zero-adjustment baseline.">
      <Group>
        <Row title={<Label htmlFor="difficulty-enabled">Adjust scores for paper difficulty</Label>} description="Turn off to use raw scores everywhere.">
          <Switch id="difficulty-enabled" checked={difficulty.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        </Row>
        <Row title="Strength" description="Points per rank away from VCAA, capped at ±8.">
          <Segmented label="Adjustment strength" disabled={off} value={difficulty.strength} options={Object.entries(STRENGTHS).map(([id, [label, points]]) => [id as ExamDifficultySettings["strength"], `${label} · ${points}`])} onChange={(strength) => set({ strength })} />
        </Row>
      </Group>

      <Group title="Provider ranking" description="Hardest at the top." action={
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled={off || order.join("|") === DEFAULT_PROVIDER_DIFFICULTY.join("|")} onClick={() => set({ providerOrder: [...DEFAULT_PROVIDER_DIFFICULTY] })}><RotateCcw />Broad</Button>
          <Button size="sm" variant="ghost" disabled={off || order.join("|") === MATHEMATICS_PROVIDER_DIFFICULTY.join("|")} onClick={() => set({ providerOrder: [...MATHEMATICS_PROVIDER_DIFFICULTY] })}>Maths</Button>
        </div>
      }>
        {order.map((name, index) => {
          const adjustment = Math.max(-8, Math.min(8, (baseline - index) * STRENGTHS[difficulty.strength][1]))
          return (
            <div key={name} className={`flex items-center gap-2 py-1.5 pr-2 pl-4 ${name === "VCAA" ? "bg-muted/50" : ""}`}>
              <span className="w-5 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>{name}</span>
              <span className={`w-16 text-right text-xs tabular-nums ${adjustment > 0 ? "text-primary" : "text-muted-foreground"}`}>{adjustment === 0 ? "baseline" : `${adjustment > 0 ? "+" : ""}${adjustment} pts`}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${name} up`} disabled={off || index === 0} onClick={() => set({ providerOrder: swap(order, index, index - 1) })}><ArrowUp /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${name} down`} disabled={off || index === order.length - 1} onClick={() => set({ providerOrder: swap(order, index, index + 1) })}><ArrowDown /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} disabled={off || name === "VCAA"} onClick={() => { set({ providerOrder: order.filter((item) => item !== name) }); toast(`${name} removed`, { duration: 8000, action: { label: "Undo", onClick: () => set({ providerOrder: order }) } }) }}><Trash2 /></Button>
            </div>
          )
        })}
        <form className="flex gap-2 p-3" onSubmit={(event) => {
          event.preventDefault()
          const next = provider.trim()
          if (!next) return
          if (order.some((item) => item.toLowerCase() === next.toLowerCase())) { toast(`${next} is already in the list`); return }
          const providerOrder = [...order]
          providerOrder.splice(baseline < 0 ? providerOrder.length : baseline, 0, next)
          set({ providerOrder })
          setProvider("")
        }}>
          <Input autoComplete="off" list="known-exam-providers" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Add a school or exam provider" aria-label="Exam provider name" disabled={off} />
          <datalist id="known-exam-providers">{providers.filter((item) => !order.some((name) => name.toLowerCase() === item.toLowerCase())).map((item) => <option key={item} value={item} />)}</datalist>
          <Button type="submit" variant="outline" disabled={off || !provider.trim()}><Plus />Add</Button>
        </form>
      </Group>
      <p className="max-w-[68ch] px-1 text-xs leading-5 text-muted-foreground text-pretty">The starter order is only a broad guide. Paper difficulty varies by subject and year, so remove irrelevant providers and reorder the ones you use. Non-VCAA papers receive less influence the further they sit from the baseline. This is a planning estimate, not an official conversion.</p>
    </Panel>
  )
}

function AISection({ sync, signedIn }: { sync: ReturnType<typeof useSupabaseSync>; signedIn: boolean }) {
  const user = signedIn ? sync.user : null
  return (
    <Panel description="Study chat and AI overviews use your Vercel AI Gateway key. Choose the chat model in Chat.">
      <Group title="Study chat" padded>
        {user ? <GatewaySettings key={user.id} userId={user.id} /> : <p className="py-4 text-sm text-muted-foreground">Sign in under Account to save your Gateway API key.</p>}
      </Group>
      {user ? <Group title="AI overviews" description="Short reads of your data with suggested next steps, cached so they cost a few cents a month." padded><AIOverviewSettings key={user.id} userId={user.id} /></Group> : null}
      {AI_ENABLED ? <ChatGPTGroup /> : null}
    </Panel>
  )
}

function ChatGPTGroup() {
  const auth = useChatGPT()
  const [settings, setSettings] = useState<AISettings>(() => loadAISettings())
  const [models, setModels] = useState<ChatGPTModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try { setModels(await createChatGPTProvider().listModelCatalog()) }
    catch { setModels([]); setError("Could not load models for this account.") }
    finally { setLoading(false) }
  }
  // Loading state accompanies an external model-catalog request.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (auth.isAuthenticated) void refresh() }, [auth.isAuthenticated])

  const available = auth.isAuthenticated ? models : []
  const model = available.some((item) => item.slug === settings.model) ? settings.model : available[0]?.slug
  const effort = settings.reasoningEffort === "none" ? "low" : settings.reasoningEffort
  const save = (next: AISettings) => { setSettings(next); saveAISettings(next) }

  return (
    <Group title="ChatGPT" description="Fill with AI uses the connected account's ChatGPT plan." action={auth.isAuthenticated ? <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>{loading ? <VortexAngularSpinLoader dotSize={2} gap={1} /> : <RefreshCw />}Refresh models</Button> : null}>
      <div className="p-4"><ChatGPTConnection /></div>
      {model ? <>
        <Row title="Model" description="Access depends on your plan. Saved on this device.">
          <Select items={Object.fromEntries(available.map((item) => [item.slug, item.displayName]))} value={model} onValueChange={(slug) => { if (slug) save({ model: slug, reasoningEffort: effort }) }}>
            <SelectTrigger aria-label="Model" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{available.map((item) => <SelectItem key={item.slug} value={item.slug}>{item.displayName}</SelectItem>)}</SelectContent>
          </Select>
        </Row>
        <Row title="Reasoning" description="Higher levels take longer.">
          <Segmented label="Reasoning level" value={effort} options={EFFORTS.map((item) => [item, EFFORT_LABELS[item]])} onChange={(reasoningEffort) => save({ model, reasoningEffort })} />
        </Row>
      </> : null}
      {error ? <p role="alert" className="px-4 py-3 text-sm text-destructive">{error}</p> : null}
    </Group>
  )
}

function PhoneSection({ onNotifications }: { onNotifications: () => void }) {
  const canInstall = useSyncExternalStore(onInstallChange, canPromptInstall)
  return (
    <Panel description="Add Focal to your Home Screen for its own app window. It opens offline and syncs when you’re back online.">
      <Group>
        <Row title="iPhone or iPad" description="Share menu → Add to Home Screen → Add. Keep Open as Web App on if offered." />
        <Row title="Android" description="Browser menu → Install app, or Add to Home screen." />
        {canInstall ? <Row title="This device" description="Your browser can install Focal directly."><Button onClick={() => void promptInstall()}><Download />Install Focal</Button></Row> : null}
      </Group>
      <Group>
        <Row title="Study reminders" description="Push reminders need the Home Screen app on iOS 16.4 or later."><Button variant="outline" onClick={onNotifications}><Bell />Notifications</Button></Row>
      </Group>
      <p className="max-w-[62ch] px-1 text-xs text-muted-foreground">Saved study data stays in this browser. Sign in to carry it across devices and app installations.</p>
    </Panel>
  )
}

const formatBytes = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

function UpdatesSection() {
  const update = useUpdateState()
  const busy = update.status === "checking" || update.status === "downloading" || update.status === "installing"
  const percent = update.total ? Math.min(100, (update.downloaded / update.total) * 100) : null
  const status = {
    idle: "Check GitHub for a newer version.",
    checking: "Checking for updates…",
    uptodate: "Focal is up to date.",
    available: `Version ${update.version} is available.`,
    downloading: `Downloading version ${update.version}…`,
    ready: `Version ${update.version} is ready to install.`,
    installing: "Installing and restarting…",
    error: update.error ?? "Update failed.",
  }[update.status]
  return (
    <Panel description="Updates download in the background; you choose when to restart.">
      <Group>
        <Row title={`Focal ${import.meta.env.VITE_APP_VERSION}`} description={status}>
          {update.status === "available" ? <Button size="sm" onClick={() => void updateActions.download?.()}><Download />Download</Button> : null}
          {update.status === "ready" ? <Button size="sm" onClick={() => void updateActions.install?.()}>Install and restart</Button> : null}
          <Button size="sm" variant="outline" disabled={busy || update.status === "ready"} onClick={() => void updateActions.check?.()}>{update.status === "checking" ? <VortexAngularSpinLoader dotSize={2} gap={1} /> : <RefreshCw />}Check now</Button>
        </Row>
        {update.status === "downloading" ? (
          <div className="grid gap-2 px-4 py-3">
            <Progress aria-label="Update download" value={percent} />
            <p className="text-sm tabular-nums text-muted-foreground">{formatBytes(update.downloaded)}{update.total ? ` of ${formatBytes(update.total)}` : ""}{percent === null ? "" : ` · ${Math.round(percent)}%`}{update.speed ? ` · ${formatBytes(update.speed)}/s` : ""}</p>
          </div>
        ) : null}
      </Group>
    </Panel>
  )
}

function DataSection({ onExport, onImport, onReplayOnboarding, onStartTour, recovery }: { onExport: () => void; onImport: (file: File) => Promise<void>; onReplayOnboarding: () => void; onStartTour: () => void; recovery: ReactNode }) {
  const importInput = useRef<HTMLInputElement>(null)
  return (
    <Panel description="Keep a copy of your Focal data, restore from one, or recover something you deleted.">
      <Group title="Backup file">
        <Row title="Export" description="Download everything as a JSON file."><Button variant="outline" onClick={onExport}><Download />Export</Button></Row>
        <Row title="Import" description="Replace your data with a backup. You’ll confirm before anything changes.">
          <Button variant="outline" onClick={() => importInput.current?.click()}><Upload />Import</Button>
          <input ref={importInput} hidden type="file" accept="application/json,.json" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void onImport(file)
            event.currentTarget.value = ""
          }} />
        </Row>
      </Group>
      <Group padded>{recovery}</Group>
      <Group title="Getting started">
        <Row title="Welcome setup" description="Run the first-launch setup again."><Button variant="outline" onClick={onReplayOnboarding}><RotateCcw />Replay</Button></Row>
        <Row title="Guided tour" description="A quick walk through the app."><Button variant="outline" onClick={onStartTour}><Compass />Start tour</Button></Row>
      </Group>
    </Panel>
  )
}
