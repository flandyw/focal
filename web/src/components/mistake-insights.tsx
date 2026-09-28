import { useState } from "react"
import { RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card"
import { MarkdownPreview } from "@/components/markdown-preview"
import { formatChatGPTProgress, type ChatGPTProgress } from "@/lib/mistake-ai-core"
import type { AppData, MistakeInsights as MistakeInsightsData } from "@/lib/exam-data"

const MINIMIZED_KEY = "examtrack:mistake-insights-minimized"

export function MistakeInsights({ data, priorityCategory, onSave }: { data: AppData; priorityCategory?: string; onSave: (insights: MistakeInsightsData) => void }) {
  const [minimized, setMinimized] = useState(() => typeof localStorage !== "undefined" && localStorage.getItem(MINIMIZED_KEY) === "true")
  const [running, setRunning] = useState(false)
  const [generatingQuestions, setGeneratingQuestions] = useState(false)
  const [progress, setProgress] = useState<ChatGPTProgress | null>(null)
  const insights = data.mistakeInsights
  const stale = insights && data.mistakes.some((mistake) => mistake.updatedAt > insights.generatedAt)

  function setExpanded(value: string[]) {
    const nextMinimized = !value.includes("insights")
    localStorage.setItem(MINIMIZED_KEY, String(nextMinimized))
    setMinimized(nextMinimized)
  }

  async function runAnalysis() {
    setRunning(true)
    try {
      const { analyseMistakes } = await import("@/lib/mistake-ai")
      onSave(await analyseMistakes(data.mistakes, data.attempts, setProgress))
      toast.success("Mistake insights updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not analyse mistakes.")
    } finally {
      setRunning(false)
    }
  }

  async function generateQuestions() {
    if (!insights) return
    setGeneratingQuestions(true)
    try {
      const { generateMistakePracticeQuestions } = await import("@/lib/mistake-ai")
      const practiceQuestions = await generateMistakePracticeQuestions(insights, data.mistakes, data.attempts, setProgress)
      onSave({ ...insights, practiceQuestions, questionsGeneratedAt: new Date().toISOString() })
      toast.success("Practice questions generated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate questions.")
    } finally {
      setGeneratingQuestions(false)
    }
  }

  return (
    <Card className="gap-0 py-0">
      <Accordion value={minimized ? [] : ["insights"]} onValueChange={setExpanded}>
        <AccordionItem value="insights" className="border-0">
          <AccordionTrigger className="rounded-xl px-4 py-3 hover:no-underline">
            <div className="min-w-0 pr-3">
              <CardTitle>Mistake insights</CardTitle>
              {!minimized ? <CardDescription className="mt-1">{insights ? `Last updated ${new Date(insights.generatedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}${stale ? " · Mistakes changed since then" : ""}` : "Run when you want ChatGPT to find patterns across your logged mistakes. It never runs automatically."}</CardDescription> : null}
            </div>
          </AccordionTrigger>
          <AccordionContent className="grid gap-4 px-4 pb-4 [&_p:not(:last-child)]:mb-0">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              {progress ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground tabular-nums">{formatChatGPTProgress(progress)}</p> : null}
              <Button className="max-sm:w-full sm:ml-auto" variant={insights ? "outline" : "default"} onClick={() => void runAnalysis()} disabled={!data.mistakes.length || running || generatingQuestions}>
                {insights ? <RefreshCw /> : <Sparkles />}{running ? "Analysing…" : insights ? "Refresh" : "Analyse mistakes"}
              </Button>
            </div>
            {(priorityCategory || insights) ? (
              <CardContent className="grid gap-5 px-0">
          {priorityCategory ? <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <span className="font-medium">Start with {priorityCategory}.</span>{" "}
            <span className="text-muted-foreground">It is your most frequent unresolved error type; older mistakes in that category are first.</span>
          </div> : null}
          {insights ? <>
          <p className="text-sm text-muted-foreground">{insights.summary}</p>
          <div className="grid gap-3 md:grid-cols-3">
            {insights.biggestErrors.map((error) => (
              <div key={error.title} className="rounded-lg border p-3">
                <p className="font-medium">{error.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{error.evidence}</p>
                <p className="mt-2 text-sm">{error.action}</p>
              </div>
            ))}
          </div>
          {insights.otherInsights.length ? <div><p className="mb-2 text-sm font-medium">Other patterns</p><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{insights.otherInsights.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          <div className="rounded-lg bg-muted/40 p-3 text-sm"><span className="font-medium">Next step: </span>{insights.nextStep}</div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void generateQuestions()} disabled={running || generatingQuestions}>
              <Sparkles />{generatingQuestions ? "Generating…" : insights.practiceQuestions ? "Regenerate practice questions" : "Generate practice questions"}
            </Button>
            {insights.questionsGeneratedAt ? <span className="text-xs text-muted-foreground">Questions updated {new Date(insights.questionsGeneratedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span> : null}
          </div>
          {insights.practiceQuestions ? <MarkdownPreview>{insights.practiceQuestions}</MarkdownPreview> : null}
          </> : null}
              </CardContent>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  )
}
