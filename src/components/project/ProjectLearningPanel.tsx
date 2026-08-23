import { useMemo, useState } from "react"
import { Brain, Check, FileText, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getProjectMasteryScore, getProjectTopicMastery } from "@/lib/mastery"
import { generateStudyCards, reviewStudyCard } from "@/lib/studyMaterials"
import type { AssessmentResult, FileInfo, Project, StudyCard } from "@/lib/types"
import { generateId } from "@/lib/utils"

export function ProjectLearningPanel({
  project,
  files,
  onUpdateProject,
}: {
  project: Project
  files: FileInfo[]
  onUpdateProject: (updates: Partial<Project>) => Promise<void> | void
}) {
  const [title, setTitle] = useState("")
  const [score, setScore] = useState("")
  const [maxScore, setMaxScore] = useState("")
  const [topics, setTopics] = useState("")
  const [feedback, setFeedback] = useState("")
  const [sourcePath, setSourcePath] = useState("")
  const [generating, setGenerating] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [reviewIndex, setReviewIndex] = useState(0)

  const mastery = getProjectMasteryScore(project)
  const topicMastery = getProjectTopicMastery(project)
  const dueCards = useMemo(() => (project.studyCards ?? [])
    .filter((card) => new Date(card.dueAt).getTime() <= Date.now())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt)), [project.studyCards])
  const reviewCard = dueCards[reviewIndex % Math.max(1, dueCards.length)]

  const addResult = async () => {
    const numericScore = Number(score)
    const numericMax = Number(maxScore)
    if (!title.trim() || !Number.isFinite(numericScore) || !Number.isFinite(numericMax) || numericMax <= 0 || numericScore < 0 || numericScore > numericMax) {
      toast.error("Add a title and a valid score")
      return
    }
    const result: AssessmentResult = {
      id: generateId(),
      title: title.trim(),
      score: numericScore,
      maxScore: numericMax,
      completedAt: new Date().toISOString(),
      topics: topics.split(",").map((topic) => topic.trim()).filter(Boolean),
      feedback: feedback.trim() || undefined,
    }
    await onUpdateProject({ results: [...(project.results ?? []), result] })
    setTitle("")
    setScore("")
    setMaxScore("")
    setTopics("")
    setFeedback("")
    toast.success("Result added")
  }

  const generate = async () => {
    const file = files.find((item) => item.path === sourcePath)
    if (!file) return
    setGenerating(true)
    try {
      const cards = await generateStudyCards(file, project)
      await onUpdateProject({ studyCards: [...(project.studyCards ?? []), ...cards] })
      toast.success(`${cards.length} study cards created`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate study cards")
    } finally {
      setGenerating(false)
    }
  }

  const review = async (correct: boolean) => {
    if (!reviewCard) return
    const updated = (project.studyCards ?? []).map((card): StudyCard =>
      card.id === reviewCard.id ? reviewStudyCard(card, correct) : card,
    )
    await onUpdateProject({ studyCards: updated })
    setRevealed(false)
    setReviewIndex((index) => dueCards.length > 1 ? (index + 1) % dueCards.length : 0)
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Check className="size-4" /> Results & mastery</CardTitle>
            <CardDescription>Marks and card reviews identify weak topics for planning.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-lg bg-muted/40 p-3">
              <span className="text-3xl font-semibold tabular-nums">{mastery === null ? "—" : `${mastery}%`}</span>
              <div>
                <p className="font-medium">Current mastery</p>
                <p className="text-xs text-muted-foreground">{topicMastery.length ? `${topicMastery.length} topics with evidence` : "Add a result or review cards"}</p>
              </div>
              {topicMastery.slice(0, 4).map((topic) => (
                <div key={topic.topic} className="col-span-2 flex items-center justify-between text-sm">
                  <span>{topic.topic}</span><span className="tabular-nums text-muted-foreground">{topic.score}%</span>
                </div>
              ))}
            </div>

            <div className="grid gap-2 rounded-lg border p-3">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Result title, e.g. Practice SAC 2" aria-label="Result title" />
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" min="0" value={score} onChange={(event) => setScore(event.target.value)} placeholder="Score" aria-label="Score" />
                <Input type="number" min="1" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} placeholder="Out of" aria-label="Maximum score" />
              </div>
              <Input value={topics} onChange={(event) => setTopics(event.target.value)} placeholder="Topics, comma separated" aria-label="Result topics" />
              <Textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Teacher feedback or reflection" aria-label="Result feedback" />
              <Button onClick={() => void addResult()}><Plus /> Add result</Button>
            </div>

            {(project.results ?? []).map((result) => (
              <div key={result.id} className="flex items-start gap-3 border-t pt-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{result.title}</p>
                  <p className="text-sm text-muted-foreground">{result.score}/{result.maxScore} · {Math.round(result.score / result.maxScore * 100)}%{result.topics.length ? ` · ${result.topics.join(", ")}` : ""}</p>
                  {result.feedback && <p className="mt-1 text-sm">{result.feedback}</p>}
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${result.title}`} onClick={() => void onUpdateProject({ results: project.results?.filter((item) => item.id !== result.id) })}><Trash2 /></Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Brain className="size-4" /> Study from files</CardTitle>
            <CardDescription>Generate source-grounded active-recall cards, then review only what is due.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex gap-2">
              <Select value={sourcePath} onValueChange={setSourcePath}>
                <SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="Choose a readable source file" /></SelectTrigger>
                <SelectContent>
                  {files.map((file) => <SelectItem key={file.path} value={file.path}>{file.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button disabled={!sourcePath || generating} onClick={() => void generate()}>
                {generating ? <Loader2 className="animate-spin" /> : <FileText />} Generate
              </Button>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              {reviewCard ? (
                <div className="grid min-h-64 content-between gap-5">
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{dueCards.length} due</span><span className="truncate">Source: {reviewCard.sourceName}</span>
                    </div>
                    <p className="mt-5 text-lg font-medium leading-relaxed">{reviewCard.question}</p>
                    {revealed && <p className="mt-4 border-t pt-4 leading-relaxed">{reviewCard.answer}</p>}
                  </div>
                  {revealed ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" onClick={() => void review(false)}><RotateCcw /> Again</Button>
                      <Button onClick={() => void review(true)}><Check /> Got it</Button>
                    </div>
                  ) : <Button onClick={() => setRevealed(true)}>Show answer</Button>}
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center text-center">
                  <Brain className="mb-3 size-8 text-muted-foreground" />
                  <p className="font-medium">Review queue clear</p>
                  <p className="mt-1 text-sm text-muted-foreground">{project.studyCards?.length ? `${project.studyCards.length} cards will return when due.` : "Generate cards from a project file to begin."}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
