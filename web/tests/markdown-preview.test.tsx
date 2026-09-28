import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MarkdownPreview } from "../src/components/markdown-preview"

test("renders Markdown with valid math and keeps invalid LaTeX non-fatal", () => {
  const valid = renderToStaticMarkup(<MarkdownPreview>Use $x^2$ here.</MarkdownPreview>)
  expect(valid).toContain("katex")
  expect(valid).toContain("x")

  expect(() => renderToStaticMarkup(<MarkdownPreview>{"Broken $\\notacommand{$"}</MarkdownPreview>)).not.toThrow()
})

test("renders LaTeX parenthesis and bracket delimiters", () => {
  const markup = renderToStaticMarkup(
    <MarkdownPreview>{"Inline \\(f(x)=x^{1/3}\\) and display \\[x^2+1\\]"}</MarkdownPreview>,
  )

  expect(markup).toContain("katex")
  expect(markup).not.toContain("\\(f(x)")
  expect(markup).not.toContain("\\[x^2")
  expect(markup).not.toContain("$$")
})

test("keeps a mid-sentence bracket expression inline and inside its paragraph", () => {
  const markup = renderToStaticMarkup(
    <MarkdownPreview>{"Rearrange to \\[x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\\] then substitute."}</MarkdownPreview>,
  )

  expect(markup).not.toContain("katex-display")
  expect(markup).toContain("mfrac")
  expect(markup).toContain("Rearrange to")
  expect(markup).toContain("then substitute.")
  // A block node here would have split the sentence into two paragraphs.
  expect(markup.match(/<p[ >]/g)?.length).toBe(1)
})

test("typesets a block display expression on its own line", () => {
  const markup = renderToStaticMarkup(
    <MarkdownPreview>{"Working:\n\n\\[ \\int_0^1 x^2\\,dx = \\frac{1}{3} \\]"}</MarkdownPreview>,
  )

  expect(markup).toContain("katex-display")
  expect(markup).toContain("msubsup")
  expect(markup).toContain("mfrac")
})

test("never leaves a display block inside an inline span", () => {
  const markup = renderToStaticMarkup(
    <MarkdownPreview inline>{"As shown \\[x^2+1\\] and $y = 2$."}</MarkdownPreview>,
  )

  expect(markup).toContain("katex")
  expect(markup).not.toContain("katex-display")
  expect(markup).not.toContain("$$")
})

test("renders inline assessment criteria without the preview card", () => {
  const markup = renderToStaticMarkup(<MarkdownPreview inline>{"Use $x^2$ correctly."}</MarkdownPreview>)
  expect(markup).toContain("katex")
  expect(markup).not.toContain("rounded-lg")
})

test("renders compact mistake-card LaTeX with set notation and fractions", () => {
  const markup = renderToStaticMarkup(
    <MarkdownPreview inline>{"$f:\\mathbb{R}\\to\\mathbb{R}$, where $\\displaystyle f(x)=\\frac{1}{27}(ax-1)^3(b-3x)+1$."}</MarkdownPreview>,
  )

  expect(markup).toContain("katex")
  expect(markup).toContain("mathbb")
  expect(markup).toContain("mfrac")
  expect(markup).not.toContain("$f:")
})
