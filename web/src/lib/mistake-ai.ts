import { createChatGPTProxyProvider } from "@opencoredev/loginwithchatgpt-ai"
import { jsonSchema, Output, streamText } from "ai"
import { MISTAKE_CATEGORIES, type AlternativeMistakeCard, type ExamAttempt, type Mistake, type MistakeInsights } from "@/lib/exam-data"
import { loadAISettings, supportsStreamedAnalysis } from "@/lib/ai-settings"
import {
  createMistakeFieldMergePlan,
  getEmptyMistakeFields,
  type MistakeAutofill,
  type MistakeFieldMerge,
  type MistakeFieldMergePlan,
  type MistakeFieldValue,
  type MistakeMergeField,
} from "@/lib/mistake-autofill"
import { findVcaaExamForAttempt, type VcaaStudyResources } from "@/lib/vcaa-resources"
import {
  createChatGPTProgressHandler,
  validateMistakeBatchImages,
  validateMistakeImages,
  type ChatGPTProgress,
  type IndexedMistakeDraft,
  type MistakeDraft,
} from "@/lib/mistake-ai-core"

export {
  createChatGPTProgressHandler,
  formatChatGPTProgress,
  validateMistakeBatchImages,
  validateMistakeImage,
  validateMistakeImages,
} from "@/lib/mistake-ai-core"
export type { ChatGPTProgress, IndexedMistakeDraft, MistakeDraft } from "@/lib/mistake-ai-core"

export function selectChatGPTModel(models: string[], preferredModel = "auto"): string | null {
  const supportedModels = models.filter(supportsStreamedAnalysis)
  if (preferredModel !== "auto" && supportedModels.includes(preferredModel)) return preferredModel
  return supportedModels[0] ?? null
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined
  const value = error as Record<string, unknown>
  return typeof value.statusCode === "number" ? value.statusCode : typeof value.status === "number" ? value.status : undefined
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error
  if (!error || typeof error !== "object") return ""
  const value = error as Record<string, unknown>
  const parts = [value.message, value.responseBody, value.detail, value.data, value.cause]
  return parts.map((part) => {
    if (typeof part === "string") return part
    if (part && typeof part === "object") {
      try { return JSON.stringify(part) } catch { return "" }
    }
    return ""
  }).filter(Boolean).join(" ")
}

export function formatMistakeAIError(error: unknown) {
  const status = errorStatus(error)
  const detail = errorText(error)
  const normalized = detail.toLowerCase()
  if (status === 401 || normalized.includes("not_authenticated")) return "Connect ChatGPT in Settings first."
  if (status === 413 || normalized.includes("responses_request_too_large")) return "This image is too large to send to ChatGPT. Choose a smaller image and try again."
  if (status === 429) return "ChatGPT is receiving too many requests. Wait a minute, then try again."
  if (normalized.includes("stream") && normalized.includes("not support")) return "The selected ChatGPT model does not support streamed analysis. Choose another model in Settings."
  if (normalized.includes("no output generated")) return "ChatGPT did not return an analysis. Try again or choose another model in Settings."
  if (error instanceof Error && error.message) return error.message
  return "Could not analyse this image."
}

async function getChatGPTModel() {
  const chatgpt = createChatGPTProxyProvider()
  let models: string[]
  try {
    models = await chatgpt.listModels()
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 401) {
      throw new Error("Connect ChatGPT in Settings first.")
    }
    throw error
  }
  const settings = loadAISettings()
  const model = selectChatGPTModel(models, settings.model)
  if (!model) throw new Error(models.length ? "This ChatGPT account has no model that supports streamed analysis." : "This ChatGPT account has no available model.")
  return { chatgpt, model, settings }
}

