import { useState } from "react"
import { CalendarDays, ClipboardList, Cloud, RotateCcw, Timer, X } from "lucide-react"
import { SubjectCombobox } from "./subject-combobox"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"

const FEATURES = [
  { icon: ClipboardList, title: "Practice exams", text: "Log marks and compare with VCAA grade distributions." },
  { icon: RotateCcw, title: "Mistakes", text: "Turn errors into cards you review on a spaced schedule." },
  { icon: CalendarDays, title: "Calendar", text: "Plan study around SACs, classes, and the exam timetable." },
  { icon: Timer, title: "Study timer", text: "Focus blocks and timed papers under exam conditions." },
]

export type OnboardingFinish = "exam" | "focus" | "calendar" | "sign-in" | null

export function OnboardingDialog({ subjects, selectedSubjects, signedIn, onSubjectsChange, onFinish }: {
  subjects: string[]
  selectedSubjects: string[]
  signedIn: boolean
  onSubjectsChange: (subjects: string[]) => void
  onFinish: (next: OnboardingFinish) => void
}) {
  const [step, setStep] = useState(0)
  const [subjectToAdd, setSubjectToAdd] = useState("")
  const steps = [
    {
      title: "Welcome to Focal",
      description: "Everything for VCE revision in one place. Here’s what you can do.",
      body: (
        <ul className="grid gap-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div><p className="text-sm font-medium">{title}</p><p className="text-sm text-muted-foreground">{text}</p></div>
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: "Choose your subjects",
      description: "Add them in priority order. The first is your default. Reorder them or add custom subjects later in Settings.",
      body: (
        <div className="grid gap-3">
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
          {selectedSubjects.length ? (
            <ol className="divide-y">
              {selectedSubjects.map((subject, index) => (
                <li key={subject} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{subject}</span>
                  {index === 0 ? <Badge variant="secondary">Default</Badge> : null}
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${subject}`} onClick={() => onSubjectsChange(selectedSubjects.filter((item) => item !== subject))}><X /></Button>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">No subjects yet.</p>}
        </div>
      ),
    },
    {
      title: "Where to start",
      description: signedIn ? "Your data syncs to your account automatically." : "Your data is saved in this browser. Sign in to sync it across devices and with Folio.",
      body: (
        <div className="grid gap-2">
          {!signedIn ? <Button variant="outline" className="justify-start" onClick={() => onFinish("sign-in")}><Cloud />Sign in or create an account</Button> : null}
          <Button variant="outline" className="justify-start" onClick={() => onFinish("exam")}><ClipboardList />Log a practice exam</Button>
          <Button variant="outline" className="justify-start" onClick={() => onFinish("focus")}><Timer />Start a study session</Button>
          <Button variant="outline" className="justify-start" onClick={() => onFinish("calendar")}><CalendarDays />Plan my week</Button>
        </div>
      ),
    },
  ]
  const current = steps[step]

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onFinish(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="text-xs text-muted-foreground tabular-nums">Step {step + 1} of {steps.length}</p>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.description}</DialogDescription>
        </DialogHeader>
        {current.body}
        <DialogFooter>
          {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button> : <Button variant="ghost" onClick={() => onFinish(null)}>Skip</Button>}
          {step < steps.length - 1
            ? <Button onClick={() => setStep(step + 1)}>{step === 1 && !selectedSubjects.length ? "Skip for now" : "Continue"}</Button>
            : <Button onClick={() => onFinish(null)}>Explore on my own</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
