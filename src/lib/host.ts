import { toast } from "sonner"

// Native hosts supply file dialogs; standalone web keeps browser downloads.
export const examHost: {
  studySessions?: () => Promise<import("./types").StudySession[]>
  download?: (blob: Blob, name: string) => Promise<boolean>
  report?: (html: string) => Promise<void>
} = {}

// ChatGPT analysis uses the desktop sidecar; Gateway chat has its own authenticated server endpoint.
export const AI_ENABLED = Boolean(import.meta.env.VITE_DESKTOP)

const CHATGPT_BASE_PATH = import.meta.env.VITE_CHATGPT_BASE_PATH?.trim().replace(/\/+$/, "")
  ?? (AI_ENABLED ? "http://localhost:41731/api/chatgpt" : "/api/chatgpt")
export const CHATGPT_ENDPOINT = CHATGPT_BASE_PATH
export const MISTAKES_PDF_ENDPOINT = CHATGPT_BASE_PATH.replace(/\/chatgpt$/, "/mistakes-pdf")

export async function downloadExamFile(blob: Blob, name: string) {
  try {
    if (examHost.download) return await examHost.download(blob, name)
    // `<a download>` does nothing in an installed iPhone app; the share sheet reaches Files, Mail and AirDrop on any phone.
    const file = new File([blob], name, { type: blob.type })
    if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        return true
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return false
        // Sharing lost its user activation to slow file generation; the plain download below still works there.
      }
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not save the file.")
    return false
  }
}
