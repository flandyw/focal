import type { MistakeCategory } from "@/lib/exam-data"

const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_BATCH_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_BATCH_IMAGES = 10

export type MistakeDraft = {
  attemptId: string
  question: string
  questionText: string
  category: MistakeCategory
  explanation: string
  correction: string
  areaOfStudy: string
  criterion: string
  totalMarks: number
  marksLost: number
}

export type IndexedMistakeDraft = MistakeDraft & { imageIndex: number }

export type ChatGPTProgress = {
  phase: "connecting" | "thinking" | "writing" | "complete"
  tokens: number
  estimated: boolean
  reasoning: boolean
  itemIndex?: number
  itemCount?: number
}

type ProgressChunk = {
  type: string
  text?: string
  totalUsage?: {
    outputTokens?: number
    outputTokenDetails?: { reasoningTokens?: number }
  }
}

export function createChatGPTProgressHandler(onProgress?: (progress: ChatGPTProgress) => void) {
  let characters = 0
  let reasoning = false
  let phase: ChatGPTProgress["phase"] = "connecting"
  let last = ""
  return ({ chunk }: { chunk: ProgressChunk }) => {
    if (chunk.type === "reasoning-start" || chunk.type === "reasoning-delta") {
      phase = "thinking"
      reasoning = true
    } else if (chunk.type === "text-start" || chunk.type === "text-delta") {
      phase = "writing"
    }
    if ((chunk.type === "reasoning-delta" || chunk.type === "text-delta") && chunk.text) characters += chunk.text.length
    const finished = chunk.type === "finish"
    if (finished) {
      phase = "complete"
      reasoning ||= (chunk.totalUsage?.outputTokenDetails?.reasoningTokens ?? 0) > 0
    }
    const tokens = finished && chunk.totalUsage?.outputTokens !== undefined
      ? chunk.totalUsage.outputTokens
      : Math.ceil(characters / 4)
    const progress = { phase, tokens, estimated: !finished, reasoning }
    const key = JSON.stringify(progress)
    if (key !== last) onProgress?.(progress)
    last = key
  }
}

export function formatChatGPTProgress({ phase, tokens, estimated, reasoning, itemIndex, itemCount }: ChatGPTProgress) {
  const status = phase === "connecting" ? "Connecting to ChatGPT" : phase === "thinking" ? "ChatGPT is thinking" : phase === "writing" ? "ChatGPT is writing" : "ChatGPT finished"
  const item = itemIndex && itemCount ? `Question ${itemIndex} of ${itemCount} · ` : ""
  return `${item}${status} · ${estimated && tokens ? "~" : ""}${tokens} streamed tokens${reasoning ? " · reasoning detected" : ""}`
}

export function validateMistakeImage(file: Pick<File, "size" | "type">): string | null {
  if (!file.type.startsWith("image/")) return "Choose an image file."
  if (file.size > MAX_IMAGE_BYTES) return "Choose an image smaller than 3 MB."
  return null
}

export function validateMistakeImages(files: Pick<File, "size" | "type">[]): string | null {
  if (!files.length) return "Choose at least one image."
  for (const file of files) {
    const error = validateMistakeImage(file)
    if (error) return error
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_IMAGE_BYTES) return "Choose images totalling less than 3 MB."
  return null
}

export function validateMistakeBatchImages(files: Pick<File, "size" | "type">[]): string | null {
  if (!files.length) return "Choose at least one image."
  if (files.length < 2) return "Choose at least two images for a batch import."
  if (files.length > MAX_BATCH_IMAGES) return `Choose no more than ${MAX_BATCH_IMAGES} images at once.`
  for (const file of files) {
    const error = validateMistakeImage(file)
    if (error) return error
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_IMAGE_BYTES) return "Choose images totalling less than 15 MB."
  return null
}
