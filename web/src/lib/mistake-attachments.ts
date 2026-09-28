import type { MistakeAttachment } from "@/lib/exam-data"
import { supabase } from "@/lib/supabase"

export const MISTAKE_ATTACHMENTS_BUCKET = "mistake-attachments"
export const MAX_MISTAKE_ATTACHMENTS = 5
export const MAX_MISTAKE_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_MISTAKE_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}

export function validateSavedMistakeImages(files: Pick<File, "size" | "type">[], existingCount = 0, existingBytes = 0): string | null {
  if (existingCount + files.length > MAX_MISTAKE_ATTACHMENTS) return `Save no more than ${MAX_MISTAKE_ATTACHMENTS} images with a mistake.`
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) return "Saved images must be JPEG, PNG, WebP, or GIF files."
    if (file.size > MAX_MISTAKE_ATTACHMENT_BYTES) return "Each saved image must be 5 MB or smaller."
  }
  if (existingBytes + files.reduce((total, file) => total + file.size, 0) > MAX_MISTAKE_ATTACHMENTS_TOTAL_BYTES) return "Saved images must total 20 MB or less."
  return null
}

export function buildMistakeAttachmentPath(userId: string, mistakeId: string, attachmentId: string, type: string) {
  return `${userId}/${mistakeId}/${attachmentId}.${EXTENSIONS[type] ?? "img"}`
}

export async function uploadMistakeAttachments(userId: string, mistakeId: string, files: File[]): Promise<MistakeAttachment[]> {
  if (!supabase) throw new Error("Supabase sync is not configured.")
  const validationError = validateSavedMistakeImages(files)
  if (validationError) throw new Error(validationError)
  const uploadedPaths: string[] = []
  try {
    const attachments: MistakeAttachment[] = []
    for (const file of files) {
      const id = crypto.randomUUID()
      const path = buildMistakeAttachmentPath(userId, mistakeId, id, file.type)
      const { error } = await supabase.storage.from(MISTAKE_ATTACHMENTS_BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false,
      })
      if (error) throw error
      uploadedPaths.push(path)
      attachments.push({ id, name: file.name, type: file.type, size: file.size, storagePath: path })
    }
    return attachments
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from(MISTAKE_ATTACHMENTS_BUCKET).remove(uploadedPaths)
    throw error
  }
}

export async function removeMistakeAttachments(paths: string[]) {
  if (!supabase || !paths.length) return
  const { error } = await supabase.storage.from(MISTAKE_ATTACHMENTS_BUCKET).remove(paths)
  if (error) throw error
}

export async function createMistakeAttachmentUrls(paths: string[]) {
  if (!supabase || !paths.length) return []
  const { data, error } = await supabase.storage.from(MISTAKE_ATTACHMENTS_BUCKET).createSignedUrls(paths, 60 * 60)
  if (error) throw error
  return data.map((item) => ({ path: item.path, signedUrl: item.signedUrl }))
}
