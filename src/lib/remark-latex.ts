/// <reference types="micromark-extension-math" />
/// <reference types="remark-parse" />
import type { Root } from "mdast"
import type { State, Tokenizer } from "micromark-util-types"
import type { Plugin } from "unified"

// Extend remark-math's tokens: Markdown still owns code, escapes and link URLs.
const tokenize: Tokenizer = function (effects, ok, nok) {
  let closing: number
  let inData = false
  function endData() {
    if (inData) effects.exit("mathTextData")
    inData = false
  }
  const start: State = (code) => {
    effects.enter("mathText")
    effects.enter("mathTextSequence")
    effects.consume(code)
    return open
  }
  const open: State = (code) => {
    if (code !== 40 && code !== 91) return nok(code)
    closing = code === 40 ? 41 : 93
    effects.consume(code)
    effects.exit("mathTextSequence")
    return content
  }
  const content: State = (code) => {
    if (code === null) return nok(code)
    if (code === -5 || code === -4 || code === -3) {
      endData()
      effects.enter("lineEnding")
      effects.consume(code)
      effects.exit("lineEnding")
      return content
    }
    if (code === 92) return effects.check({ tokenize: close }, finish, escaped)(code)
    if (!inData) { effects.enter("mathTextData"); inData = true }
    effects.consume(code)
    return content
  }
  const escaped: State = (code) => {
    if (!inData) { effects.enter("mathTextData"); inData = true }
    effects.consume(code)
    return (next) => {
      if (next === null) return nok(next)
      if (next === -5 || next === -4 || next === -3) return content(next)
      effects.consume(next)
      return content
    }
  }
  const close: Tokenizer = (check, yes, no) => (code) => {
    check.enter("mathTextSequence")
    check.consume(code)
    return (next) => {
      if (next !== closing) return no(next)
      check.consume(next)
      check.exit("mathTextSequence")
      return yes
    }
  }
  const finish: State = (code) => {
    endData()
    effects.enter("mathTextSequence")
    effects.consume(code)
    return (next) => {
      effects.consume(next)
      effects.exit("mathTextSequence")
      effects.exit("mathText")
      return ok
    }
  }
  return start
}

export const remarkLatex: Plugin<[], Root> = function () {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push({ text: { 92: { name: "latexMath", tokenize } } })
  return (tree, file) => {
    const source = String(file)
    function visit(node: Root | Root["children"][number] | import("mdast").PhrasingContent) {
      const opening = source.slice(node.position?.start.offset, (node.position?.start.offset ?? 0) + 2)
      if (node.type === "inlineMath" && (opening === "\\[" || opening === "$$")) {
        node.data = { ...node.data, hProperties: { className: ["language-math", "math-display"] } }
      }
      if ("children" in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}