function mistakeContext(mistakes: Mistake[], attempts: ExamAttempt[]) {
  const attemptMap = new Map(attempts.map((attempt) => [attempt.id, attempt]))
  const normalizeQuestionLabel = (value: string) => value.trim().toLocaleLowerCase().replace(/\bquestion\b/g, "q").replace(/[^a-z0-9]+/g, "")
  return mistakes.map((mistake) => {
    const attempt = attemptMap.get(mistake.attemptId)
    const questionKey = normalizeQuestionLabel(mistake.question)
    const matchingResults = attempt?.questionResults?.filter((result) => normalizeQuestionLabel(result.label) === questionKey) ?? []
    const assessmentResult = matchingResults.length === 1 ? matchingResults[0] : undefined
    return {
      id: mistake.id,
      subject: attempt?.subject,
      exam: attempt?.title,
      paper: attempt?.paper,
      question: mistake.question,
      questionText: mistake.questionText,
      category: mistake.category,
      explanation: mistake.explanation,
      correction: mistake.correction,
      areaOfStudy: mistake.areaOfStudy,
      criterion: mistake.criterion,
      marksLost: mistake.marksLost,
      totalMarks: mistake.totalMarks,
      assessmentResult: assessmentResult ? {
        label: assessmentResult.label,
        areaOfStudy: assessmentResult.areaOfStudy,
        criterion: assessmentResult.criterion,
        marksLost: assessmentResult.maxMarks - assessmentResult.marksAwarded,
        totalMarks: assessmentResult.maxMarks,
        examinerNote: assessmentResult.examinerNote,
      } : undefined,
      resolved: mistake.resolved,
      reviewState: mistake.reviewState,
      dueAt: mistake.dueAt,
      intervalDays: mistake.intervalDays,
      lapses: mistake.lapses,
      suspended: mistake.suspended,
      reviews: mistake.reviewHistory?.map(({ result }) => result),
    }
  })
}

export async function autofillMistakeFields(
  mistakes: Mistake[],
  attempts: ExamAttempt[],
  onProgress?: (progress: ChatGPTProgress) => void,
): Promise<MistakeAutofill[]> {
  const candidates = mistakes.filter((mistake) => getEmptyMistakeFields(mistake).length > 0)
  if (!candidates.length) return []

  onProgress?.({ phase: "connecting", tokens: 0, estimated: true, reasoning: false })
  const { chatgpt, model, settings } = await getChatGPTModel()
  const batches = Array.from({ length: Math.ceil(candidates.length / 10) }, (_, index) => candidates.slice(index * 10, index * 10 + 10))
  const autofills: MistakeAutofill[] = []

  for (const batch of batches) {
    const ids = batch.map((mistake) => mistake.id)
    const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const
    const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const
    const schema = jsonSchema<{ autofills: MistakeAutofill[] }>({
      type: "object",
      additionalProperties: false,
      required: ["autofills"],
      properties: {
        autofills: {
          type: "array",
          minItems: batch.length,
          maxItems: batch.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "question", "questionText", "explanation", "correction", "areaOfStudy", "criterion", "totalMarks", "marksLost"],
            properties: {
              id: { type: "string", enum: ids },
              question: nullableString,
              questionText: nullableString,
              explanation: nullableString,
              correction: nullableString,
              areaOfStudy: nullableString,
              criterion: nullableString,
              totalMarks: nullableNumber,
              marksLost: nullableNumber,
            },
          },
        },
      },
    })
    const records = batch.map((mistake) => ({
      ...mistakeContext([mistake], attempts)[0],
      emptyFields: getEmptyMistakeFields(mistake),
    }))
    let streamError: unknown
    const result = streamText({
      model: chatgpt(model),
      output: Output.object({ schema, name: "mistake_autofills" }),
      maxOutputTokens: Math.max(1200, batch.length * 450),
      headers: { "x-login-with-chatgpt-reasoning-effort": settings.reasoningEffort },
      onChunk: createChatGPTProgressHandler(onProgress),
      onError: ({ error }) => { streamError = error },
      prompt: `Fill the listed emptyFields in each student's mistake record using only the supplied record and exam context. Return exactly one object for every id. For fields not listed in emptyFields, return null: existing values must never be rewritten. Treat assessmentResult, when supplied, as the source of truth for its topic, criterion, and marks. Keep question as a short item label, questionText as a self-contained faithful reconstruction, explanation as a concise diagnosis, correction as an actionable improved response or method, areaOfStudy and criterion as concise labels, and marks as realistic non-negative numbers with totalMarks greater than zero and marksLost no greater than totalMarks. Do not pretend to know missing exact wording or marks; return null when the evidence is insufficient. Records: ${JSON.stringify(records)}`,
    })
    let batchAutofills: MistakeAutofill[]
    try {
      batchAutofills = (await result.output).autofills
    } catch (error) {
      const cause = streamError ?? error
      throw new Error(formatMistakeAIError(cause), { cause })
    }
    const returnedIds = new Set(batchAutofills.map((autofill) => autofill.id))
    if (batchAutofills.length !== ids.length || returnedIds.size !== ids.length || ids.some((id) => !returnedIds.has(id))) {
      throw new Error("ChatGPT did not return one autofill result for every mistake. Try again.")
    }
    autofills.push(...batchAutofills)
  }

  return autofills
}

