import { buildMistakesTex } from "../../src/lib/mistake-pdf.js"
import { handleMistakesPdf } from "../mistakes-pdf.js"
import { z } from "zod"
import { parseExamProgression, progressionBySubject } from "../../src/lib/exam-progression.js"
import { setSubjectCompletion } from "../../src/lib/subject-completion.js"
import { subjectWorkspace } from "../../src/lib/subject-workspace.js"
import { buildWeeklyReview, weekStart } from "../../src/lib/weekly-review.js"
import { editAppRecord, readAppRecords, readAll, updateApp } from "./store.js"
import type { Define } from "./tools.js"
import { day, nowIso, required } from "./util.js"

export function appTools(define: Define) {
  define("export_mistake_worksheet", "Export selected mistake questions as LaTeX, or compile a PDF and return base64 bytes. PDF sends the selected question text to texlive.net, as the app's PDF export does; only request PDF when the user asks for that export.", {
    ids: z.array(z.string()).min(1).max(100), format: z.enum(["tex", "pdf"]).default("tex"),
  }, "write", async ({ ids, format }) => {
    const { data } = await readAll()
    const mistakes = ids.map((id) => required(data.mistakes.find((item) => item.id === id), "mistake"))
    const tex = buildMistakesTex(mistakes, data.attempts)
    if (format === "tex") return { filename: "mistakes-worksheet.tex", mimeType: "application/x-tex", text: tex }
    const response = await handleMistakesPdf(new Request("http://localhost/mistakes-pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tex }) }))
    if (!response.ok) throw new Error(await response.text())
    return { filename: "mistakes-worksheet.pdf", mimeType: "application/pdf", base64: Buffer.from(await response.arrayBuffer()).toString("base64") }
  })

  define("list_app_records", "Advanced access: every synced app row with its entity, rowId, payload and seq. Includes historical and archived data; study sessions use their dedicated tools. Use seq as expectedSeq when editing one row.", {}, "read", readAppRecords)

  define("edit_app_record", "Advanced access to every synced app record and setting. Replace or delete ONE row using entity, rowId and expectedSeq from list_app_records (0 creates a new row). Uses the app's row validators, previews by default and rejects concurrent edits. Prefer convenience tools; replacing a collection-valued setting replaces that entire collection. Payload is a JSON string; delete ignores it.", {
    entity: z.enum(["attempts", "mistakes", "events", "user_state", "timetable_config"]), rowId: z.string().min(1), expectedSeq: z.number().int().min(0),
    operation: z.enum(["put", "delete"]).default("put"), json: z.string().max(10_000_000).optional(), dryRun: z.boolean().default(true),
  }, "delete", async ({ json, ...args }) => {
    if (args.operation === "put" && json === undefined) throw new Error("A put needs a JSON payload.")
    return editAppRecord({ ...args, payload: args.operation === "put" ? JSON.parse(json!) : null })
  })

  define("export_app_data", "Read the complete synced account, including historical/completed subjects, archived records, attachment metadata and raw canonical sessions. AppData is in Focal's JSON backup format; sessions are separate. Excludes device-local preferences, chat history and file bytes.", {}, "read", readAll)

  define("get_subject", "All study data for one subject, including completed subjects and archived records.", { subject: z.string().trim().min(1) }, "read", async ({ subject }) => subjectWorkspace((await readAll()).data, subject))

  define("set_subject_completion", "Finish a subject in a given year, or resume it with year null. Preserves every record, estimate and study session.", {
    subject: z.string().trim().min(1), year: z.number().int().min(1900).max(9999).nullable(),
  }, "write", async ({ subject, year }) => {
    const at = nowIso()
    await updateApp((data) => setSubjectCompletion(data, subject, year, at))
  })

  define("get_weekly_review", "The app's weekly review: planned/completed study, papers, recall, repeated mistakes, improved topics, neglected subjects and suggested tasks.", {
    date: day.optional().describe("Any date in the week; defaults to this week"),
  }, "read", async ({ date }) => {
    const { data, sessions } = await readAll()
    return buildWeeklyReview(data, sessions, weekStart(date ? new Date(`${date}T12:00:00`) : new Date()))
  })

  define("get_exam_progression", "The entire ordered exam progression and each subject's next paper, including completed subjects.", {}, "read", async () => {
    const { data } = await readAll()
    return { plan: data.examProgression ?? null, bySubject: data.examProgression ? progressionBySubject(data.examProgression, data.attempts) : [] }
  })

  define("replace_exam_progression", "Replace the entire progression, allowing papers to be edited, reordered or removed. json must use the progression import format. Does not delete logged exams.", {
    json: z.string().min(2).max(500_000),
  }, "delete", async ({ json }) => {
    const plan = { ...parseExamProgression(json), updatedAt: nowIso() }
    await updateApp((data) => ({ ...data, examProgression: plan }))
  })

  define("clear_class_timetable", "Remove the school class timetable without deleting calendar events or study records.", {}, "delete", async () => {
    await updateApp((data) => ({ ...data, classTimetable: undefined }))
  })

  define("update_stoplight_item", "Edit a skill's name, subject, group, description, check or type. Empty optional text clears it; omitted fields stay unchanged.", {
    id: z.string(), name: z.string().trim().min(1).optional(), subject: z.string().trim().min(1).optional(),
    group: z.string().optional(), description: z.string().optional(), check: z.string().optional(), type: z.enum(["recall", "technique", "apply", "practical"]).optional(),
  }, "write", async ({ id, ...patch }) => {
    const at = nowIso()
    await updateApp((data) => {
      required(data.learning.curriculumAreas.find((item) => item.id === id), "stoplight item")
      return { ...data, learning: { ...data.learning, updatedAt: at, curriculumAreas: data.learning.curriculumAreas.map((item) => item.id === id ? { ...item, ...patch, updatedAt: at } : item) } }
    })
  })

  define("edit_task", "Edit a study task's content, kind or duration, or restore an archived task. Status and date are handled by update_task.", {
    id: z.string(), title: z.string().trim().min(1).max(500).optional(), subject: z.string().optional(), detail: z.string().optional(),
    durationMinutes: z.number().positive().max(1440).optional(), kind: z.enum(["mistake-review", "topic-practice", "practice-exam", "sac-prep", "custom"]).optional(),
    restore: z.boolean().default(false),
  }, "write", async ({ id, restore, ...patch }) => {
    const at = nowIso()
    await updateApp((data) => {
      required(data.learning.tasks.find((task) => task.id === id), "task")
      return { ...data, learning: { ...data.learning, updatedAt: at, tasks: data.learning.tasks.map((task) => task.id === id ? { ...task, ...patch, ...(restore ? { archivedAt: undefined } : {}), updatedAt: at } : task) } }
    })
  })

  define("update_atar_estimate", "Edit a saved ATAR scenario's report year or study rows. Omit rawScore to use the live Focal prediction. Preserves its id and original saved result; list_atar_estimates recalculates the live result.", {
    id: z.string(), year: z.number().int().min(1900).max(9999).optional(),
    studies: z.array(z.object({ code: z.string().trim().min(1), rawScore: z.number().int().min(20).max(50).optional() })).min(1).max(12).optional(),
  }, "write", async ({ id, year, studies }) => {
    const at = nowIso()
    const rows = studies?.map((study) => ({ id: crypto.randomUUID(), code: study.code, raw: study.rawScore === undefined ? "" : String(study.rawScore), usePrediction: study.rawScore === undefined }))
    await updateApp((data) => {
      required(data.atarEstimates.find((estimate) => estimate.id === id), "ATAR estimate")
      return { ...data, atarEstimatesUpdatedAt: at, atarEstimates: data.atarEstimates.map((estimate) => estimate.id === id ? { ...estimate, ...(year === undefined ? {} : { year }), ...(rows ? { rows } : {}) } : estimate) }
    })
  })

  define("clear_mistake_insights", "Clear the saved mistake analysis and/or alternative-question deck.", {
    insights: z.boolean().default(true), alternativeDeck: z.boolean().default(false),
  }, "delete", async ({ insights, alternativeDeck }) => {
    await updateApp((data) => ({ ...data, ...(insights ? { mistakeInsights: undefined } : {}), ...(alternativeDeck ? { alternativeMistakeDeck: undefined } : {}) }))
  })
}
