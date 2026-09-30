import { getSessionEffectiveMinutes } from "@/lib/utils"
import type { ConfidenceScore, DeadlineType, Project, StudySession } from "@/lib/types"

const DAY_MS = 24 * 60 * 60 * 1000

const PREP_STEPS: Record<DeadlineType, readonly string[]> = {
  sac: [
    "Confirm the assessed study design outcomes and task format",
    "Create a one-page summary of key concepts and examples",
    "Complete one timed practice response",
    "Mark mistakes and write the next revision action",
  ],
  exam: [
    "List the examinable study design outcomes",
    "Complete one timed section or full practice paper",
    "Mark the paper and log recurring mistakes",
    "Redo missed questions without notes",
    "Prepare exam-day materials and a timing strategy",
  ],
  assignment: [
    "Turn the task sheet and rubric into a checklist",
    "Draft the structure and gather evidence or examples",
    "Get feedback on a complete draft",
    "Proofread against the rubric and submit the final version",
  ],
}

export interface VcePrepSummary {
  completedChecklistCount: number
  totalChecklistCount: number
  completedStudyMinutes: number
  completedSessionCount: number
  latestConfidence?: ConfidenceScore
  daysUntilDeadline: number | null
}

export function getVcePrepSteps(deadlineType?: DeadlineType): readonly string[] {
  return deadlineType ? PREP_STEPS[deadlineType] : []
}

export function getMissingVcePrepSteps(project: Project): string[] {
  const existing = new Set(
    (project.checklist ?? []).map((item) => item.text.trim().replace(/\s+/g, " ").toLowerCase()),
  )
  return getVcePrepSteps(project.deadlineType).filter(
    (step) => !existing.has(step.toLowerCase()),
  )
}

function getCompletedAt(session: StudySession): string | undefined {
  return session.execution.state === "completed"
    ? session.execution.completedAt
    : undefined
}

export function buildVcePrepSummary(
  project: Project,
  sessions: StudySession[],
  now = Date.now(),
): VcePrepSummary {
  const checklist = project.checklist ?? []
  const projectSessions = sessions.filter(
    (session) => session.projectId === project.id && session.execution.state === "completed",
  )
  const latestSession = [...projectSessions]
    .sort((a, b) => {
      const aTime = getCompletedAt(a) ?? a.schedule.blocks[a.schedule.blocks.length - 1].end
      const bTime = getCompletedAt(b) ?? b.schedule.blocks[b.schedule.blocks.length - 1].end
      return new Date(bTime).getTime() - new Date(aTime).getTime()
    })[0]
  const deadlineTime = project.deadline ? new Date(project.deadline).getTime() : NaN

  return {
    completedChecklistCount: checklist.filter((item) => item.completed).length,
    totalChecklistCount: checklist.length,
    completedStudyMinutes: projectSessions.reduce(
      (total, session) => total + getSessionEffectiveMinutes(session),
      0,
    ),
    completedSessionCount: projectSessions.length,
    latestConfidence: latestSession?.reflection?.confidence,
    daysUntilDeadline: Number.isFinite(deadlineTime)
      ? Math.ceil((deadlineTime - now) / DAY_MS)
      : null,
  }
}
