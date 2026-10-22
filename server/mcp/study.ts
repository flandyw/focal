import { z } from "zod"
import { classPeriodsOn, subjectIdFor, subjectNameFor } from "../../src/lib/class-timetable.js"
import { addTask, archiveTask, buildDayPlan, moveTask, sessionBlocks, setTaskStatus } from "../../src/lib/day-plan.js"
import { getGoalProgress, localDate, type StudyGoal } from "../../src/lib/learning-workspace.js"
import {
  applyItemLinks, buildItemEvidence, progressStoplight, isRecheckDue, itemGroup, mergeStoplightItems, planRevision, setRating,
} from "../../src/lib/stoplight.js"
import { isPaused, isPlanned, isRunning, studySessionActiveMilliseconds, studySessionPlan, type CanonicalStudySession } from "../../src/lib/sync/sessionContract.js"
import { gradeReferences, readAll, sessionCommand, updateApp, vceTimetable } from "./store.js"
import type { Define } from "./tools"
import { day, instant, limit, nowIso, required, round } from "./util.js"

const blocks = z.array(z.object({ start: instant, end: instant })).min(1).max(100)
  .describe("Time blocks. They must end after they start, not overlap, and last at most 24 hours each.")
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: string | undefined) => value?.trim() || undefined

function stateOf(session: CanonicalStudySession) {
  return isRunning(session) ? "running" : isPaused(session) ? "paused" : session.completed ? "completed" : isPlanned(session) ? "planned" : "stopped"
}

function sessionView(session: CanonicalStudySession, now = Date.now()) {
  const plan = studySessionPlan(session)
  const reflection = isRecord(session.metadata.reflection) ? session.metadata.reflection : {}
  return {
    id: session.id, title: session.title, subject: subjectNameFor(session.subject_id ?? undefined) || null, kind: session.kind, state: stateOf(session),
    minutesStudied: round(studySessionActiveMilliseconds(session, now) / 60_000),
    blocks: sessionBlocks(session, now).map(({ start, end, done, live }) => ({ start, end, done, live })),
    description: plan.description || undefined, topics: plan.topics.length ? plan.topics : undefined, notes: typeof reflection.notes === "string" ? reflection.notes : undefined,
  }
}

