import { useEffect, useRef, useState, type FormEvent } from "react"
import { useLoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react"
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, Images, LogOut, Pencil, Sparkles, X } from "lucide-react"
import { MistakeAttachments } from "@/components/mistake-attachments"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DiscardChangesDialog } from "@/components/discard-changes-dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownPreview } from "@/components/markdown-preview"
import {
  GENERAL_MISTAKE_CATEGORIES,
  MATHEMATICS_MISTAKE_CATEGORIES,
  type ExamAttempt,
  type Mistake,
  type MistakeCategory,
  validateMistakeMarks,
} from "@/lib/exam-data"
import { formatChatGPTProgress, validateMistakeBatchImages, validateMistakeImages, type ChatGPTProgress, type MistakeDraft } from "@/lib/mistake-ai-core"
import { removeMistakeAttachments, uploadMistakeAttachments, validateSavedMistakeImages } from "@/lib/mistake-attachments"
import type { VcaaStudyResources } from "@/lib/vcaa-resources"

type MistakeSheetProps = {
  open: boolean
  attempts: ExamAttempt[]
  studies: VcaaStudyResources[]
  initialAttemptId?: string | null
  initialMistake?: Mistake | null
  storageUserId?: string | null
  onOpenChange: (open: boolean) => void
  onSave: (mistake: Mistake | Mistake[]) => void
}

function draftFromFields({
  attemptId,
  question,
  questionText,
  category,
  explanation,
  correction,
  areaOfStudy,
  criterion,
  totalMarks,
  marksLost,
}: Omit<MistakeDraft, "attemptId"> & { attemptId: string }): MistakeDraft {
  return { attemptId, question, questionText, category, explanation, correction, areaOfStudy, criterion, totalMarks, marksLost }
}

function validateMistakeDraft(draft: MistakeDraft, imageCount = 0): string | null {
  if (!draft.attemptId || !draft.question.trim() || (!draft.questionText.trim() && !imageCount) || !draft.explanation.trim() || !draft.correction.trim()) {
    return "Exam, item label, a question (text or images), mistake, and improved response are required."
  }
  return validateMistakeMarks(draft.totalMarks, draft.marksLost)
}