export async function generateMistakeFieldMergePlan(
  field: MistakeMergeField,
  values: MistakeFieldValue[],
  onProgress?: (progress: ChatGPTProgress) => void,
): Promise<MistakeFieldMergePlan> {
  if (values.length < 2) return { field, merges: [] }

  onProgress?.({ phase: "connecting", tokens: 0, estimated: true, reasoning: false })
  const { chatgpt, model, settings } = await getChatGPTModel()
  const sources = values.map(({ value }) => value)
  const schema = jsonSchema<{ merges: MistakeFieldMerge[] }>({
    type: "object",
    additionalProperties: false,
    required: ["merges"],
    properties: {
      merges: {
        type: "array",
        maxItems: values.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["source", "target"],
          properties: {
            source: { type: "string", enum: sources },
            target: { type: "string" },
          },
        },
      },
    },
  })
  let streamError: unknown
  const result = streamText({
    model: chatgpt(model),
    output: Output.object({ schema, name: "mistake_field_merge_plan" }),
    maxOutputTokens: Math.max(800, values.length * 80),
    headers: { "x-login-with-chatgpt-reasoning-effort": settings.reasoningEffort },
    onChunk: createChatGPTProgressHandler(onProgress),
    onError: ({ error }) => { streamError = error },
    prompt: `Review the student's existing ${field === "criterion" ? "assessment criterion" : "topic / Area of Study"} labels and propose a conservative consolidation plan. Merge only labels that are semantically equivalent, trivial spelling/capitalisation variants, or unnecessarily verbose versions of the same concept. Preserve labels that describe genuinely distinct curriculum topics or assessment criteria, even when they are related. Prefer an existing concise label as the target when suitable, but you may create a clearer concise target. Return only changed source-to-target mappings, use each source at most once, and do not create circular mappings. An empty merges array is correct when no consolidation is clearly useful. Labels and usage counts: ${JSON.stringify(values)}`,
  })

  try {
    return createMistakeFieldMergePlan(field, values, (await result.output).merges)
  } catch (error) {
    if (streamError) throw new Error(formatMistakeAIError(streamError), { cause: streamError })
    throw error
  }
}

type GeneratedAlternativeMistakeCard = Omit<AlternativeMistakeCard, "generatedAt">