export function studyTools(define: Define) {
  /* ------------------------------------------------------ study sessions */

  define("list_study_sessions", "List study sessions: planned (scheduled), running or paused timers, and completed/logged study. Filter by the dates of their blocks.",
    { from: day.optional(), to: day.optional(), state: z.enum(["planned", "running", "paused", "completed", "all"]).default("all"), limit },
    "read", async ({ from, to, state, limit }) => {
      const { sessions } = await readAll()
      const now = Date.now()
      return sessions.filter((s) => state === "all" || stateOf(s) === state)
        .map((s) => ({ view: sessionView(s, now) }))
        .filter(({ view }) => view.blocks.length === 0 || view.blocks.some((b) => (!from || localDate(new Date(b.start)) >= from) && (!to || localDate(new Date(b.start)) <= to)))
        .toSorted((a, b) => (b.view.blocks[0]?.start ?? "").localeCompare(a.view.blocks[0]?.start ?? "")).slice(0, limit).map(({ view }) => view)
    })

  define("plan_study_session", "Schedule future study on the calendar (a planned session that can later be started on the timer).",
    { title: z.string().min(1).max(512), subject: z.string().optional(), blocks, description: z.string().optional(), topics: z.array(z.string()).max(30).optional() },
    "write", async ({ title, subject, blocks, description, topics }) => {
      const id = crypto.randomUUID()
      await sessionCommand({
        session_id: id, expected_revision: 0, action: "create", kind: "focus", phase: "focus", title: title.trim(),
        subject_id: subject ? subjectIdFor(subject) : null, blocks,
        metadata: { subjectIds: subject ? [subjectIdFor(subject)] : [], createdVia: "assistant", description: text(description), topics, schedule: { blocks } },
      })
      return { id }
    })

  define("log_study", "Record study that already happened (every block must have finished).",
    { title: z.string().min(1).max(512), subject: z.string().min(1), blocks, notes: z.string().optional() }, "write", async ({ title, subject, blocks, notes }) => {
      const id = crypto.randomUUID()
      const subjectId = subjectIdFor(subject)
      await sessionCommand({
        session_id: id, expected_revision: 0, action: "log", kind: "focus", phase: "focus", title: title.trim(), subject_id: subjectId, blocks,
        metadata: { subjectIds: [subjectId], reflection: { notes: text(notes) }, createdVia: "assistant", schedule: { blocks } },
      })
      return { id }
    })

  define("edit_study_session", "Change a session that is not running or paused: title, subject, notes, blocks (replaces all of them), or mark it done/not done. Done blocks must have finished.", {
    id: z.string(), title: z.string().min(1).max(512).optional(), subject: z.string().optional(), blocks: blocks.optional(), completed: z.boolean().optional(),
    description: z.string().optional(), topics: z.array(z.string()).max(30).optional(), notes: z.string().optional(),
  }, "write", async ({ id, title, subject, blocks, completed, description, topics, notes }) => {
    const session = required((await readAll()).sessions.find((s) => s.id === id), "study session")
    const metadata: Record<string, unknown> = { ...session.metadata }
    if (description !== undefined) metadata.description = text(description)
    if (topics !== undefined) metadata.topics = topics
    if (notes !== undefined) metadata.reflection = { ...(isRecord(metadata.reflection) ? metadata.reflection : {}), notes: text(notes) }
    if (blocks && isRecord(metadata.schedule)) metadata.schedule = { ...metadata.schedule, blocks }
    if (subject !== undefined) metadata.subjectIds = subject ? [subjectIdFor(subject)] : []
    await sessionCommand({
      session_id: id, expected_revision: session.revision, action: "save_progress", title: title?.trim(),
      subject_id: subject === undefined ? undefined : subject ? subjectIdFor(subject) : null, metadata, blocks, completed,
    })
  })

  define("delete_study_session", "Delete a study session (planned, logged, or finished).", { id: z.string() }, "delete", async ({ id }) => {
    const session = required((await readAll()).sessions.find((s) => s.id === id), "study session")
    await sessionCommand({ session_id: id, expected_revision: session.revision, action: "cancel" })
  })

  define("study_timer", "Drive the live study timer shared with the app. start: begin a new focus session (give title and subject) or start a planned one (give id). pause/resume/complete act on the running or paused session, or on `id`. Only one session can run at a time.", {
    action: z.enum(["start", "pause", "resume", "complete"]), id: z.string().optional(), title: z.string().min(1).max(512).optional(),
    subject: z.string().optional(), workMinutes: z.number().int().min(1).max(240).default(25).describe("Planned length of a new focus block"),
  }, "write", async ({ action, id, title, subject, workMinutes }) => {
    const { sessions } = await readAll()
    const running = sessions.filter(isRunning)
    if ((action === "start" || action === "resume") && running.some((s) => s.id !== id)) {
      throw new Error(`"${running[0].title}" is still running. Pause or complete it first.`)
    }
    if (action === "start" && !id) {
      if (!title || !subject) throw new Error("Give a title and subject to start a new focus session.")
      const sessionId = crypto.randomUUID()
      const details = { subject: subject.trim(), provider: "Focal", title: title.trim(), workMinutes }
      await sessionCommand({
        session_id: sessionId, expected_revision: 0, action: "start", kind: "focus", phase: "focus", title: details.title, subject_id: details.subject,
        metadata: { ...details, createdVia: "examtrack", description: "Logged by the Focal focus timer.", topics: ["Study block"],
          integrations: { examtrack: { type: "examtrack", id: sessionId, kind: "focus", subject: details.subject, phase: "focus" } }, examtrack: details },
      })
      return { id: sessionId, state: "running" }
    }
    const wanted = action === "resume" ? sessions.filter(isPaused) : sessions.filter((s) => isRunning(s) || isPaused(s))
    const session = id ? required(sessions.find((s) => s.id === id), "study session") : wanted.length === 1 ? wanted[0] : undefined
    if (!session) throw new Error(wanted.length ? "Several sessions match; pass the session id." : `No session to ${action}.`)
    await sessionCommand({
      session_id: session.id, expected_revision: session.revision, action, kind: session.kind, phase: session.phase ?? "focus", title: session.title,
      subject_id: session.subject_id ?? undefined, metadata: session.metadata,
    })
    return { id: session.id, state: action === "pause" ? "paused" : action === "complete" ? "completed" : "running" }
  })

  define("get_day_plan", "Everything on for one day in one list: study tasks, SACs, exams, events, study sessions, logged papers and due mistake reviews, plus the school periods.",
    { date: day.optional().describe("Defaults to today") }, "read", async ({ date }) => {
      const { data, sessions } = await readAll()
      const on = date ?? localDate(new Date())
      return { ...buildDayPlan(on, { ...data, sessions }, await vceTimetable()), classPeriods: classPeriodsOn(on, data.classTimetable) }
    })

  /* ------------------------------------------------------------ stoplight */

  define("list_stoplight", "The stoplight checklist: every skill rated red/amber/green, with the evidence from your mistakes and marked questions, practice progression and whether a re-check is due.",
    { subject: z.string().optional(), includeArchived: z.boolean().default(false) }, "read", async ({ subject, includeArchived }) => {
      const { data } = await readAll()
      const evidence = buildItemEvidence(data)
      const items = progressStoplight(data.learning, data.mistakes).curriculumAreas.filter((item) => (includeArchived || !item.archivedAt) && (!subject || item.subject.toLowerCase() === subject.toLowerCase()))
      return items.map((item) => ({
        id: item.id, subject: item.subject, group: itemGroup(item), name: item.name, rating: item.rating ?? "unrated", ratedAt: item.ratedAt,
        check: item.check, type: item.type, archived: Boolean(item.archivedAt), recheckDue: isRecheckDue(item),
        evidence: evidence.get(item.id),
      }))
    })

  define("add_stoplight_items", "Add skills to a subject's checklist. Existing items (same group and name) keep their id and rating and only refresh check/type. `check` is a one-line cold-and-timed test of the skill.", {
    subject: z.string().min(1),
    items: z.array(z.object({ group: z.string().min(1).describe("Unit or area of study heading"), name: z.string().min(1), check: z.string().optional(), type: z.enum(["recall", "technique", "apply", "practical"]).optional() })).min(1).max(300),
  }, "write", async ({ subject, items }) => {
    let added = 0
    await updateApp((data) => {
      const merged = mergeStoplightItems(data.learning, subject.trim(), items.map((i) => ({ group: i.group.trim(), name: i.name.trim(), check: text(i.check), type: i.type })))
      added = merged.added
      return { ...data, learning: merged.learning }
    })
    return { added }
  })

  define("rate_stoplight_items", "Rate skills red (can't start the check without notes), amber (with notes, slowly, or with errors) or green (passes cold and timed).",
    { ratings: z.array(z.object({ id: z.string(), rating: z.enum(["red", "amber", "green"]) })).min(1).max(300) }, "write", async ({ ratings }) => {
      await updateApp((data) => {
        const known = new Set(data.learning.curriculumAreas.map((item) => item.id))
        const missing = ratings.find((r) => !known.has(r.id))
        if (missing) throw new Error(`No stoplight item with id ${missing.id}.`)
        return { ...data, learning: ratings.reduce((learning, r) => setRating(learning, r.id, r.rating), data.learning) }
      })
    })

  define("archive_stoplight_items", "Archive (hide) or restore stoplight items.", { ids: z.array(z.string()).min(1).max(300), archived: z.boolean() }, "write", async ({ ids, archived }) => {
    const chosen = new Set(ids)
    const stamp = nowIso()
    await updateApp((data) => ({ ...data, learning: { ...data.learning, updatedAt: stamp,
      curriculumAreas: data.learning.curriculumAreas.map((item) => chosen.has(item.id) ? { ...item, archivedAt: archived ? stamp : undefined, updatedAt: stamp } : item) } }))
  })

  define("link_to_stoplight", "Link mistakes and marked exam questions to the stoplight items they test (up to 3 each), so ratings are backed by evidence. Mistakes you linked by hand are never overwritten. Linking an open mistake to a green item drops it to amber.",
    { links: z.array(z.object({ id: z.string().describe("A mistake id or an exam question-result id"), itemIds: z.array(z.string()).min(1).max(3) })).min(1).max(300) }, "write", async ({ links }) => {
      let result = { linked: 0, demoted: 0 }
      await updateApp((data) => {
        const known = new Set(data.learning.curriculumAreas.map((item) => item.id))
        const bad = links.flatMap((l) => l.itemIds).find((itemId) => !known.has(itemId))
        if (bad) throw new Error(`No stoplight item with id ${bad}.`)
        const applied = applyItemLinks(data, links)
        result = { linked: applied.linked, demoted: applied.demoted.length }
        return applied.data
      })
      return result
    })

  define("plan_revision", "Turn the weakest stoplight items (red, amber, or due a re-check) into study tasks spread over the next 7 study days.",
    { subject: z.string().optional() }, "write", async ({ subject }) => {
      let count = 0
      await updateApp((data) => {
        const plan = planRevision(data.learning, data, subject)
        count = plan.count
        return { ...data, learning: plan.learning }
      })
      return { tasksCreated: count }
    })

  /* ---------------------------------------------------------------- goals */

  const goalView = async () => {
    const [{ data }, references] = await Promise.all([readAll(), gradeReferences()])
    return { data, references }
  }

  define("list_goals", "Score goals (study score, exam average, ATAR) with current progress and the gap to the target.",
    { includeArchived: z.boolean().default(false) }, "read", async ({ includeArchived }) => {
      const { data, references } = await goalView()
      return data.learning.goals.filter((g) => includeArchived || !g.archivedAt)
        .map((goal) => ({ ...goal, progress: getGoalProgress(goal, data, references) }))
    })

  define("save_goal", "Create a goal, or update one when `id` is given. study-score: raw study score 1-50 for a subject. exam-percentage: average exam result 1-100%, optionally for a subject. atar: 1-99.95.", {
    id: z.string().optional(), kind: z.enum(["study-score", "exam-percentage", "atar"]), subject: z.string().optional(),
    target: z.number().positive().max(100), deadline: day,
  }, "write", async ({ id, kind, subject, target, deadline }) => {
    if (kind === "study-score" && (!subject || target > 50)) throw new Error("A study-score goal needs a subject and a target of at most 50.")
    if (kind === "atar" && target > 99.95) throw new Error("An ATAR goal can be at most 99.95.")
    const goalId = id ?? crypto.randomUUID()
    const stamp = nowIso()
    await updateApp((data) => {
      const old = data.learning.goals.find((g) => g.id === goalId)
      if (id && !old) throw new Error("No goal with that id.")
      const goal: StudyGoal = { ...old, id: goalId, kind, subject: text(subject), target, deadline, createdAt: old?.createdAt ?? stamp, updatedAt: stamp }
      const goals = old ? data.learning.goals.map((g) => g.id === goalId ? goal : g) : [...data.learning.goals, goal]
      return { ...data, learning: { ...data.learning, goals, updatedAt: stamp } }
    })
    return { id: goalId }
  })

  define("archive_goal", "Archive a goal (or restore it with archived false).", { id: z.string(), archived: z.boolean().default(true) }, "write", async ({ id, archived }) => {
    const stamp = nowIso()
    await updateApp((data) => {
      required(data.learning.goals.find((g) => g.id === id), "goal")
      return { ...data, learning: { ...data.learning, updatedAt: stamp, goals: data.learning.goals.map((g) => g.id === id ? { ...g, archivedAt: archived ? stamp : undefined, updatedAt: stamp } : g) } }
    })
  })

  /* ---------------------------------------------------------------- tasks */

  define("list_tasks", "List study tasks (the checklist items planned onto calendar days).",
    { from: day.optional(), to: day.optional(), status: z.enum(["planned", "completed", "skipped", "all"]).default("all"), includeArchived: z.boolean().default(false), limit },
    "read", async ({ from, to, status, includeArchived, limit }) => {
      const { data } = await readAll()
      return data.learning.tasks.filter((t) => (includeArchived || !t.archivedAt) && (status === "all" || t.status === status) && (!from || t.plannedFor >= from) && (!to || t.plannedFor <= to))
        .toSorted((a, b) => a.plannedFor.localeCompare(b.plannedFor)).slice(0, limit)
    })

  define("add_task", "Add a study task to a calendar day.",
    { title: z.string().min(1).max(200), date: day, minutes: z.number().int().min(5).max(360), subject: z.string().optional(), detail: z.string().max(200).optional() },
    "write", async ({ title, date, minutes, subject, detail }) => {
      let id = ""
      await updateApp((data) => {
        const known = new Set(data.learning.tasks.map((t) => t.id))
        const learning = addTask(data.learning, { title, date, minutes, subject, detail })
        id = learning.tasks.find((t) => !known.has(t.id))?.id ?? ""
        return { ...data, learning }
      })
      return { id }
    })

  define("update_task", "Mark a task completed/skipped/planned, move it to another day (a completed task moved becomes planned again), or archive it.",
    { id: z.string(), status: z.enum(["planned", "completed", "skipped"]).optional(), date: day.optional(), archive: z.boolean().optional() }, "write", async ({ id, status, date, archive }) => {
      await updateApp((data) => {
        required(data.learning.tasks.find((t) => t.id === id), "task")
        let learning = data.learning
        if (date) learning = moveTask(learning, id, date)
        if (status) learning = setTaskStatus(learning, id, status)
        if (archive) learning = archiveTask(learning, id)
        return { ...data, learning }
      })
    })
}
