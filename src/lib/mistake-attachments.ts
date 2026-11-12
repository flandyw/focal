import type { MistakeAttachment } from "./exam-data"
import { supabase } from "./supabase"
import { MISTAKE_ATTACHMENTS_BUCKET, EXTENSIONS, validateSavedMistakeImages } from "./mistake-attachment-validation"
export { validateSavedMistakeImages } from "./mistake-attachment-validation"

function buildMistakeAttachmentPath(userId: string, mistakeId: string, attachmentId: string, type: string) {
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
