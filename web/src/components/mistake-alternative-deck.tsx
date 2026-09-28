import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Shuffle, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { MarkdownPreview } from "@/components/markdown-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import type { AlternativeMistakeDeck, ExamAttempt, Mistake } from "@/lib/exam-data"
import { formatChatGPTProgress, type ChatGPTProgress } from "@/lib/mistake-ai-core"

type MistakeAlternativeDeckProps = {
  mistakes: Mistake[]
  allMistakes: Mistake[]
  attempts: ExamAttempt[]
  deck?: AlternativeMistakeDeck
  onSave: (deck: AlternativeMistakeDeck) => void
}

export function MistakeAlternativeDeck({ mistakes, allMistakes, attempts, deck, onSave }: MistakeAlternativeDeckProps) {
  const [generating, setGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<ChatGPTProgress | null>(null)
  const [revealed, setRevealed] = useState(false)
  const sourceMistakeMap = useMemo(() => new Map(mistakes.map((mistake) => [mistake.id, mistake])), [mistakes])
  const cards = useMemo(() => deck?.cards.filter((card) => sourceMistakeMap.has(card.sourceMistakeId)) ?? [], [deck, sourceMistakeMap])
  const cardMap = useMemo(() => new Map(cards.map((card) => [card.sourceMistakeId, card])), [cards])
  const cardIds = cards.map((card) => card.sourceMistakeId).join("\u0000")
  const [order, setOrder] = useState(() => cards.map((card) => card.sourceMistakeId))
  const [position, setPosition] = useState(0)
  const current = cardMap.get(order[position])
  const source = current ? sourceMistakeMap.get(current.sourceMistakeId) : undefined
  const staleCount = cards.filter((card) => (sourceMistakeMap.get(card.sourceMistakeId)?.updatedAt ?? "") > card.generatedAt).length
  const missingCount = Math.max(0, mistakes.length - cards.length)

  useEffect(() => {
    setOrder(cardIds ? cardIds.split("\u0000") : [])
    setPosition(0)
    setRevealed(false)
  }, [cardIds])

  async function generateDeck() {
    setGenerating(true)
    setGenerationProgress(null)
    try {
      const { generateAlternativeMistakeQuestions } = await import("@/lib/mistake-ai")
      const generated = await generateAlternativeMistakeQuestions(mistakes, attempts, setGenerationProgress)
      const generatedAt = new Date().toISOString()
      const replacedIds = new Set(mistakes.map((mistake) => mistake.id))
      const validMistakeIds = new Set(allMistakes.map((mistake) => mistake.id))
      onSave({
        cards: [
          ...(deck?.cards ?? []).filter((card) => validMistakeIds.has(card.sourceMistakeId) && !replacedIds.has(card.sourceMistakeId)),
          ...generated.map((card) => ({ ...card, generatedAt })),
        ],
        updatedAt: generatedAt,
      })
      toast.success("Alternative deck generated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the alternative deck.")
    } finally {
      setGenerating(false)
    }
  }

  function move(offset: number) {
    setPosition((value) => (value + offset + order.length) % order.length)
    setRevealed(false)
  }

  function shuffle() {
    setOrder((ids) => {
      const shuffled = [...ids]
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
        ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
      }
      return shuffled
    })
    setPosition(0)
    setRevealed(false)
  }

  if (!current || !source) {
    return (
      <Empty className="min-h-96 border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Sparkles /></EmptyMedia>
          <EmptyTitle>Create an alternative deck</EmptyTitle>
          <EmptyDescription>ChatGPT will turn each mistake card into a fresh question that tests the same skill, with a separate worked answer.</EmptyDescription>
        </EmptyHeader>
        {generationProgress ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground tabular-nums">{formatChatGPTProgress(generationProgress)}</p> : null}
        <Button onClick={() => void generateDeck()} disabled={!mistakes.length || generating}>
          <Sparkles />{generating ? "Generating deck…" : `Generate ${mistakes.length} alternative ${mistakes.length === 1 ? "card" : "cards"}`}
        </Button>
        <p className="max-w-lg text-center text-xs text-muted-foreground">AI requests use your ChatGPT plan and only run when you choose to generate.</p>
      </Empty>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="mx-auto grid w-full max-w-4xl gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Alternative deck</p>
            <p className="text-xs text-muted-foreground">
              {position + 1} of {order.length}
              {staleCount || missingCount ? ` · ${staleCount + missingCount} ${staleCount + missingCount === 1 ? "card needs" : "cards need"} generating` : ` · Updated ${new Date(deck!.updatedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={shuffle} disabled={order.length < 2}><Shuffle />Shuffle</Button>
            <Button size="sm" variant="outline" onClick={() => void generateDeck()} disabled={generating}>
              <Sparkles />{generating ? "Generating…" : staleCount || missingCount ? "Update deck" : "Regenerate"}
            </Button>
          </div>
        </div>
        <Progress value={(position + 1) / order.length * 100} aria-label={`Alternative card ${position + 1} of ${order.length}`} />
        {generationProgress && generating ? <p role="status" aria-live="polite" className="text-xs text-muted-foreground tabular-nums">{formatChatGPTProgress(generationProgress)}</p> : null}
      </div>

      <Card className="mx-auto w-full max-w-4xl" aria-live="polite">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>{current.skill}</CardTitle>
              <CardDescription>Alternative to {source.question}</CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {(source.updatedAt > current.generatedAt) ? <Badge variant="secondary">Needs refresh</Badge> : null}
              <Badge variant="outline">{current.marks} {current.marks === 1 ? "mark" : "marks"}</Badge>
              <Badge variant="outline">{source.category}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid min-h-80 content-start gap-6">
          <section>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Question</p>
            <MarkdownPreview>{current.question}</MarkdownPreview>
          </section>
          {revealed ? <>
            <Separator />
            <section>
              <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Worked answer</p>
              <MarkdownPreview>{current.answer}</MarkdownPreview>
            </section>
          </> : null}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={() => move(-1)} disabled={order.length < 2}><ChevronLeft />Previous</Button>
          {!revealed ? <Button onClick={() => setRevealed(true)}>Show answer</Button> : <span className="text-sm text-muted-foreground">Answer revealed</span>}
          <Button variant="outline" onClick={() => move(1)} disabled={order.length < 2}>Next<ChevronRight /></Button>
        </CardFooter>
      </Card>
    </div>
  )
}
