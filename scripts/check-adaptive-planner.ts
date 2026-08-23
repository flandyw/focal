import { buildAdaptivePlan } from "../src/lib/adaptivePlanner.ts"
import { selectRecentDownloads, suggestInboxProject } from "../src/lib/academicInbox.ts"
import { getProjectTopicMastery } from "../src/lib/mastery.ts"
import { reviewStudyCard } from "../src/lib/studyMaterials.ts"
import { getPriorityItems } from "../src/lib/studyPriority.ts"
import type { Project, StudyCard, Subject } from "../src/lib/types.ts"

const project: Project = {
  id: "methods",
  name: "Methods SAC",
  folder_path: "Methods SAC",
  subjectId: "mm",
  deadline: "2026-08-26T23:59:00+10:00",
  planning: { estimatedMinutes: 90, sessionMinutes: 45 },
  created_at: "2026-08-01T00:00:00Z",
}
const plan = buildAdaptivePlan({
  projects: [project],
  sessions: [],
  events: [{
    id: "busy",
    title: "Busy",
    startTime: "2026-08-24T16:00:00+10:00",
    endTime: "2026-08-24T17:00:00+10:00",
    eventType: "event",
    created_at: "2026-08-01T00:00:00Z",
  }],
  now: new Date("2026-08-24T15:00:00+10:00"),
})

if (plan.items.length !== 2) throw new Error(`Expected two blocks, received ${plan.items.length}`)
if (plan.items.some((item) => item.startTime.startsWith("2026-08-24") && new Date(item.startTime).getHours() < 17)) throw new Error("Planner overlapped a fixed event")
if (new Set(plan.items.map((item) => item.startTime.slice(0, 10))).size !== 2) throw new Error("Planner did not spread revision across days")
if (plan.items.reduce((sum, item) => sum + (new Date(item.endTime).getTime() - new Date(item.startTime).getTime()) / 60_000, 0) !== 90) {
  throw new Error("Planner did not allocate the estimated work")
}
if (plan.gaps.length !== 0) throw new Error("Planner reported a false capacity gap")

const evidenceProject: Project = {
  ...project,
  results: [{ id: "result", title: "Practice", score: 6, maxScore: 10, completedAt: "2026-08-20T00:00:00Z", topics: ["Calculus"] }],
}
if (getProjectTopicMastery(evidenceProject)[0]?.score !== 60) throw new Error("Result evidence did not feed topic mastery")
if (!getPriorityItems({ projects: [evidenceProject], sessions: [], events: [], now: new Date("2026-08-24T00:00:00+10:00").getTime() }).some((item) => item.kind === "weak-topic")) {
  throw new Error("Weak result evidence did not surface in study priorities")
}

const card: StudyCard = {
  id: "card", question: "Q", answer: "A", topics: ["Calculus"], sourcePath: "/notes.txt", sourceName: "notes.txt",
  createdAt: "2026-08-20T00:00:00Z", reviewCount: 0, correctCount: 0, intervalDays: 0, dueAt: "2026-08-20T00:00:00Z",
}
const reviewed = reviewStudyCard(card, true, new Date("2026-08-24T00:00:00Z"))
if (reviewed.correctCount !== 1 || reviewed.intervalDays !== 1 || reviewed.dueAt !== "2026-08-25T00:00:00.000Z") throw new Error("Study-card scheduling is incorrect")

const subjects: Subject[] = [{ id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#000" }]
if (suggestInboxProject("methods chapter 4 notes.txt", [project], subjects) !== project.id) throw new Error("Inbox did not suggest the matching assessment")
const recentDownloads = selectRecentDownloads([
  { name: "older.pdf", modifiedAt: 1 },
  { name: ".hidden.pdf", modifiedAt: 4 },
  { name: "unfinished.crdownload", modifiedAt: 3 },
  { name: "newer.pdf", modifiedAt: 2 },
], 2)
if (recentDownloads.map((file) => file.name).join(",") !== "newer.pdf,older.pdf") throw new Error("Inbox recent-download filtering is incorrect")

// eslint-disable-next-line no-console
console.log("Adaptive planner checks passed")
