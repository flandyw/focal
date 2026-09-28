import {
  analyseAttempt,
  findAttemptReferenceForYear,
  getDueMistakes,
  type AppData,
  type AssessmentReference,
  type ExamAttempt,
} from "@/lib/exam-data"
import { getMistakeProgress } from "@/lib/mistake-review"
import { buildFocusPriorities, type FocusPriority } from "@/lib/performance-insights"
import { weightedPerformanceAverage, type ExamDifficultySettings } from "@/lib/exam-difficulty"

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value)}%`
}

type ReportRow = {
  attempt: ExamAttempt
  mark: string
  percentage: number
  comparison: string
}

function buildAttemptRows(attempts: ExamAttempt[], references: AssessmentReference[]): ReportRow[] {
  return [...attempts]
    .toSorted((first, second) => second.completedAt.localeCompare(first.completedAt))
    .slice(0, 12)
    .map((attempt) => {
      const reference = findAttemptReferenceForYear(attempt, references, attempt.examYear)
      const analysis = reference ? analyseAttempt(attempt, reference) : null
      const comparison = !reference
        ? "No official data"
        : [
            analysis?.grade ? `Grade ${analysis.grade}` : null,
            analysis?.percentile !== null && analysis?.percentile !== undefined ? `${analysis.percentile}th percentile` : null,
          ].filter(Boolean).join(" · ") || "Official data available"
      return {
        attempt,
        mark: `${attempt.rawScore}/${attempt.rawMax}`,
        percentage: attempt.rawMax > 0 ? (attempt.rawScore / attempt.rawMax) * 100 : 0,
        comparison,
      }
    })
}

function buildReportHtml(data: AppData, references: AssessmentReference[], difficulty?: ExamDifficultySettings) {
  const progress = getMistakeProgress(data.mistakes)
  const dueNow = getDueMistakes(data.mistakes).length
  const average = weightedPerformanceAverage(data.attempts, difficulty)
  const priorities: FocusPriority[] = buildFocusPriorities(data.attempts, data.mistakes).slice(0, 5)
  const rows = buildAttemptRows(data.attempts, references)
  const generatedAt = new Date().toLocaleString("en-AU", { dateStyle: "long", timeStyle: "short" })

  const overview = [
    ["Exams logged", String(data.attempts.length)],
    ["Weighted average", formatPercent(average)],
    ["Mistake mastery", progress.activeCards ? `${Math.round(progress.masteryPercent)}%` : "—"],
    ["Mature cards", `${progress.matureCards}${progress.activeCards ? ` of ${progress.activeCards}` : ""}`],
    ["Cards due now", String(dueNow)],
  ]

  const statCells = overview.map(([label, value]) =>
    `<div class="stat"><p class="stat-value">${escapeHtml(value)}</p><p class="stat-label">${escapeHtml(label)}</p></div>`,
  ).join("")

  const attemptRows = rows.map(({ attempt, mark, percentage, comparison }) =>
    `<tr>
      <td>${escapeHtml(new Date(`${attempt.completedAt}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }))}</td>
      <td>${escapeHtml(attempt.subject)}</td>
      <td>${escapeHtml(attempt.paper)}</td>
      <td class="num">${escapeHtml(mark)} (${formatPercent(percentage)})</td>
      <td>${escapeHtml(comparison)}</td>
    </tr>`,
  ).join("")

  const priorityRows = priorities.map((priority) =>
    `<tr>
      <td>${escapeHtml(priority.subject)}</td>
      <td>${escapeHtml(priority.areaOfStudy)}</td>
      <td class="num">${escapeHtml(String(priority.missedMarks))}</td>
      <td class="num">${escapeHtml(formatPercent(priority.mastery))}</td>
      <td class="num">${escapeHtml(String(priority.unresolvedMistakes))}</td>
    </tr>`,
  ).join("")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ExamTrack progress report</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 40px auto; max-width: 46rem; padding: 0 16px; color: #111; }
  h1 { font-size: 1.4rem; margin: 0; }
  h2 { font-size: 1rem; margin: 28px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
  p.meta { color: #666; font-size: 0.85rem; margin: 4px 0 20px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 12px; }
  .stat { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; }
  .stat-value { font-size: 1.25rem; font-weight: 600; margin: 0; }
  .stat-label { font-size: 0.75rem; color: #555; margin: 2px 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  footer { margin-top: 32px; font-size: 0.72rem; color: #777; }
  @media print { body { margin: 12mm auto; } .stat { break-inside: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<h1>ExamTrack progress report</h1>
<p class="meta">Generated ${escapeHtml(generatedAt)} · ${data.attempts.length} exam${data.attempts.length === 1 ? "" : "s"} · ${data.mistakes.length} mistake card${data.mistakes.length === 1 ? "" : "s"}</p>

<div class="stats">${statCells}</div>

<h2>Recent practice exams</h2>
${rows.length ? `<table>
  <thead><tr><th>Date</th><th>Subject</th><th>Paper</th><th class="num">Mark</th><th>VCAA comparison</th></tr></thead>
  <tbody>${attemptRows}</tbody>
</table>` : "<p>No exams logged yet.</p>"}

<h2>Focus areas</h2>
${priorityRows ? `<table>
  <thead><tr><th>Subject</th><th>Area of Study</th><th class="num">Marks missed</th><th class="num">Mastery</th><th class="num">Open mistakes</th></tr></thead>
  <tbody>${priorityRows}</tbody>
</table>` : "<p>Log question-level results and mistakes to see focus areas.</p>"}

<footer>Scores are self-reported practice results. VCAA comparisons use published grade distributions for the matching year; weighted averages align marks across papers using difficulty settings. Official data and estimates are shown separately.</footer>
</body>
</html>`
}

export function openProgressReport(data: AppData, references: AssessmentReference[], difficulty?: ExamDifficultySettings) {
  const html = buildReportHtml(data, references, difficulty)
  const windowHandle = window.open("", "_blank", "width=800,height=900")
  if (!windowHandle) throw new Error("Allow pop-ups to export the progress report.")
  windowHandle.document.write(html)
  windowHandle.document.close()
  windowHandle.focus()
  windowHandle.print()
}
