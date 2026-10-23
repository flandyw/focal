import { useEffect, useRef, useState } from "react"
import { ImageIcon } from "lucide-react"
import type { MistakeAttachment } from "../lib/exam-data"
import { createMistakeAttachmentUrls } from "../lib/mistake-attachments"

function MistakeImage({ attachment, url }: { attachment: MistakeAttachment; url: string }) {
  const storageKey = `focal:mistake-image-width:v1:${attachment.id}`
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      if (Number.isFinite(saved) && saved >= 20 && saved <= 100) return saved
    } catch { /* Use full width when storage is unavailable. */ }
    return 100
  })
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ y: number; width: number; height: number } | null>(null)

  function resize(value: number) {
    const next = Math.max(20, Math.min(100, value))
    setWidth(next)
    try { localStorage.setItem(storageKey, String(next)) } catch { /* Resizing still works for this session. */ }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/30" style={{ width: `${width}%` }}>
      <a href={url} target="_blank" rel="noopener noreferrer" className="block" title={attachment.name}>
        <img ref={image} src={url} alt={attachment.name || "Question image"} draggable={false} className="block h-auto w-full" />
      </a>
      <button
        type="button"
        role="separator"
        aria-orientation="horizontal"
        aria-label={`Resize ${attachment.name || "question image"}`}
        aria-valuemin={20}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        aria-valuetext={`${Math.round(width)}% width`}
        title="Drag up or down to resize. Use the up and down arrow keys when focused."
        className="flex h-6 w-full touch-none cursor-row-resize items-center justify-center border-t select-none hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        onPointerDown={(event) => {
          if (event.button !== 0 || !image.current?.complete || !image.current.naturalHeight) return
          event.preventDefault()
          drag.current = { y: event.clientY, width, height: image.current.getBoundingClientRect().height }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (drag.current) resize(drag.current.width * (1 + (event.clientY - drag.current.y) / drag.current.height))
        }}
        onLostPointerCapture={() => { drag.current = null }}
        onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
          event.preventDefault()
          resize(event.key === "Home" ? 20 : event.key === "End" ? 100 : width + (event.key === "ArrowDown" ? 5 : -5))
        }}
      ><span aria-hidden="true" className="h-1 w-8 rounded-full bg-muted-foreground/50" /></button>
    </div>
  )
}

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
    <div aria-label="Question images" className="my-3 grid min-w-0 grid-cols-1 justify-items-start gap-3">
      {attachments.map((attachment) => currentResult?.urls?.[attachment.storagePath] ? (
        <MistakeImage key={attachment.id} attachment={attachment} url={currentResult.urls[attachment.storagePath]} />
      ) : (
        <div key={attachment.id} className="flex h-32 w-full items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground"><ImageIcon className="size-5" /></div>
      ))}
    </div>
  )
}
