import { spawnSync } from "node:child_process"

const checks = [
  "scripts/check-version.mjs",
  "scripts/check-material-theme.ts",
  "scripts/check-chatgpt.ts",
  "scripts/check-chatgpt-local.mjs",
  "scripts/check-diagnostics.ts",
  "scripts/check-storage-records.mjs",
  "scripts/check-app-navigation.ts",
  "scripts/check-ui-navigation.ts",
  "scripts/check-examtrack-integration.ts",
  "scripts/check-text-event-planner.mjs",
  "scripts/check-study-session-v2.ts",
  "scripts/check-timetable-reorder.ts",
  "scripts/check-timetable.ts",
  "scripts/check-study-timer.mjs",
  "scripts/check-lib-helpers.ts",
  "scripts/check-vce-prep.ts",
  "scripts/check-repeat-planning-item.ts",
  "scripts/check-dashboard-study-summary.ts",
  "scripts/check-analytics-completion.ts",
  "scripts/check-backup-import.ts",
  "scripts/check-calendar-events.mjs",
  "scripts/check-notion-sync.ts",
  "scripts/check-file-metadata.ts",
  "scripts/ai-assistant-event-tool-self-check.ts",
  "scripts/ollama-structured-output-self-check.ts",
  "scripts/ollama-tool-calling-self-check.ts",
  "scripts/sync-self-check.ts",
  "scripts/text-event-planner-self-check.ts",
]

for (const check of checks) {
  const result = spawnSync(process.execPath, [check], { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`All ${checks.length} logic checks passed`)
