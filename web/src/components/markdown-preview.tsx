import ReactMarkdown from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"
import "katex/dist/katex.min.css"
import { cn } from "@/lib/utils"

export function MarkdownPreview({ children, inline = false, unframed = false, className }: {
  children: string
  inline?: boolean
  unframed?: boolean
  className?: string
}) {
  const markdown = children
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => `$$\n${math}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math: string) => `$${math}$`)

  if (inline) {
    return (
      <span className={cn("typeset", className)}>
        <ReactMarkdown components={{ p: ({ children }) => <span>{children}</span> }} remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>
          {markdown}
        </ReactMarkdown>
      </span>
    )
  }

  return (
    <div className={cn("typeset typeset-mistake", !unframed && "rounded-lg border p-3", className)}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}>
        {markdown || "Preview appears here."}
      </ReactMarkdown>
    </div>
  )
}
