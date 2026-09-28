import { useState } from "react"
import { ArrowLeft, ArrowRight, RotateCcw, Shuffle } from "lucide-react"
import { MarkdownPreview } from "@/components/markdown-preview"
import { MistakeAttachments } from "@/components/mistake-attachments"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import type { Mistake } from "@/lib/exam-data"

export function MistakePractice({ mistakes, onClose }: { mistakes: Mistake[]; onClose: () => void }) {
  const [cards, setCards] = useState(mistakes)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [finished, setFinished] = useState(false)
  const card = cards[index]
  function go(next: number) { setIndex(next); setRevealed(false) }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{finished ? "Practice complete" : "Practice your way"}</DialogTitle>
        <DialogDescription>Explore answers at your own pace. Practice does not change your review schedule.</DialogDescription>
      </DialogHeader>
      {finished ? <div className="grid justify-items-center gap-5 py-10 text-center">
        <p className="text-3xl font-semibold">{cards.length} cards explored</p>
        <p className="text-muted-foreground">Come back to these whenever you need a refresher.</p>
        <div className="flex gap-2"><Button variant="outline" onClick={() => { go(0); setFinished(false) }}><RotateCcw />Start again</Button><Button onClick={onClose}>Back to library</Button></div>
      </div> : card ? <div className="grid gap-5">
        <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground" aria-live="polite">Card {index + 1} of {cards.length}</span><Button variant="ghost" size="sm" onClick={() => {
          const shuffled = [...cards]
          for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
          setCards(shuffled); go(0)
        }}><Shuffle />Shuffle & restart</Button></div>
        <Progress value={(index + 1) / cards.length * 100} aria-label="Practice progress" />
        <div className="flex flex-wrap gap-2"><Badge variant="secondary">{card.category}</Badge>{card.areaOfStudy ? <Badge variant="outline">{card.areaOfStudy}</Badge> : null}</div>
        <h3 className="text-xl font-semibold">{card.question}</h3>
        <div className="min-h-32"><MarkdownPreview>{card.questionText || card.question}</MarkdownPreview><MistakeAttachments attachments={card.attachments} /></div>
        <Button variant="secondary" aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? "Hide answer" : "Reveal answer"}</Button>
        {revealed ? <div className="grid gap-5 rounded-xl border bg-muted/30 p-5">
          <section><h4 className="mb-2 font-semibold">What went wrong</h4><MarkdownPreview>{card.explanation}</MarkdownPreview></section>
          <section><h4 className="mb-2 font-semibold">A better approach</h4><MarkdownPreview>{card.correction}</MarkdownPreview></section>
          {card.criterion ? <section><h4 className="mb-2 font-semibold">Assessment criterion</h4><MarkdownPreview>{card.criterion}</MarkdownPreview></section> : null}
        </div> : null}
        <div className="flex justify-between gap-2"><Button variant="outline" disabled={index === 0} onClick={() => go(index - 1)}><ArrowLeft />Previous</Button><Button onClick={() => index === cards.length - 1 ? setFinished(true) : go(index + 1)}>{index === cards.length - 1 ? "Finish practice" : "Next card"}<ArrowRight /></Button></div>
      </div> : <Button onClick={onClose}>Back to library</Button>}
    </DialogContent>
  </Dialog>
}
