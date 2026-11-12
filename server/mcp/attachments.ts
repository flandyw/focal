import { z } from "zod"
import { MISTAKE_ATTACHMENTS_BUCKET, EXTENSIONS, validateSavedMistakeImages } from "../../src/lib/mistake-attachment-validation.js"
import { connect, readAll, updateApp } from "./store.js"
import type { Define } from "./tools.js"
import { nowIso, required } from "./util.js"

export function attachmentTools(define: Define) {
  define("get_mistake_attachments", "Get a mistake's saved images with private download URLs valid for one hour. Treat URLs as sensitive.", { id: z.string() }, "read", async ({ id }) => {
    const mistake = required((await readAll()).data.mistakes.find((item) => item.id === id), "mistake")
    const { sb, userId } = await connect()
    const attachments = mistake.attachments ?? []
    if (attachments.some((item) => !item.storagePath.startsWith(`${userId}/`))) throw new Error("Attachment account mismatch.")
    if (!attachments.length) return []
    const { data, error } = await sb.storage.from(MISTAKE_ATTACHMENTS_BUCKET).createSignedUrls(attachments.map((item) => item.storagePath), 3600)
    if (error) throw new Error(error.message)
    return attachments.map((item, index) => ({ ...item, signedUrl: data[index]?.signedUrl, error: data[index]?.error }))
  })

  define("add_mistake_attachment", "Upload a JPEG, PNG, WebP or GIF from base64 to a mistake (5 MB each, 5 images and 20 MB total per mistake).", {
    id: z.string(), name: z.string().trim().min(1).max(255), type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
    base64: z.string().min(4).max(6_990_508).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }, "write", async ({ id, name, type, base64 }) => {
    const bytes = Buffer.from(base64, "base64")
    const attachmentId = crypto.randomUUID()
    const { sb, userId } = await connect()
    const attachment = { id: attachmentId, name, type, size: bytes.length, storagePath: `${userId}/${id}/${attachmentId}.${EXTENSIONS[type]}` }
    const check = (attachments: { size: number }[]) => {
      const error = validateSavedMistakeImages([attachment], attachments.length, attachments.reduce((sum, item) => sum + item.size, 0))
      if (error) throw new Error(error)
    }
    check(required((await readAll()).data.mistakes.find((item) => item.id === id), "mistake").attachments ?? [])
    const { error } = await sb.storage.from(MISTAKE_ATTACHMENTS_BUCKET).upload(attachment.storagePath, bytes, { contentType: type, upsert: false })
    if (error) throw new Error(error.message)
    const at = nowIso()
    // ponytail: keep uploaded bytes on an uncertain sync failure; deleting them could break a write that reached the server.
    await updateApp((data) => {
      const mistake = required(data.mistakes.find((item) => item.id === id), "mistake")
      check(mistake.attachments ?? [])
      return { ...data, mistakes: data.mistakes.map((item) => item.id === id ? { ...item, attachments: [...(item.attachments ?? []), attachment], updatedAt: at } : item) }
    })
    return attachment
  })

  define("remove_mistake_attachment", "Remove an image from a mistake. Stored bytes are retained so concurrent readers do not lose their file.", { id: z.string(), attachmentId: z.string() }, "delete", async ({ id, attachmentId }) => {
    const at = nowIso()
    await updateApp((data) => {
      const mistake = required(data.mistakes.find((item) => item.id === id), "mistake")
      required(mistake.attachments?.find((item) => item.id === attachmentId), "attachment")
      return { ...data, mistakes: data.mistakes.map((item) => item.id === id ? { ...item, attachments: item.attachments?.filter((file) => file.id !== attachmentId), updatedAt: at } : item) }
    })
  })
}
