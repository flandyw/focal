import { useEffect, useState } from "react"
import { createChatGPTProxyProvider } from "@opencoredev/loginwithchatgpt-ai"
import { useLoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { isCheapestModel, loadPlannerModel, savePlannerModel, supportsStreamedAnalysis } from "@/lib/ai-settings"
import { canonicalNow } from "@/lib/study-session-sync"
import { describeStudyPlan, formatPlannerError, planStudySession, type StudyPlan } from "@/lib/study-plan"
import type { TimerSettings } from "@/lib/study-timer"

export function StudyPlanCard({
  blocksToday,
  canStartNow,
  onApply,
  running,
  settings,
  subjects,
  timerMode,
  minutesLeft,
}: {
  blocksToday: number
  /** True only when a fresh focus block is one keystroke away: never mid break
   *  or overtime, where starting would run the wrong phase. */
  canStartNow: boolean
  onApply: (plan: StudyPlan) => void
  running: boolean
  settings: TimerSettings
  subjects: string[]
  timerMode: string
  minutesLeft: number
}) {
  const auth = useLoginWithChatGPT()
  const [request, setRequest] = useState("")
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState(loadPlannerModel)
  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const [usedModel, setUsedModel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = models.filter(supportsStreamedAnalysis)

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setModels([])
      return
    }
    let cancelled = false
    createChatGPTProxyProvider().listModels()
      .then((available) => { if (!cancelled) setModels(available.filter(supportsStreamedAnalysis)) })
      .catch(() => { if (!cancelled) setModels([]) })
    return () => { cancelled = true }
  }, [auth.isAuthenticated])

  function chooseModel(next: string) {
    setModel(next)
    savePlannerModel(next)
  }

  async function requestPlan() {
    if (!request.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await planStudySession(request, {
        now: canonicalNow(),
        subjects,
        settings,
        blocksToday,
        timer: { running, mode: timerMode, minutesLeft },
      }, model)
      setPlan(result.plan)
      setUsedModel(result.model)
    } catch (failure) {
      // Planning is an extra, never a gate: the timer keeps running untouched.
      setPlan(null)
      setError(formatPlannerError(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan a session</CardTitle>
        <CardDescription className="max-w-[68ch]">
          Say what you want to do and when. ChatGPT turns it into blocks and breaks you can review before anything changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field>
          <FieldLabel htmlFor="study-plan-request">What do you want to get done?</FieldLabel>
          <Textarea
            id="study-plan-request"
            maxLength={400}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="An hour of chemistry organic reactions before dinner, starting now"
            value={request}
          />
          <FieldDescription>Current time, your subjects, and today's progress are sent so the plan fits your actual evening.</FieldDescription>
        </Field>

        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-56">
            <FieldLabel htmlFor="study-plan-model">Planning model</FieldLabel>
            <Select
              disabled={!options.length}
              onValueChange={(value) => value && chooseModel(value)}
              value={options.includes(model) ? model : options[0]}
            >
              <SelectTrigger id="study-plan-model" size="sm">
                <SelectValue placeholder="Cheapest available" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}{isCheapestModel(option) ? " · cheapest" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button disabled={busy || !request.trim() || !auth.isAuthenticated} onClick={() => void requestPlan()}>
            <Sparkles className={busy ? "animate-pulse" : ""} />{busy ? "Planning" : "Plan it"}
          </Button>
        </div>

        {!auth.isAuthenticated ? (
          <p className="text-sm text-muted-foreground">Connect ChatGPT in Settings to plan sessions.</p>
        ) : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

        {plan ? (
          <div className="grid gap-3 rounded-lg border p-4" aria-live="polite">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium truncate">{[plan.subject, plan.intent].filter(Boolean).join(" · ") || "Focus session"}</p>
              <p className="text-sm text-muted-foreground">{describeStudyPlan(plan, canonicalNow())}</p>
              {plan.summary ? <p className="text-sm text-pretty text-muted-foreground">{plan.summary}</p> : null}
              <p className="text-xs text-muted-foreground">Planned with {usedModel}{plan.startNow && canStartNow ? " · will start on apply" : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  const starts = plan.startNow && canStartNow
                  onApply({ ...plan, startNow: starts })
                  setPlan(null)
                  toast(starts ? "Session applied and started" : "Session applied")
                }}
                size="sm"
              >
                <Sparkles />{plan.startNow && canStartNow ? "Apply and start" : "Apply to timer"}
              </Button>
              <Button onClick={() => setPlan(null)} size="sm" variant="outline">Discard</Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
