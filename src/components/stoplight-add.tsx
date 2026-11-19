import { useState, type FormEvent } from "react"
import type { CurriculumArea } from "../lib/learning-workspace"
import { DiscardChangesDialog } from "./discard-changes-dialog"
import { SubjectCombobox } from "./subject-combobox"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"

export type SkillDraft = Pick<CurriculumArea, "subject" | "name" | "group" | "check">

export function StoplightAddDialog({ subjects, preferredSubjects, defaultSubject, scopedSubject, onClose, onSave }: {
  subjects: string[]
  preferredSubjects: string[]
  defaultSubject: string
  scopedSubject?: string
  onClose: () => void
  onSave: (draft: SkillDraft) => string | undefined
}) {
  const [subject, setSubject] = useState(defaultSubject)
  const [name, setName] = useState("")
  const [group, setGroup] = useState("")
  const [check, setCheck] = useState("")
  const [error, setError] = useState<string>()
  const [confirmingClose, setConfirmingClose] = useState(false)

  function close() {
    if (name.trim() || group.trim() || check.trim() || subject.trim() !== defaultSubject) setConfirmingClose(true)
    else onClose()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = scopedSubject ?? subject.trim()
    if (!target || target.toLowerCase() === "all") return setError("Choose a subject for this skill.")
    if (!name.trim()) return setError("Enter a skill name.")
    const failure = onSave({ subject: target, name: name.trim(), group: group.trim() || "General", check: check.trim() || undefined })
    if (failure) return setError(failure)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a skill</DialogTitle>
          <DialogDescription>Add a single item to your checklist without importing a study design.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} onChange={() => setError(undefined)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="add-skill-subject">Subject</FieldLabel>
              {scopedSubject ? <Input id="add-skill-subject" value={scopedSubject} readOnly /> : <SubjectCombobox id="add-skill-subject" subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={(value) => { setSubject(value); setError(undefined) }} allowCustom required />}
            </Field>
            <Field><FieldLabel htmlFor="add-skill-name">Skill name</FieldLabel><Input id="add-skill-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required /></Field>
            <Field><FieldLabel htmlFor="add-skill-group">Group (optional)</FieldLabel><Input id="add-skill-group" value={group} onChange={(event) => setGroup(event.target.value)} maxLength={200} placeholder="General" /></Field>
            <Field><FieldLabel htmlFor="add-skill-check">Self-check (optional)</FieldLabel><Input id="add-skill-check" value={check} onChange={(event) => setCheck(event.target.value)} maxLength={200} placeholder="What could you do without notes?" /></Field>
            <FieldError>{error}</FieldError>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit">Add skill</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <DiscardChangesDialog open={confirmingClose} onKeep={() => setConfirmingClose(false)} onDiscard={onClose} />
    </Dialog>
  )
}
