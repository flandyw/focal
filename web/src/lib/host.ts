import { toast } from "sonner"

// Native hosts supply file dialogs; standalone web keeps browser downloads.
export const examHost: {
  download?: (blob: Blob, name: string) => Promise<boolean>
  report?: (html: string) => Promise<void>
} = {}

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
