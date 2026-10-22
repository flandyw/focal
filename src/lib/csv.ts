/** Spreadsheet exports treat formula-looking text as text; keep numeric cells numeric. */
export function csvCell(value: unknown): string {
  let text = String(value ?? "")
  if (typeof value === "string" && /^\s*[=+\-@＝＋－＠]/.test(text)) text = `\t${text}`
  return `"${text.replaceAll('"', '""')}"`
}
