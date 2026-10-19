import type { AppData } from "./exam-data"
import type { LearningWorkspace, LearningWorkspaceUpdate } from "./learning-workspace"
import { sameStudySubject } from "./studySubjects"

export function subjectLearning(learning: LearningWorkspace, subject: string): LearningWorkspace {
  return {
    ...learning,
    tasks: learning.tasks.filter((item) => sameStudySubject(item.subject, subject)),
    curriculumAreas: learning.curriculumAreas.filter((item) => sameStudySubject(item.subject, subject)),
    goals: learning.goals.filter((item) => sameStudySubject(item.subject, subject)),
  }
}

export function updateSubjectLearning(learning: LearningWorkspace, subject: string, update: LearningWorkspaceUpdate): LearningWorkspace {
  const scoped = subjectLearning(learning, subject)
  const next = typeof update === "function" ? update(scoped) : update
  return {
    ...next,
    tasks: [...learning.tasks.filter((item) => !sameStudySubject(item.subject, subject)), ...next.tasks],
    curriculumAreas: [...learning.curriculumAreas.filter((item) => !sameStudySubject(item.subject, subject)), ...next.curriculumAreas],
    goals: [...learning.goals.filter((item) => !sameStudySubject(item.subject, subject)), ...next.goals],
  }
}

export function subjectWorkspace(data: AppData, subject: string): AppData {
  const attempts = data.attempts.filter((attempt) => sameStudySubject(attempt.subject, subject))
  const attemptIds = new Set(attempts.map((attempt) => attempt.id))
  // ponytail: old unlinked cards have no reliable subject; keep them in All subjects until assigned.
  const mistakes = data.mistakes.filter((mistake) => attemptIds.has(mistake.attemptId) || !mistake.attemptId && sameStudySubject(mistake.subject, subject))
  const mistakeIds = new Set(mistakes.map((mistake) => mistake.id))
  return {
    ...data,
    subjects: [subject],
    attempts,
    mistakes,
    sacRecords: data.sacRecords.filter((record) => sameStudySubject(record.subject, subject)),
    learning: subjectLearning(data.learning, subject),
    // ponytail: retain the existing single report cache; tag its subject to prevent reuse across subjects.
    // Store reports by subject if keeping several generated reports becomes necessary.
    mistakeInsights: sameStudySubject(data.mistakeInsights?.subject, subject) ? data.mistakeInsights : undefined,
    alternativeMistakeDeck: data.alternativeMistakeDeck && { ...data.alternativeMistakeDeck, cards: data.alternativeMistakeDeck.cards.filter((card) => mistakeIds.has(card.sourceMistakeId)) },
  }
}
