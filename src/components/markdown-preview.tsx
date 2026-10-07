import { memo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"
import type { Root, Element } from "hast"
import { remarkLatex } from "../lib/remark-latex"
import { cn } from "../lib/utils"

const components: Components = {
  pre: ({ node, children }) => {
    const code = node?.children[0]
    const source = code?.type === "element" && Array.isArray(code.properties.className) && code.properties.className.includes("language-svg")
      ? code.children.map((child) => child.type === "text" ? child.value : "").join("").trim() : ""
    if (!/^<svg[\s>]/i.test(source)) return <pre>{children}</pre>
    return <img alt="Diagram" loading="lazy" className="my-2 h-auto max-w-full rounded-md bg-white" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`} />
  },
}

// Inline previews must contain phrasing content, including lists and fenced maths.
function inlineContent() {
  return (tree: Root) => {
    function visit(node: Root | Element) {
      for (const child of node.children) {
        if (child.type !== "element") continue
        if (["p", "div", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr"].includes(child.tagName)) {
          child.tagName = "span"
          child.children.push({ type: "text", value: " " })
        }
        if (child.tagName === "a") { child.tagName = "span"; child.properties = {} }
        const classes = child.properties.className
        if (Array.isArray(classes) && classes.includes("language-math")) {
          child.properties.className = ["language-math", "math-inline"]
        }
        visit(child)
      }
    }
    visit(tree)
  }
}

const remarkPlugins = [remarkMath, remarkLatex]
const katexOptions = { trust: false, strict: "ignore", maxExpand: 1000, maxSize: 20 } as const

export const MarkdownPreview = memo(function MarkdownPreview({ children, inline = false, unframed = false, className }: {
  children: string
  inline?: boolean
  unframed?: boolean
  className?: string
}) {
  const Wrapper = inline ? "span" : "div"
  return (
    <Wrapper className={cn("typeset", inline ? "typeset-inline" : "typeset-mistake", !inline && !unframed && "rounded-lg border p-3", className)}>
      <ReactMarkdown components={components} remarkPlugins={remarkPlugins} rehypePlugins={inline ? [inlineContent, [rehypeKatex, katexOptions]] : [[rehypeKatex, katexOptions]]}>
        {children || (inline ? "" : "Preview appears here.")}
      </ReactMarkdown>
    </Wrapper>
  )
})
