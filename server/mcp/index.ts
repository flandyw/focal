import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { TIMETABLE_SCREENSHOT_PROMPT } from "../../src/lib/class-timetable"
import { buildProgressionPrompt } from "../../src/lib/exam-progression"
import { asUser, resolveToken } from "./store"
import { registerTools } from "./tools"

const INSTRUCTIONS = `Focal is a VCE (Victoria, Australia) study app: practice exams, mistakes with spaced repetition, SACs, calendar, study timer, stoplight skill checklists, goals and predictions.
Start with get_overview. Read get_capabilities for coverage and device-local limitations. export_app_data reads all synced fields, including historical subjects; list_app_records and edit_app_record provide validated, preview-first access to records without a convenience tool. Records are addressed by the ids that list_* tools return. Dates are YYYY-MM-DD in the account's local time zone; instants carry a UTC offset.
Use add_mistakes to record mistakes and update_mistake to edit them. Mistake difficulty is an optional integer from 1 (easy) to 5 (very hard); omit it when unknown. This is separate from recall ratings used by review_mistake.
Writes are applied to the same synced data the web and desktop apps use, so they appear there within seconds. Subjects are free text but should match the account's subject names (get_settings).`

export function createMcpServer() {
  const server = new McpServer({ name: "focal", version: "1.0.0" }, { instructions: INSTRUCTIONS })
  registerTools(server)
  const format = (name: string, uri: string, description: string, text: string) =>
    server.registerResource(name, uri, { description, mimeType: "text/plain" }, (url) => ({ contents: [{ uri: url.href, text }] }))
  format("timetable-format", "focal://formats/timetable", "Format for import_class_timetable (and how to extract it from a timetable screenshot).", TIMETABLE_SCREENSHOT_PROMPT)
  format("progression-format", "focal://formats/progression", "Format for import_exam_progression.", buildProgressionPrompt([], ""))
  registerPrompts(server)
  return server
}

/** Canned workflows so agents call the tools in the right order instead of reinventing it. */
function registerPrompts(server: McpServer) {
  const prompt = <S extends z.ZodRawShape>(name: string, description: string, args: S, body: (a: { [K in keyof S]: string | undefined }) => string) =>
    server.registerPrompt(name, { description, argsSchema: args }, ((a: unknown) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: body(a as never) } }] })) as never)
  const opt = (describe: string) => z.string().optional().describe(describe)

  prompt("daily_briefing", "Morning brief: today's plan, due reviews, upcoming SACs and VCE exams.", { date: opt("YYYY-MM-DD, default today") }, ({ date }) =>
    `Give me my Focal briefing for ${date ?? "today"}. Call get_overview, then get_day_plan${date ? ` for ${date}` : ""}, then list_mistakes with status "due" (compact), then get_practice_progress. Summarise in this order: the one thing to do first, the day's schedule, how many reviews are due (and which subjects), SACs/exams in the next 14 days with days to go, and today's practice quests. Keep it short. Do not write anything.`)

  prompt("log_paper", "Log a marked practice paper end to end: exam, mistakes, topics, stoplight links, analysis, revision plan.", {
    subject: opt("Subject name as in get_settings"), details: opt("Paper, marks, and what went wrong, in any form"),
  }, ({ subject, details }) =>
    `Log this marked paper${subject ? ` for ${subject}` : ""} in Focal.${details ? `\n\n${details}` : ""}
1. get_settings to match the subject name; ask for anything missing (provider, year, paper, raw score/max, date).
2. save_exam with questionResults when per-question marks are known. Read \`warnings\` and fix with save_exam (same id).
3. add_mistakes for every lost-mark question, with attemptId, topic, category, marks and difficulty when known.
4. backfill_topics (dry run), show me the preview, then apply only if I agree.
5. list_stoplight for the subject and link_to_stoplight the new mistakes and questions.
6. get_exam_analytics with subject, read dataQuality.warnings, and tell me what this paper changed.
7. Offer plan_revision.`)

  prompt("review_due_cards", "Quiz the due mistake cards one at a time with confidence calibration.", {
    subject: opt("Limit to one subject"), count: opt("How many cards, default 10"),
  }, ({ subject, count }) =>
    `Quiz me on my due Focal mistakes${subject ? ` for ${subject}` : ""}. Call get_practice_progress, then list_mistakes status "due"${subject ? ` subject "${subject}"` : ""}, compact false, limit ${count ?? "10"}. For each card, one at a time: show the question only, ask how confident I am (low/medium/high), wait for my answer, then reveal the correction, ask me to rate again/hard/good/easy and call review_mistake with the rating, confidence, and challenge true if the card is in this week's challenge. Share its feedback. End with how many I did and my calibration.`)

  prompt("weekly_review", "Look back over the week and plan the next one.", {}, () =>
    `Run my Focal weekly review. Call get_progress with range 7, list_exams (limit 10), get_exam_analytics, get_practice_progress, list_goals and list_stoplight. Report: study time vs the week before, papers done and marks, where marks were lost, calibration and rematches, goal gaps. Then propose next week's priorities (max 3) and offer plan_revision and plan_study_session for them. Write nothing until I agree.`)

  prompt("exam_week_plan", "Plan around upcoming exams: lighten reviews and fit study between papers.", { until: opt("Last exam date, YYYY-MM-DD") }, ({ until }) =>
    `Help me plan exam week in Focal. Call vce_exam_timetable and list_events to find my exams${until ? ` up to ${until}` : ""}, and get_settings. Propose: update_settings lighterUntil the last exam with a small lighterDailyTarget, reduce_review_load over the period, and a plan_study_session for each subject in the days before its exam (no sessions on exam mornings). Show the plan and write it only after I confirm.`)
}

/**
 * Stateless Streamable HTTP: a fresh server per request, nothing held between calls, so it runs anywhere
 * `fetch` does. The bearer token is a personal access token created in Focal's settings; the request runs as its owner.
 */
export async function handleMcp(request: Request): Promise<Response> {
  // The token is a bearer header, or the last URL segment (/mcp/<token>) for connectors that cannot send headers.
  const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? new URL(request.url).pathname.split("/")[2] ?? ""
  const unauthorized = (why: string) => { console.warn(`mcp 401: ${why}`); return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } }) }
  if (!token.startsWith("focal_")) return unauthorized(token ? "bearer token without focal_ prefix" : "no Bearer authorization header")
  let userId: string | null
  try { userId = await resolveToken(token) } catch (error) {
    console.error("mcp token lookup failed:", error instanceof Error ? error.message : "Unknown error")
    return new Response("Service unavailable", { status: 503 })
  }
  if (!userId) return unauthorized("unknown or revoked token")
  return asUser(userId, async () => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await createMcpServer().connect(transport)
    return transport.handleRequest(request)
  })
}
