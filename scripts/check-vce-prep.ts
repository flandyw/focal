import { buildVcePrepSummary, getMissingVcePrepSteps, getVcePrepSteps } from "../src/lib/vcePrep.ts"
import type { Project, StudySession } from "../src/lib/types.ts"

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

const project: Project = {
  id: "methods-sac",
  name: "Methods SAC 2",
  created_at: "2026-07-01T00:00:00.000Z",
  folder_path: "Methods SAC 2",
  subjectId: "mm",
  unit: "3",
  deadlineType: "sac",
  deadline: "2026-08-10T00:00:00.000Z",
  checklist: [{ id: "step-1", text: "  COMPLETE one timed practice response ", completed: true }],
}

const completedSession: StudySession = {
  schemaVersion: 2,
  id: "session-1",
  projectId: project.id,
  subjectIds: ["mm"],
  title: "Methods revision",
  schedule: { blocks: [{ start: "2026-08-01T09:00:00.000Z", end: "2026-08-01T10:00:00.000Z" }] },
  execution: {
    state: "completed",
    intervals: [{ start: "2026-08-01T09:00:00.000Z", end: "2026-08-01T09:45:00.000Z", source: "manual" }],
    completedAt: "2026-08-01T09:45:00.000Z",
  },
  reflection: { confidence: 2 },
  createdVia: "manual",
  created_at: "2026-08-01T09:00:00.000Z",
}

check(getVcePrepSteps("sac").length === 4, "SAC prep pack should have four steps")
check(getVcePrepSteps("exam").some((step) => step.includes("practice paper")), "exam prep should include a practice paper")
check(getVcePrepSteps("assignment").some((step) => step.includes("rubric")), "assignment prep should include the rubric")
check(getMissingVcePrepSteps(project).length === 3, "existing checklist text should be matched case-insensitively")

const summary = buildVcePrepSummary(project, [completedSession], Date.parse("2026-08-02T00:00:00.000Z"))
check(summary.completedChecklistCount === 1 && summary.totalChecklistCount === 1, "checklist summary is wrong")
check(summary.completedStudyMinutes === 45 && summary.completedSessionCount === 1, "completed study summary is wrong")
check(summary.latestConfidence === 2, "latest confidence is missing")
check(summary.daysUntilDeadline === 8, "deadline countdown is wrong")
