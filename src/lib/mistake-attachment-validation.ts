export const MISTAKE_ATTACHMENTS_BUCKET = "mistake-attachments"
const MAX_MISTAKE_ATTACHMENTS = 5
const MAX_MISTAKE_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_MISTAKE_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
export const EXTENSIONS: Record<string, string> = {
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

