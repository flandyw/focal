import ReactMarkdown from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"
import { cn } from "@/lib/utils"

// \[...\] is display maths in LaTeX, but only when it owns its lines. Mid-paragraph
// it has to stay inline, otherwise remark-math opens a block node inside a
// paragraph and the sentence around it is swallowed.
function normaliseMathDelimiters(source: string, forceInline = false) {
  const markdown = source
    .replace(/^[ \t]*\\\[([\s\S]*?)\\\][ \t]*$/gm, (_match, math: string) => `$$\n${math.trim()}\n$$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => `$${math}$`)
  // Inline contexts render inside a <span>, where a block-level .katex-display
  // would break the line box.
  return forceInline ? markdown.replace(/\$\$([\s\S]*?)\$\$/g, (_match, math: string) => `$${math}$`) : markdown
}

export function MarkdownPreview({ children, inline = false, unframed = false, className }: {
  children: string
  inline?: boolean
  unframed?: boolean
  className?: string
}) {
  const markdown = normaliseMathDelimiters(children, inline)

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