function createMistake(draft: MistakeDraft, timestamp: string, initialMistake?: Mistake | null): Mistake {
  return {
    id: initialMistake?.id ?? crypto.randomUUID(),
    attemptId: draft.attemptId,
    question: draft.question.trim(),
    questionText: draft.questionText.trim(),
    category: draft.category,
    explanation: draft.explanation.trim(),
    correction: draft.correction.trim(),
    areaOfStudy: draft.areaOfStudy.trim() || undefined,
    criterion: draft.criterion.trim() || undefined,
    totalMarks: draft.totalMarks,
    marksLost: draft.marksLost,
    dueAt: initialMistake?.dueAt ?? timestamp,
    reviewHistory: initialMistake?.reviewHistory,
    reviewState: initialMistake?.reviewState,
    intervalDays: initialMistake?.intervalDays,
    easeFactor: initialMistake?.easeFactor,
    repetitions: initialMistake?.repetitions,
    lapses: initialMistake?.lapses,
    lastReviewedAt: initialMistake?.lastReviewedAt,
    suspended: initialMistake?.suspended,
    resolved: initialMistake?.resolved ?? false,
    createdAt: initialMistake?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
}

export function MistakeSheet({
  open,
  attempts,
  studies,
  initialAttemptId,
  initialMistake,
  storageUserId,
  onOpenChange,
  onSave,
}: MistakeSheetProps) {
  const auth = useLoginWithChatGPT()
  const [showPreviews, setShowPreviews] = useState(false)
  const [attemptId, setAttemptId] = useState(initialMistake?.attemptId ?? initialAttemptId ?? "")
  const [question, setQuestion] = useState(initialMistake?.question ?? "")
  const [questionText, setQuestionText] = useState(initialMistake?.questionText ?? "")
  const [category, setCategory] = useState<MistakeCategory>(initialMistake?.category ?? "Concept")
  const [explanation, setExplanation] = useState(initialMistake?.explanation ?? "")
  const [correction, setCorrection] = useState(initialMistake?.correction ?? "")
  const [areaOfStudy, setAreaOfStudy] = useState(initialMistake?.areaOfStudy ?? "")
  const [criterion, setCriterion] = useState(initialMistake?.criterion ?? "")
  const [totalMarks, setTotalMarks] = useState(initialMistake?.totalMarks ?? 0)
  const [marksLost, setMarksLost] = useState(initialMistake?.marksLost ?? 0)
  const [questionImages, setQuestionImages] = useState<File[]>([])
  const [questionImageUrls, setQuestionImageUrls] = useState<string[]>([])
  useEffect(() => {
    const urls = questionImages.map((file) => URL.createObjectURL(file))
    setQuestionImageUrls(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [questionImages])
  const [images, setImages] = useState<File[]>([])
  const [savedAttachments, setSavedAttachments] = useState(initialMistake?.attachments ?? [])
  const [saveImages, setSaveImages] = useState(Boolean(storageUserId))
  const [importMode, setImportMode] = useState<"single" | "batch">("single")
  const [batchDrafts, setBatchDrafts] = useState<MistakeDraft[]>([])
  const [activeBatchIndex, setActiveBatchIndex] = useState<number | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<ChatGPTProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const initialSnapshot = useRef(JSON.stringify({
    attemptId, question, questionText, category, explanation, correction,
    areaOfStudy, criterion, totalMarks, marksLost, imageCount: 0, batchCount: 0, questionImageCount: 0, attachmentIds: (initialMistake?.attachments ?? []).map(({ id }) => id),
  }))
  const dirty = JSON.stringify({
    attemptId, question, questionText, category, explanation, correction,
    areaOfStudy, criterion, totalMarks, marksLost,
    imageCount: images.length, batchCount: batchDrafts.length, questionImageCount: questionImages.length, attachmentIds: savedAttachments.map(({ id }) => id),
  }) !== initialSnapshot.current
  const [confirmingClose, setConfirmingClose] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next && (saving || analysing)) return
    if (!next && dirty) {
      setConfirmingClose(true)
      return
    }
    onOpenChange(next)
  }

  const selectedAttempt = attemptId || initialAttemptId || ""
  const attemptOptions = attempts.map((attempt) => ({
    value: attempt.id,
    label: `${attempt.title} · ${attempt.paper}`,
  }))
  const selectedAttemptOption = attemptOptions.find((attempt) => attempt.value === selectedAttempt) ?? null
  const isBatchReview = importMode === "batch" && batchDrafts.length > 0
  const isEditingBatchDraft = isBatchReview && activeBatchIndex !== null

  function reset() {
    setAttemptId("")
    setQuestion("")
    setQuestionText("")
    setCategory("Concept")
    setExplanation("")
    setCorrection("")
    setAreaOfStudy("")
    setCriterion("")
    setTotalMarks(0)
    setMarksLost(0)
    setImages([])
    setQuestionImages([])
    setSavedAttachments([])
    setSaveImages(Boolean(storageUserId))
    setImportMode("single")
    setBatchDrafts([])
    setActiveBatchIndex(null)
    setProgress(null)
    setError(null)
  }

  function applyDraft(draft: MistakeDraft) {
    setAttemptId(draft.attemptId)
    setQuestion(draft.question)
    setQuestionText(draft.questionText)
    setCategory(draft.category)
    setExplanation(draft.explanation)
    setCorrection(draft.correction)
    setAreaOfStudy(draft.areaOfStudy)
    setCriterion(draft.criterion)
    setTotalMarks(draft.totalMarks)
    setMarksLost(draft.marksLost)
  }

  function readCurrentDraft(): MistakeDraft {
    return draftFromFields({
      attemptId: selectedAttempt,
      question,
      questionText,
      category,
      explanation,
      correction,
      areaOfStudy,
      criterion,
      totalMarks,
      marksLost,
    })
  }

  function commitActiveBatchDraft() {
    if (activeBatchIndex === null) return batchDrafts
    const currentDraft = readCurrentDraft()
    const updatedDrafts = batchDrafts.map((draft, index) => index === activeBatchIndex ? currentDraft : draft)
    setBatchDrafts(updatedDrafts)
    return updatedDrafts
  }

  async function analyse() {
    const validationError = importMode === "batch" ? validateMistakeBatchImages(images) : validateMistakeImages(images)
    if (validationError) return setError(validationError)

    setAnalysing(true)
    setError(null)
    try {
      const { analyseMistakeImageBatch, analyseMistakeImages } = await import("@/lib/mistake-ai")
      if (importMode === "batch") {
        const drafts = await analyseMistakeImageBatch(images, attempts, selectedAttempt, studies, setProgress)
        setBatchDrafts(drafts)
        setActiveBatchIndex(null)
      } else {
        setBatchDrafts([])
        applyDraft(await analyseMistakeImages(images, attempts, selectedAttempt, studies, setProgress))
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not analyse this image.")
    } finally {
      setAnalysing(false)
    }
  }

  function openBatchDraft(index: number) {
    commitActiveBatchDraft()
    applyDraft(batchDrafts[index])
    setActiveBatchIndex(index)
    setError(null)
  }

  function returnToBatchGrid() {
    commitActiveBatchDraft()
    setActiveBatchIndex(null)
    setError(null)
  }

  async function saveBatch() {
    const reviewedDrafts = commitActiveBatchDraft()
    const invalidIndex = reviewedDrafts.findIndex((draft) => validateMistakeDraft(draft))
    if (invalidIndex !== -1) {
      const invalidDraft = reviewedDrafts[invalidIndex]
      applyDraft(invalidDraft)
      setActiveBatchIndex(invalidIndex)
      setError(`Question ${invalidIndex + 1}: ${validateMistakeDraft(invalidDraft)}`)
      return
    }

    if (saveImages && !storageUserId) {
      setError("Sign in to ExamTrack sync in Settings to save images with mistakes.")
      return
    }
    setSaving(true)
    setError(null)
    const uploadedPaths: string[] = []
    try {
      const timestamp = new Date().toISOString()
      const mistakes: Mistake[] = []
      for (const [index, draft] of reviewedDrafts.entries()) {
        const mistake = createMistake(draft, timestamp)
        const files = saveImages && images[index] ? [images[index]] : []
        const validationError = validateSavedMistakeImages(files)
        if (validationError) throw new Error(`Question ${index + 1}: ${validationError}`)
        const attachments = files.length && storageUserId ? await uploadMistakeAttachments(storageUserId, mistake.id, files) : []
        uploadedPaths.push(...attachments.map(({ storagePath }) => storagePath))
        mistakes.push({ ...mistake, attachments })
      }
      onSave(mistakes)
      reset()
      onOpenChange(false)
    } catch (error) {
      if (uploadedPaths.length) await removeMistakeAttachments(uploadedPaths).catch(() => undefined)
      setError(error instanceof Error ? error.message : "Could not save the attached images.")
    } finally {
      setSaving(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const draft = readCurrentDraft()
    const validationError = validateMistakeDraft(draft, isEditingBatchDraft ? 0 : savedAttachments.length + questionImages.length + (saveImages ? images.length : 0))
    if (validationError) {
      setError(validationError)
      return
    }

    if (isEditingBatchDraft) {
      commitActiveBatchDraft()
      setActiveBatchIndex(null)
      setError(null)
      return
    }

    const filesToSave = [...questionImages, ...(saveImages ? images : [])]
    const attachmentError = validateSavedMistakeImages(filesToSave, savedAttachments.length, savedAttachments.reduce((total, attachment) => total + attachment.size, 0))
    if (attachmentError) return setError(attachmentError)
    if (filesToSave.length && !storageUserId) return setError("Sign in to ExamTrack sync in Settings to save images with mistakes.")
    const removedPaths = (initialMistake?.attachments ?? [])
      .filter((attachment) => !savedAttachments.some(({ id }) => id === attachment.id))
      .map(({ storagePath }) => storagePath)
    if (removedPaths.length && !storageUserId) return setError("Sign in to ExamTrack sync before removing saved images.")

    setSaving(true)
    setError(null)
    const mistake = createMistake(draft, new Date().toISOString(), initialMistake)
    let uploadedAttachments: Mistake["attachments"] = []
    try {
      if (filesToSave.length && storageUserId) uploadedAttachments = await uploadMistakeAttachments(storageUserId, mistake.id, filesToSave)
      if (removedPaths.length) await removeMistakeAttachments(removedPaths)
      onSave({ ...mistake, attachments: [...savedAttachments, ...(uploadedAttachments ?? [])] })
      reset()
      onOpenChange(false)
    } catch (error) {
      if (uploadedAttachments?.length) await removeMistakeAttachments(uploadedAttachments.map(({ storagePath }) => storagePath)).catch(() => undefined)
      setError(error instanceof Error ? error.message : "Could not save the attached images.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent resizable className="w-full">
        <SheetHeader>
          <SheetTitle>
            {initialMistake ? "Edit mistake" : isEditingBatchDraft ? `Edit question ${activeBatchIndex! + 1}` : isBatchReview ? "Review separate questions" : "Log mistake"}
          </SheetTitle>
          <SheetDescription>
            {isBatchReview
              ? "ChatGPT created one draft per image. Review each card, edit anything that needs correcting, then save the whole batch."
              : "Capture any knowledge, reasoning, evidence, expression, process, or accuracy issue. Markdown and optional LaTeX are supported."}
          </SheetDescription>
        </SheetHeader>

        {isBatchReview && !isEditingBatchDraft ? (
          <div className="grid gap-4 overflow-y-auto px-4 pb-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <div>
                <p className="text-sm font-medium">{batchDrafts.length} separate mistake cards ready</p>
                <p className="text-sm text-muted-foreground">Each image has been kept as its own question{saveImages && storageUserId ? " and will be saved as private context" : ""}.</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => { setBatchDrafts([]); setImages([]); setProgress(null); setError(null) }}>
                Start over
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {batchDrafts.map((draft, index) => (
                <Card
                  key={`${index}-${draft.question}`}
                  className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                  role="button"
                  tabIndex={0}
                  onClick={() => openBatchDraft(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      openBatchDraft(index)
                    }
                  }}
                >
                  <CardHeader className="gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="min-w-0">{draft.question || `Question ${index + 1}`}</CardTitle>
                      <Badge variant="outline">{index + 1}</Badge>
                    </div>
                    <CardDescription className="line-clamp-2">{draft.questionText || "No prompt generated"}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary">{draft.category}</Badge>
                      <Badge variant="outline">{draft.marksLost}/{draft.totalMarks} marks lost</Badge>
                      {draft.areaOfStudy ? <Badge variant="outline">{draft.areaOfStudy}</Badge> : null}
                    </div>
                    <p className="line-clamp-3 text-sm text-muted-foreground">{draft.explanation || "No mistake explanation generated"}</p>
                    <Button type="button" size="sm" variant="outline" className="w-full" onClick={(event) => { event.stopPropagation(); openBatchDraft(index) }}>
                      <Pencil />Edit this mistake
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <FieldError>{error}</FieldError>
          </div>
        ) : (
          <form id="mistake-form" className="overflow-y-auto px-4 pb-6 sm:px-6" onSubmit={submit}>
            <FieldGroup>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 p-3"><p className="text-sm text-muted-foreground">Capture the question. Understand the gap. Save a better approach.</p><Button type="button" size="sm" variant="outline" aria-pressed={showPreviews} onClick={() => setShowPreviews(!showPreviews)}>{showPreviews ? "Hide previews" : "Show formatted previews"}</Button></div>
              {isEditingBatchDraft ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-2">
                  <Button type="button" size="sm" variant="ghost" onClick={returnToBatchGrid}><ArrowLeft />All questions</Button>
                  <span className="text-sm font-medium tabular-nums">{activeBatchIndex! + 1} of {batchDrafts.length}</span>
                </div>
              ) : (
                <Field>
                  <details className="rounded-xl border bg-muted/20 p-4">
                    <summary className="cursor-pointer text-sm font-semibold">Images & AI assistance <span className="font-normal text-muted-foreground">· optional</span></summary>
                    <div className="mt-4 grid gap-4">
                  <FieldLabel htmlFor="mistake-image">Prompt, response, and feedback images</FieldLabel>
                  {!initialMistake ? (
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
                      <Button type="button" size="sm" variant={importMode === "single" ? "secondary" : "ghost"} disabled={analysing || batchDrafts.length > 0} onClick={() => { setImportMode("single"); setBatchDrafts([]); setActiveBatchIndex(null); setProgress(null); setError(null) }}>
                        <Sparkles />One mistake
                      </Button>
                      <Button type="button" size="sm" variant={importMode === "batch" ? "secondary" : "ghost"} disabled={analysing || batchDrafts.length > 0 || questionImages.length > 0} onClick={() => { setImportMode("batch"); setBatchDrafts([]); setActiveBatchIndex(null); setProgress(null); setError(null) }}>
                        <Images />Separate questions
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="mistake-image"
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={analysing || batchDrafts.length > 0}
                      onChange={(event) => {
                        const added = Array.from(event.target.files ?? [])
                        setImages((current) => [...current, ...added])
                        event.target.value = ""
                        setBatchDrafts([])
                        setActiveBatchIndex(null)
                        setProgress(null)
                        setError(null)
                      }}
                    />
                    <Button type="button" variant="secondary" disabled={!images.length || !selectedAttempt || analysing || batchDrafts.length > 0 || !auth.isAuthenticated} onClick={() => void analyse()}>
                      <Sparkles />{analysing ? "Analysing…" : importMode === "batch" ? `Import ${images.length || ""} questions` : "Fill with AI"}
                    </Button>
                  </div>
                  <FieldDescription>{importMode === "batch" ? "Choose the shared exam, then add 2–10 images. Each image becomes a separate mistake in the same order; each can be up to 3 MB and the batch up to 15 MB." : "Choose the exam, then upload one or more related images totalling up to 3 MB. Matching VCAA attempts also include the official exam PDF for context."}</FieldDescription>
                  {images.map((file, index) => <div key={index} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{index + 1}. {file.name}</span><Button type="button" size="icon-xs" variant="ghost" disabled={saving || analysing || batchDrafts.length > 0} aria-label={"Remove AI image " + (index + 1)} onClick={() => setImages((files) => files.filter((_, i) => i !== index))}><X /></Button></div>)}
                  {images.length ? (
                    <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                      <input type="checkbox" className="mt-0.5 size-4" checked={saveImages} disabled={!storageUserId} onChange={(event) => { setSaveImages(event.target.checked); setError(null) }} />
                      <span><span className="font-medium">Save {importMode === "batch" ? "each image with its mistake" : "these images with the mistake"}</span><br /><span className="text-xs text-muted-foreground">{storageUserId ? "Keeps graphs, annotations, and other context available during review." : "Sign in to ExamTrack sync in Settings to store private image attachments."}</span></span>
                    </label>
                  ) : null}
                  {progress ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground tabular-nums">{formatChatGPTProgress(progress)}</p> : null}
                  <div className="rounded-lg border bg-muted/30 p-3">
                    {auth.status === "loading" ? <p className="text-sm text-muted-foreground">Checking ChatGPT connection…</p> : null}

                    {auth.isAuthenticated ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <CheckCircle2 className="size-4 shrink-0" />
                          <span className="truncate text-sm font-medium">Connected{auth.user?.email ? ` as ${auth.user.email}` : ""}</span>
                        </div>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void auth.logout()}><LogOut />Disconnect</Button>
                      </div>
                    ) : null}

                    {auth.status === "pending" ? (
                      <div className="grid gap-3">
                        <p className="text-sm">Enter <strong className="font-mono">{auth.userCode}</strong> in the ChatGPT authorization window.</p>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => void auth.copyCode()}><Copy />{auth.copied ? "Copied" : "Copy code"}</Button>
                          <Button size="sm" variant="outline" render={<a href={auth.verificationUrl} target="_blank" rel="noopener noreferrer" />}><ExternalLink />Reopen</Button>
                        </div>
                      </div>
                    ) : null}

                    {auth.status !== "loading" && !auth.isAuthenticated && auth.status !== "pending" ? (
                      <div className="grid gap-3">
                        <p className="text-sm leading-5 text-muted-foreground">AI requests use your ChatGPT plan. The photo passes through this server; ExamTrack never receives your password, and disconnecting deletes the session.</p>
                        <div>
                          <Button type="button" size="sm" variant="outline" disabled={auth.isConnecting} onClick={() => void auth.login({ popup: window.open("about:blank", "_blank") })}>
                            <Sparkles />{auth.isConnecting ? "Connecting…" : "I understand, connect ChatGPT"}
                          </Button>
                        </div>
                        {auth.error ? <p role="alert" className="text-sm text-destructive">{auth.error}</p> : null}
                      </div>
                    ) : null}
                  </div>
                    </div>
                  </details>
                </Field>
              )}

              <div className="border-t pt-5"><h3 className="font-semibold">01 · The question</h3><p className="mt-1 text-sm text-muted-foreground">Keep the original task and exam context together.</p></div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="mistake-exam">Exam</FieldLabel>
                  <Combobox items={attemptOptions} value={selectedAttemptOption} onValueChange={(value) => setAttemptId(value?.value ?? "")} autoHighlight>
                    <ComboboxInput id="mistake-exam" className="w-full" placeholder="Search practice exams" />
                    <ComboboxContent>
                      <ComboboxEmpty>No matching practice exams.</ComboboxEmpty>
                      <ComboboxList>{(item) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}</ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </Field>
                <Field>
                  <FieldLabel htmlFor="question">Item label</FieldLabel>
                  <Input id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Section B, Question 4 or Essay 1" />
                </Field>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="mistake-total-marks">Total marks</FieldLabel>
                  <Input id="mistake-total-marks" type="number" min="0.5" step="0.5" value={totalMarks || ""} onChange={(event) => setTotalMarks(event.target.valueAsNumber)} required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mistake-marks-lost">Marks lost</FieldLabel>
                  <Input id="mistake-marks-lost" type="number" min="0" step="0.5" value={marksLost} onChange={(event) => setMarksLost(event.target.valueAsNumber)} required />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="question-text">Prompt or task</FieldLabel>
                <Textarea id="question-text" rows={4} value={questionText} onChange={(event) => setQuestionText(event.target.value)} placeholder="Enter the full question, essay prompt, stimulus task, or practical requirement." />
                {showPreviews ? <div className="rounded-lg border bg-muted/20 p-3"><MarkdownPreview>{questionText}</MarkdownPreview></div> : null}
              </Field>

              {!isEditingBatchDraft ? <Field>
                <FieldLabel htmlFor="question-images">Question images</FieldLabel>
                <FieldDescription>Add diagrams, screenshots, or multiple pages as part of this question. Up to 5 images, 5 MB each, 20 MB total including saved and retained AI images. Text above is optional when the question is in images.</FieldDescription>
                <Input id="question-images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={!storageUserId || saving || analysing || importMode === "batch"} onChange={(event) => {
                  const added = Array.from(event.target.files ?? [])
                  event.target.value = ""
                  const next = [...questionImages, ...added]
                  const validation = validateSavedMistakeImages([...next, ...(saveImages ? images : [])], savedAttachments.length, savedAttachments.reduce((total, attachment) => total + attachment.size, 0))
                  if (validation) { setError(validation); return }
                  setQuestionImages(next); setError(null)
                }} />
                {!storageUserId ? <FieldDescription>Sign in to ExamTrack sync in Settings to save question images.</FieldDescription> : null}
                {importMode === "batch" ? <FieldDescription>Switch to One mistake to attach multiple images to the same question.</FieldDescription> : null}
                {questionImages.map((file, index) => <div key={index} className="grid gap-2 rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2"><span className="truncate text-sm">{index + 1}. {file.name}</span><Button type="button" size="icon-xs" variant="ghost" disabled={saving || analysing} aria-label={"Remove question image " + (index + 1) + ": " + file.name} onClick={() => setQuestionImages((files) => files.filter((_, i) => i !== index))}><X /></Button></div>
                  {questionImageUrls[index] ? <img src={questionImageUrls[index]} alt={"Question image " + (index + 1) + ": " + file.name} className="max-h-96 w-full rounded-lg object-contain" /> : null}
                </div>)}
                  {initialMistake?.attachments?.length ? (
                    <div className="grid gap-2">
                      <p className="text-sm font-medium">Saved question images</p>
                      <MistakeAttachments attachments={savedAttachments} />
                      {savedAttachments.map((attachment) => (
                        <div key={attachment.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{attachment.name}</span>
                          <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove ${attachment.name}`} disabled={!storageUserId || saving || analysing} onClick={() => setSavedAttachments((items) => items.filter(({ id }) => id !== attachment.id))}><X /></Button>
                        </div>
                      ))}
                    </div>
                  ) : null}

              </Field> : null}

              <div className="border-t pt-5"><h3 className="font-semibold">02 · Organise</h3><p className="mt-1 text-sm text-muted-foreground">Add labels to find patterns and build focused practice sets.</p></div>
              <Field>
                <FieldLabel>Category</FieldLabel>
                <Select value={category} onValueChange={(value) => setCategory(value as MistakeCategory)}>
                  <SelectTrigger className="w-full"><SelectValue>{category}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>All subjects</SelectLabel>
                      {GENERAL_MISTAKE_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Mathematics-specific</SelectLabel>
                      {MATHEMATICS_MISTAKE_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="mistake-area">Topic, skill, or Area of Study <span className="text-muted-foreground">(optional)</span></FieldLabel>
                  <Input id="mistake-area" value={areaOfStudy} onChange={(event) => setAreaOfStudy(event.target.value)} placeholder="e.g. Cellular respiration, argument analysis, or a key process" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mistake-criterion">Assessment criterion <span className="text-muted-foreground">(optional)</span></FieldLabel>
                  <Input id="mistake-criterion" value={criterion} onChange={(event) => setCriterion(event.target.value)} placeholder="Use evidence precisely" />
                </Field>
              </div>

              <div className="border-t pt-5"><h3 className="font-semibold">03 · The takeaway</h3><p className="mt-1 text-sm text-muted-foreground">Write the lesson you want to remember next time.</p></div>
              <Field>
                <FieldLabel htmlFor="explanation">What went wrong?</FieldLabel>
                <Textarea id="explanation" rows={5} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Describe the gap: what was misunderstood, omitted, unsupported, unclear, or done inaccurately?" />
                <FieldDescription>Describe the error precisely enough to recognise it next time.</FieldDescription>
                {showPreviews ? <div className="rounded-lg border bg-muted/20 p-3"><MarkdownPreview>{explanation}</MarkdownPreview></div> : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="correction">Improved response or method</FieldLabel>
                <Textarea id="correction" rows={5} value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="Write the correct idea, evidence, structure, process, or answer you should use next time." />
                {showPreviews ? <div className="rounded-lg border bg-muted/20 p-3"><MarkdownPreview>{correction}</MarkdownPreview></div> : null}
              </Field>
              <FieldError>{error}</FieldError>
            </FieldGroup>
          </form>
        )}

        <SheetFooter className="border-t bg-background">
          <Button type="button" variant="outline" disabled={saving || analysing} onClick={() => handleOpenChange(false)}>Cancel</Button>
          {isBatchReview && !isEditingBatchDraft ? (
            <Button type="button" onClick={() => void saveBatch()} disabled={analysing || saving}>{saving ? "Saving…" : `Save all ${batchDrafts.length} mistakes`}</Button>
          ) : (
            <Button type="submit" form="mistake-form" disabled={attempts.length === 0 || analysing || saving}>{saving ? "Saving…" : isEditingBatchDraft ? "Done editing" : initialMistake ? "Save changes" : "Save mistake"}</Button>
          )}
        </SheetFooter>
      </SheetContent>
      <DiscardChangesDialog
        open={confirmingClose}
        onKeep={() => setConfirmingClose(false)}
        onDiscard={() => { setConfirmingClose(false); onOpenChange(false) }}
      />
    </Sheet>
  )
}
