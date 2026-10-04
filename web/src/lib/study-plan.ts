import { createChatGPTProxyProvider } from "@opencoredev/loginwithchatgpt-ai"
import { jsonSchema, Output, streamText } from "ai"

import { pickPlannerModel } from "./ai-settings"
import { clampLongBreakInterval, clampMinutes, formatFocusTime, type TimerSettings } from "./study-timer"

export const MAX_INTENT_LENGTH = 120
export const MAX_SUBJECT_LENGTH = 60
export const MAX_BLOCKS = 12

export interface StudyPlan {
  subject: string
  intent: string
  workMinutes: number
  breakMinutes: number
  longBreakMinutes: number
  longBreakEvery: number
  blocks: number
  summary: string
  startNow: boolean
}

export interface PlanContext {
  now: Date
  subjects: string[]
  settings: TimerSettings
  blocksToday: number
  timer: { running: boolean; mode: string; minutesLeft: number }
}

const SCHEMA = jsonSchema<StudyPlan>({
  type: "object",
  additionalProperties: false,
  required: ["subject", "intent", "workMinutes", "breakMinutes", "longBreakMinutes", "longBreakEvery", "blocks", "summary", "startNow"],
  properties: {
    subject: { type: "string", description: "The study subject, reusing one of the student's subjects when the request matches one" },
    intent: { type: "string", description: "What the student will do in the session, as one short imperative line of at most 120 characters" },
    workMinutes: { type: "integer", minimum: 1, maximum: 180, description: "Length of one focus block" },
    breakMinutes: { type: "integer", minimum: 1, maximum: 60, description: "Break between focus blocks" },
    longBreakMinutes: { type: "integer", minimum: 1, maximum: 60, description: "The longer rest taken every longBreakEvery blocks" },
    longBreakEvery: { type: "integer", minimum: 2, maximum: 12, description: "Focus blocks between long breaks" },
    blocks: { type: "integer", minimum: 1, maximum: 12, description: "How many focus blocks this session runs before it is done" },
    summary: { type: "string", description: "One sentence explaining how the session fits the request" },
    startNow: { type: "boolean", description: "True only when the student clearly asked to begin immediately, such as 'start now'" },
  },
})

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

/** Every field is coerced and clamped, so a short, malformed or rambling answer
 *  still becomes a runnable session. `fallback` is the timer's current shape. */
export function buildStudyPlan(raw: unknown, fallback: StudyPlan, knownSubjects: string[] = []): StudyPlan {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const subjects = new Map(knownSubjects.map((subject) => [subject.toLowerCase(), subject]))
  const subject = text(value.subject, MAX_SUBJECT_LENGTH)
  const blocks = Number.isFinite(value.blocks) ? Math.min(MAX_BLOCKS, Math.max(1, Math.round(value.blocks as number))) : fallback.blocks
  const plan: StudyPlan = {
    subject: subjects.get(subject.toLowerCase()) ?? (subject || fallback.subject),
    intent: text(value.intent, MAX_INTENT_LENGTH) || fallback.intent,
    workMinutes: clampMinutes(value.workMinutes, fallback.workMinutes),
    breakMinutes: clampMinutes(value.breakMinutes, fallback.breakMinutes),
    longBreakMinutes: clampMinutes(value.longBreakMinutes, fallback.longBreakMinutes),
    longBreakEvery: clampLongBreakInterval(typeof value.longBreakEvery === "number" ? value.longBreakEvery : undefined),
    blocks,
    summary: text(value.summary, 240),
    startNow: value.startNow === true,
  }
  // A response that is the user's own settings back to them is not a plan.
  if (!plan.summary && plan.subject === fallback.subject && plan.intent === fallback.intent
    && plan.workMinutes === fallback.workMinutes && plan.blocks === fallback.blocks) {
    throw new Error("ChatGPT could not turn that into a study session. Try naming a subject and a length of time.")
  }
  return plan
}

export function planSessionMinutes(plan: StudyPlan) {
  const blocks = Math.max(1, plan.blocks)
  const breaks = blocks - 1
  const longBreaks = Math.floor(blocks / plan.longBreakEvery)
  return blocks * plan.workMinutes + breaks * plan.breakMinutes + longBreaks * plan.longBreakMinutes
}

export function planFocusMinutes(plan: StudyPlan) {
  return Math.max(1, plan.blocks) * plan.workMinutes
}

