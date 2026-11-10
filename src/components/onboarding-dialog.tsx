import { useState } from "react"
import { CalendarDays, ClipboardList, Cloud, LineChart, RotateCcw, Timer, X } from "lucide-react"
import { NAVIGATION_GROUPS } from "../lib/navigation"
import { SubjectCombobox } from "./subject-combobox"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { FocalMark } from "./focal-mark"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Input } from "./ui/input"
import { validCompletionYear } from "../lib/subject-completion"
import { Progress } from "./ui/progress"

const FEATURES = [
  { icon: ClipboardList, title: "Practice exams", text: "Log marks and compare with VCAA grade distributions." },
  { icon: RotateCcw, title: "Mistakes", text: "Turn errors into cards you review on a spaced schedule." },
  { icon: CalendarDays, title: "Calendar", text: "Plan study around SACs, classes, and the exam timetable." },
  { icon: Timer, title: "Study timer", text: "Focus blocks and timed papers under exam conditions." },
  { icon: LineChart, title: "Progress and predictions", text: "See study trends, rate skills, and estimate study scores and ATAR." },
]

export type OnboardingFinish = "exam" | "focus" | "calendar" | "sign-in" | "tour" | null

export function OnboardingDialog({ subjects, selectedSubjects, completedSubjects, signedIn, onSubjectsChange, onSubjectCompletion, subjectCompletionYears, onFinish }: {
  subjects: string[]
  selectedSubjects: string[]
  completedSubjects: string[]
  subjectCompletionYears: Record<string, number>
  onSubjectCompletion: (subject: string, year: number | null) => void
  signedIn: boolean
  onSubjectsChange: (subjects: string[]) => void
  onFinish: (next: OnboardingFinish) => void
}) {
  const [step, setStep] = useState(0)
  const [subjectToAdd, setSubjectToAdd] = useState("")
  const [addingCompleted, setAddingCompleted] = useState(false)
  const currentSubjects = selectedSubjects.filter((subject) => !completedSubjects.includes(subject))
  const finishedSubjects = selectedSubjects.filter((subject) => completedSubjects.includes(subject))
  const [year] = useState(() => new Date().getFullYear())
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
      description: "Choose what you’re studying now and anything you’ve already finished, including subjects completed in Year 11. Change these later in Settings → Subjects.",
      body: (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Add subject as">
            <Button className="flex-1 basis-36" variant={addingCompleted ? "outline" : "default"} aria-pressed={!addingCompleted} onClick={() => setAddingCompleted(false)}>Studying now</Button>
            <Button className="flex-1 basis-36" variant={addingCompleted ? "default" : "outline"} aria-pressed={addingCompleted} onClick={() => setAddingCompleted(true)}>Already completed</Button>
          </div>
          <SubjectCombobox
            subjects={subjects.filter((subject) => !selectedSubjects.includes(subject))}
            preferredSubjects={[]}
            value={subjectToAdd}
            onValueChange={(subject) => {
              if (!subject || selectedSubjects.includes(subject)) return
              onSubjectsChange([...selectedSubjects, subject])
              if (addingCompleted || completedSubjects.includes(subject)) onSubjectCompletion(subject, addingCompleted ? year : null)
              setSubjectToAdd("")
            }}
            className="w-full"
            placeholder={addingCompleted ? "Search to add a completed subject" : "Search to add a current subject"}
          />
          <p className="text-sm text-muted-foreground" role="status">{currentSubjects.length} studying now · {finishedSubjects.length} completed</p>
          {[
            { title: "Studying now", items: currentSubjects, completed: false },
            { title: "Already completed", items: finishedSubjects, completed: true },
          ].map(({ title, items, completed }) => (
            <section key={title} className="grid gap-2" aria-label={title}>
              <h3 className="text-sm font-semibold">{title}</h3>
              {items.length ? <ul className="divide-y">
                {items.map((subject, index) => (
                  <li key={subject} className="grid gap-2 py-3">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 break-words text-sm font-medium">{subject}</span>
                      {!completed && index === 0 ? <Badge variant="secondary">Default</Badge> : null}
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${subject}`} onClick={() => {
                        onSubjectsChange(selectedSubjects.filter((item) => item !== subject))
                        if (completed) onSubjectCompletion(subject, null)
                      }}><X /></Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" size="sm" aria-label={`${completed ? "Studying again:" : "Mark completed:"} ${subject}`} onClick={() => {
                        onSubjectCompletion(subject, completed ? null : year)
                      }}>{completed ? "Studying again" : "Mark completed"}</Button>
                      {completed ? <Input
                        key={subjectCompletionYears[subject]}
                        className="w-28"
                        aria-label={`Completion year for ${subject}`}
                        type="number"
                        min={1900}
                        max={9999}
                        defaultValue={subjectCompletionYears[subject]}
                        onBlur={(event) => {
                          const next = Number(event.target.value)
                          if (validCompletionYear(next)) {
                            if (next !== subjectCompletionYears[subject]) onSubjectCompletion(subject, next)
                          }
                          else event.target.value = String(subjectCompletionYears[subject])
                        }}
                      /> : null}
                    </div>
                  </li>
                ))}
              </ul> : <p className="text-sm text-muted-foreground">{completed ? "Finished a subject early? Add it above." : "Add your current subjects above. You can also do this later."}</p>}
            </section>
          ))}
          <p className="text-xs text-muted-foreground">Your first current subject is the default. Reorder subjects or resume a completed subject in Settings → Subjects.</p>
          {finishedSubjects.length > 0 ? <p className="text-xs text-muted-foreground">Completed subjects start with {year} as their completion year. Change the year beside each subject if you finished earlier.</p> : null}
        </div>
      ),
    },
    {
      title: "Find your way around",
      description: "Everything lives in the sidebar. Hide or reorder links later in Settings → Appearance.",
      body: (
        <div className="grid gap-4">
          {NAVIGATION_GROUPS.map((group) => (
            <section key={group.label} className="grid gap-1.5">
              <h3 className="focal-eyebrow">{group.label}</h3>
              <ul className="grid gap-1">
                {group.items.map((item) => (
                  <li key={item.id} className="flex gap-2 text-sm"><span className="w-28 shrink-0 font-medium">{item.label}</span><span className="min-w-0 text-muted-foreground">{item.description}</span></li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-sm text-muted-foreground pointer-coarse:hidden">Press <kbd className="rounded-xs border px-1.5 font-sans text-xs">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd> anywhere to search and jump to any page.</p>
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <Progress value={((step + 1) / steps.length) * 100} aria-label={`Step ${step + 1} of ${steps.length}`} className="mb-2" />
          <p className="text-xs text-muted-foreground tabular-nums">Step {step + 1} of {steps.length}</p>
          {step === 0 ? <FocalMark className="mt-2 size-11 text-primary" /> : null}
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.description}</DialogDescription>
        </DialogHeader>
        {current.body}
        <DialogFooter>
          {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button> : <Button variant="ghost" onClick={() => onFinish(null)}>Skip</Button>}
          {step < steps.length - 1
            ? <Button onClick={() => setStep(step + 1)}>{step === 1 && !selectedSubjects.length ? "Skip for now" : "Continue"}</Button>
            : <><Button variant="outline" onClick={() => onFinish(null)}>Explore on my own</Button><Button onClick={() => onFinish("tour")}>Take the tour</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
