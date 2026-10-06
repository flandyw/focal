import { useEffect, useState } from "react"
import { ImageIcon } from "lucide-react"
import type { MistakeAttachment } from "../lib/exam-data"
import { createMistakeAttachmentUrls } from "../lib/mistake-attachments"

export function MistakeAttachments({ attachments }: { attachments?: MistakeAttachment[] }) {
  const pathKey = attachments?.map(({ storagePath }) => storagePath).join("\u0000") ?? ""
  const [result, setResult] = useState<{ pathKey: string; urls?: Record<string, string>; failed?: boolean }>({ pathKey: "" })
  const currentResult = result.pathKey === pathKey ? result : undefined

  useEffect(() => {
    let cancelled = false
    const paths = pathKey ? pathKey.split("\u0000") : []
    if (!paths.length) return
    createMistakeAttachmentUrls(paths)
      .then((items) => {
        if (!cancelled) setResult({ pathKey, urls: Object.fromEntries(items.map((item) => [item.path, item.signedUrl])) })
      })
      .catch(() => {
        if (!cancelled) setResult({ pathKey, failed: true })
      })
    return () => { cancelled = true }
  }, [pathKey])

  if (!attachments?.length) return null
  if (currentResult?.failed) return <p className="text-xs text-muted-foreground">Saved images could not be loaded.</p>

  return (
    <div aria-label="Question images" className="my-3 grid grid-cols-1 gap-3">
      {attachments.map((attachment) => currentResult?.urls?.[attachment.storagePath] ? (
        <a key={attachment.id} href={currentResult.urls[attachment.storagePath]} target="_blank" rel="noopener noreferrer" className="overflow-hidden rounded-lg border bg-muted/30" title={attachment.name}>
          <img src={currentResult.urls[attachment.storagePath]} alt={attachment.name || "Question image"} className="h-auto max-h-[70vh] w-full object-contain" />
        </a>
      ) : (
        <div key={attachment.id} className="flex h-32 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground"><ImageIcon className="size-5" /></div>
      ))}
    </div>
  )
}