export async function generateAlternativeMistakeQuestions(mistakes: Mistake[], attempts: ExamAttempt[], onProgress?: (progress: ChatGPTProgress) => void): Promise<GeneratedAlternativeMistakeCard[]> {
  if (!mistakes.length) throw new Error("Log at least one mistake before generating an alternative deck.")
  onProgress?.({ phase: "connecting", tokens: 0, estimated: true, reasoning: false })
  const { chatgpt, model, settings } = await getChatGPTModel()
  const batches = Array.from({ length: Math.ceil(mistakes.length / 8) }, (_, index) => mistakes.slice(index * 8, index * 8 + 8))
  const generatedCards: GeneratedAlternativeMistakeCard[] = []

  for (const batch of batches) {
    const sourceIds = batch.map((mistake) => mistake.id)
    const schema = jsonSchema<{ cards: GeneratedAlternativeMistakeCard[] }>({
      type: "object",
      additionalProperties: false,
      required: ["cards"],
      properties: {
        cards: {
          type: "array",
          minItems: batch.length,
          maxItems: batch.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["sourceMistakeId", "skill", "question", "answer", "marks"],
            properties: {
              sourceMistakeId: { type: "string", enum: sourceIds },
              skill: { type: "string", description: "A short label for the knowledge or process skill being tested" },
              question: { type: "string", description: "A fully self-contained original question or task in Markdown, using LaTeX only where useful" },
              answer: { type: "string", description: "A concise model answer, response plan, or worked solution in Markdown, using LaTeX only where useful" },
              marks: { type: "integer", minimum: 1, maximum: 20 },
            },
          },
        },
      },
    })
    const result = streamText({
      model: chatgpt(model),
      output: Output.object({ schema, name: "alternative_mistake_deck" }),
      maxOutputTokens: Math.max(1400, batch.length * 500),
      headers: { "x-login-with-chatgpt-reasoning-effort": settings.reasoningEffort },
      onChunk: createChatGPTProgressHandler(onProgress),
      prompt: `Create exactly one original alternative question or task for every mistake record, regardless of subject. It must test the same underlying knowledge, evidence use, communication, reasoning, or process as its source while changing the values, wording, source material, scenario, or required reasoning enough that it cannot be answered by memorising the source. Keep the difficulty and curriculum level comparable. Make every task self-contained, assign a realistic mark value, and provide an appropriate model answer, response plan, or worked solution based on the improved response. Do not copy source wording or reproduce proprietary exam material. Return every source id exactly once. Records: ${JSON.stringify(mistakeContext(batch, attempts))}`,
    })
    const cards = (await result.output).cards
    const returnedIds = new Set(cards.map((card) => card.sourceMistakeId))
    if (cards.length !== sourceIds.length || returnedIds.size !== sourceIds.length || sourceIds.some((id) => !returnedIds.has(id))) {
      throw new Error("ChatGPT did not create one alternative for every mistake. Try generating the deck again.")
    }
    generatedCards.push(...cards)
  }

  return generatedCards.map((card) => ({
    ...card,
    skill: card.skill.trim(),
    question: card.question.trim(),
    answer: card.answer.trim(),
  }))
}

export async function analyseMistakes(mistakes: Mistake[], attempts: ExamAttempt[], onProgress?: (progress: ChatGPTProgress) => void): Promise<MistakeInsights> {
  if (!mistakes.length) throw new Error("Log at least one mistake before generating insights.")
  onProgress?.({ phase: "connecting", tokens: 0, estimated: true, reasoning: false })
  const { chatgpt, model, settings } = await getChatGPTModel()
  const schema = jsonSchema<Omit<MistakeInsights, "generatedAt" | "practiceQuestions" | "questionsGeneratedAt">>({
    type: "object",
    additionalProperties: false,
    required: ["summary", "biggestErrors", "otherInsights", "nextStep"],
    properties: {
      summary: { type: "string" },
      biggestErrors: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "evidence", "action"],
          properties: {
            title: { type: "string" },
            evidence: { type: "string" },
            action: { type: "string" },
          },
        },
      },
      otherInsights: { type: "array", maxItems: 3, items: { type: "string" } },
      nextStep: { type: "string" },
    },
  })
  const result = streamText({
    model: chatgpt(model),
    output: Output.object({ schema, name: "mistake_insights" }),
    maxOutputTokens: 900,
    headers: { "x-login-with-chatgpt-reasoning-effort": settings.reasoningEffort },
    onChunk: createChatGPTProgressHandler(onProgress),
    prompt: `Analyse this student's logged mistakes. Identify the most important recurring knowledge or process gaps, cite concise evidence from the records, notice useful patterns such as subjects, marks, resolution or review history, and give one practical next step. Do not claim a pattern unless the records support it. Use concise student-friendly plain text. Records: ${JSON.stringify(mistakeContext(mistakes, attempts))}`,
  })
  return { ...await result.output, generatedAt: new Date().toISOString() }
}

