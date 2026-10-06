import { toast } from "sonner"

// Native hosts supply file dialogs; standalone web keeps browser downloads.
export const examHost: {
  studySessions?: () => Promise<import("./types").StudySession[]>
  download?: (blob: Blob, name: string) => Promise<boolean>
  report?: (html: string) => Promise<void>
} = {}

// AI features run only inside the desktop app, which hosts the local Sign in with ChatGPT service.
export const AI_ENABLED = Boolean(import.meta.env.VITE_EMBEDDED_EXAMS)

const CHATGPT_BASE_PATH = import.meta.env.VITE_CHATGPT_BASE_PATH?.trim().replace(/\/+$/, "")
  ?? (AI_ENABLED ? "http://localhost:41731/api/chatgpt" : "/api/chatgpt")
export const CHATGPT_ENDPOINT = CHATGPT_BASE_PATH
export const MISTAKES_PDF_ENDPOINT = CHATGPT_BASE_PATH.replace(/\/chatgpt$/, "/mistakes-pdf")

export async function downloadExamFile(blob: Blob, name: string) {
  try {
    if (examHost.download) return await examHost.download(blob, name)
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