export function describeStudyPlan(plan: StudyPlan, now: Date) {
  const ends = new Date(now.getTime() + planSessionMinutes(plan) * 60_000)
  const clock = ends.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
  const pattern = plan.blocks === 1
    ? `1 block of ${plan.workMinutes} min`
    : `${plan.blocks} blocks of ${plan.workMinutes} min with ${plan.breakMinutes} min breaks`
  return `${pattern} · ${formatFocusTime(planFocusMinutes(plan) * 60)} of focus · finishes around ${clock}`
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined
  const value = error as Record<string, unknown>
  return typeof value.statusCode === "number" ? value.statusCode : typeof value.status === "number" ? value.status : undefined
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (!error || typeof error !== "object") return ""
  const value = error as Record<string, unknown>
  return [value.message, value.responseBody, value.detail, value.data, value.cause]
    .map((part) => typeof part === "string" ? part : "")
    .filter(Boolean)
    .join(" ")
}

export function formatPlannerError(error: unknown) {
  const status = errorStatus(error)
  const detail = errorText(error).toLowerCase()
  if (status === 401 || detail.includes("not_authenticated")) return "Connect ChatGPT in Settings first."
  if (status === 429) return "ChatGPT is receiving too many requests. Wait a minute, then try again."
  if (status === 403 || detail.includes("not allowed") || detail.includes("model_not")) {
    return "That model cannot plan sessions. Pick another in the planner's model list."
  }
  if (errorText(error)) return errorText(error)
  return "Could not plan that session. Try again."
}

/** Time is the one thing a student never types, so it is always supplied. */
function timeContext(now: Date) {
  return {
    iso: now.toISOString(),
    local: now.toLocaleString("en-AU", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeZoneOffsetMinutes: -now.getTimezoneOffset(),
  }
}

/** Turns a sentence into a runnable session. The model is resolved per call so
 *  a plan never fails because the stored preference went stale, and one retry
 *  covers the flaky half of streaming. */
export async function planStudySession(
  request: string,
  context: PlanContext,
  preferredModel: string,
): Promise<{ plan: StudyPlan; model: string }> {
  const chatgpt = createChatGPTProxyProvider()
  let models: string[]
  try {
    models = await chatgpt.listModels()
  } catch (error) {
    if (errorStatus(error) === 401) throw new Error("Connect ChatGPT in Settings first.")
    throw new Error("Could not reach ChatGPT. Try again.", { cause: error })
  }
  const model = pickPlannerModel(models, preferredModel)
  if (!model) throw new Error("This ChatGPT account has no model available for planning.")

  const now = context.now
  const prompt = [
    `Turn this request into a study session: ${JSON.stringify(request.trim())}`,
    `The student's local time right now: ${JSON.stringify(timeContext(now))}. Use it: "tonight", "before dinner", "this afternoon" and "for an hour" all mean real times on this clock, and the session must start now or later, never earlier.`,
    `The timer currently: ${JSON.stringify(context.timer)} and has already logged ${context.blocksToday} focus block${context.blocksToday === 1 ? "" : "s"} today. Its settings are ${JSON.stringify(context.settings)}. Changing durations adjusts the block in progress rather than restarting it, so prefer the student's existing shape unless the request asks for something else.`,
    `The student's subjects: ${JSON.stringify(context.subjects)}. Reuse one of these spellings when the request names one.`,
    "Work backwards from the time available: add up focus blocks and breaks to fit the request, and if the request does not state a length, choose a block length that suits the subject and stop at a sensible number of blocks.",
    "startNow is true only when the student clearly asked to begin immediately. Never invent a deadline, an exam, or a specific topic they did not name.",
  ].join("\n")

  const fallback: StudyPlan = {
    subject: context.subjects[0] ?? "",
    intent: "",
    workMinutes: context.settings.workMinutes,
    breakMinutes: context.settings.breakMinutes,
    longBreakMinutes: context.settings.longBreakMinutes,
    longBreakEvery: context.settings.longBreakEvery,
    blocks: 1,
    summary: "",
    startNow: false,
  }

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = streamText({
        model: chatgpt(model),
        output: Output.object({ schema: SCHEMA, name: "study_plan" }),
        maxOutputTokens: 600,
        // Planning is a cheap job, so it never pays for extended reasoning.
        headers: { "x-login-with-chatgpt-reasoning-effort": "low" },
        prompt,
      })
      return { plan: buildStudyPlan(await result.output, fallback, context.subjects), model }
    } catch (error) {
      lastError = error
      // A malformed or empty answer is worth one more try; a 401 or 429 is not.
      const status = errorStatus(error)
      if (status === 401 || status === 429 || status === 403) break
    }
  }
  throw new Error(formatPlannerError(lastError), { cause: lastError })
}