export async function generateMistakePracticeQuestions(insights: MistakeInsights, mistakes: Mistake[], attempts: ExamAttempt[], onProgress?: (progress: ChatGPTProgress) => void) {
  onProgress?.({ phase: "connecting", tokens: 0, estimated: true, reasoning: false })
  const { chatgpt, model, settings } = await getChatGPTModel()
  const schema = jsonSchema<{ practiceQuestions: string }>({
    type: "object",
    additionalProperties: false,
    required: ["practiceQuestions"],
    properties: {
      practiceQuestions: { type: "string", description: "A Markdown worksheet with 4-6 original subject-appropriate questions or tasks, followed by a separate model answer section; use LaTeX only where useful" },
    },
  })
  const { practiceQuestions: _oldQuestions, questionsGeneratedAt: _oldQuestionsGeneratedAt, ...diagnosis } = insights
  const result = streamText({
    model: chatgpt(model),
    output: Output.object({ schema, name: "practice_questions" }),
    maxOutputTokens: 1400,
    headers: { "x-login-with-chatgpt-reasoning-effort": settings.reasoningEffort },
    onChunk: createChatGPTProgressHandler(onProgress),
    prompt: `Create 4-6 original, subject-appropriate practice questions or tasks that directly target these diagnosed gaps. Use Markdown and use valid LaTeX only when mathematical or scientific notation needs it. Do not copy the logged material. Order the tasks from easier to harder, include marks, then put model answers, response plans, or worked solutions in a separate section as appropriate to each subject. Insights: ${JSON.stringify(diagnosis)}. Records: ${JSON.stringify(mistakeContext(mistakes, attempts))}`,
  })
  return (await result.output).practiceQuestions.trim()
}

export async function analyseMistakeImages(
  files: File[],
  attempts: ExamAttempt[],
  selectedAttemptId: string,
  studies: VcaaStudyResources[],
  onProgress?: (progress: ChatGPTProgress) => void,
): Promise<MistakeDraft> {
  const validationError = validateMistakeImages(files)
  if (validationError) throw new Error(validationError)
  const selectedAttempt = attempts.find((attempt) => attempt.id === selectedAttemptId)
  if (!selectedAttempt) throw new Error("Choose the exam first so ChatGPT can use the correct paper.")
  const examPdf = findVcaaExamForAttempt(selectedAttempt, studies)
  if (selectedAttempt.provider.trim().toLowerCase() === "vcaa" && !examPdf) {
    throw new Error("This attempt could not be matched to an exam PDF in the VCAA library.")
  }

  onProgress?.({ phase: "connecting", tokens: 0, estimated: true, reasoning: false })
  const { chatgpt, model, settings } = await getChatGPTModel()

  const mistakeProperties = {
    attemptId: { type: "string", enum: ["", ...attempts.map((attempt) => attempt.id)] },
    question: { type: "string", description: "Short item identifier, such as Section B Question 4, Essay 1, or Task 2" },
    questionText: { type: "string", description: "A fully self-contained version of the complete question or task, including every stem, source, stimulus, diagram, table, definition and referenced context needed to answer it, in Markdown with LaTeX only where useful" },
    category: { type: "string", enum: [...MISTAKE_CATEGORIES] },
    explanation: { type: "string", description: "What the student did wrong, in concise Markdown with LaTeX where useful" },
    correction: { type: "string", description: "The improved response, evidence, structure, reasoning, or method, in concise Markdown with LaTeX only where useful" },
    areaOfStudy: { type: "string", description: "A concise topic, skill, or Area of Study, or an empty string if it cannot be determined" },
    criterion: { type: "string", description: "A concise assessment criterion, or an empty string if it cannot be determined" },
    totalMarks: { type: "number", exclusiveMinimum: 0, description: "Total marks available for the item; infer from the paper or image" },
    marksLost: { type: "number", minimum: 0, description: "Marks the student lost; infer from annotations or the recorded score and never exceed totalMarks" },
  } as const
  const mistakeRequired = ["attemptId", "question", "questionText", "category", "explanation", "correction", "areaOfStudy", "criterion", "totalMarks", "marksLost"]
  const mistakeSchema = jsonSchema<MistakeDraft>({
    type: "object",
    additionalProperties: false,
    required: mistakeRequired,
    properties: mistakeProperties,
  })
  const examOptions = attempts.map(({ id, subject, provider, title, examYear, paper }) => ({
    id, subject, provider, title, examYear, paper,
  }))

  const imageParts = await Promise.all(files.map(async (file) => ({
    type: "image" as const,
    image: await file.arrayBuffer(),
    mediaType: file.type,
  })))
  let streamError: unknown
  const result = streamText({
    model: chatgpt(model),
    output: Output.object({ schema: mistakeSchema, name: "mistake_log" }),
    maxOutputTokens: 1200,
    headers: { "x-login-with-chatgpt-reasoning-effort": settings.reasoningEffort },
    onChunk: createChatGPTProgressHandler(onProgress),
    onError: ({ error }) => { streamError = error },
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: `Read all attached images of the student's question or task, response, annotations, and feedback. The selected logged exam is ${JSON.stringify(selectedAttempt)}. ${examPdf ? "The attached official VCAA exam PDF is the source of truth: locate the exact item there and use it to restore anything cropped or omitted from the images." : "No official exam PDF is available, so use only the supplied images."} Fill every field for a study mistake log for this subject. questionText must stand alone without the original paper: include the full stem plus all sources, stimuli, diagrams, tables, definitions, subpart dependencies and other referenced context; describe non-text visuals precisely when needed. Never leave phrases such as 'using the information above' without including that information. Keep the explanation diagnostic and the correction actionable, preserve notation as Markdown LaTeX only where appropriate, use an exact schema category, and use 'Item unclear' instead of inventing an unreadable label. Available logged exams: ${JSON.stringify(examOptions)}.`,
        },
        ...(examPdf ? [{ type: "file" as const, data: new URL(examPdf.url), mediaType: "application/pdf", filename: examPdf.label }] : []),
        ...imageParts,
      ],
    }],
  })

  let draft: MistakeDraft
  try {
    draft = await result.output
  } catch (error) {
    const cause = streamError ?? error
    throw new Error(formatMistakeAIError(cause), { cause })
  }
  if (!draft.question.trim() || !draft.questionText.trim() || !draft.explanation.trim() || !draft.correction.trim()) {
    throw new Error("ChatGPT could not read enough of the supplied context to fill the mistake.")
  }
  return {
    ...draft,
    question: draft.question.trim(),
    questionText: draft.questionText.trim(),
    explanation: draft.explanation.trim(),
    correction: draft.correction.trim(),
    areaOfStudy: draft.areaOfStudy.trim(),
    criterion: draft.criterion.trim(),
  }
}

export function orderMistakeBatchDrafts(drafts: IndexedMistakeDraft[], imageCount: number): MistakeDraft[] {
  const byIndex = new Map(drafts.map((draft) => [draft.imageIndex, draft]))
  if (drafts.length !== imageCount || byIndex.size !== imageCount || Array.from({ length: imageCount }, (_, index) => index).some((index) => !byIndex.has(index))) {
    throw new Error("ChatGPT did not create one mistake for every image. Try the batch import again.")
  }
  return Array.from({ length: imageCount }, (_, imageIndex) => {
    const draft = byIndex.get(imageIndex)!
    if (!draft.question.trim() || !draft.questionText.trim() || !draft.explanation.trim() || !draft.correction.trim()) {
      throw new Error(`ChatGPT could not read enough of image ${imageIndex + 1} to fill its mistake.`)
    }
    if (draft.totalMarks <= 0 || draft.marksLost < 0 || draft.marksLost > draft.totalMarks) {
      throw new Error(`ChatGPT returned invalid marks for image ${imageIndex + 1}. Try the batch import again.`)
    }
    return {
      ...draft,
      question: draft.question.trim(),
      questionText: draft.questionText.trim(),
      explanation: draft.explanation.trim(),
      correction: draft.correction.trim(),
      areaOfStudy: draft.areaOfStudy.trim(),
      criterion: draft.criterion.trim(),
    }
  })
}

export async function analyseMistakeImageBatch(
  files: File[],
  attempts: ExamAttempt[],
  selectedAttemptId: string,
  studies: VcaaStudyResources[],
  onProgress?: (progress: ChatGPTProgress) => void,
): Promise<MistakeDraft[]> {
  const validationError = validateMistakeBatchImages(files)
  if (validationError) throw new Error(validationError)
  const drafts: MistakeDraft[] = []
  for (const [index, file] of files.entries()) {
    try {
      const draft = await analyseMistakeImages([file], attempts, selectedAttemptId, studies, (progress) => {
        onProgress?.({ ...progress, itemIndex: index + 1, itemCount: files.length })
      })
      drafts.push({ ...draft, attemptId: selectedAttemptId })
    } catch (error) {
      throw new Error(`Question ${index + 1}: ${formatMistakeAIError(error)}`, { cause: error })
    }
  }
  return drafts
}
