import type { Project } from "@/lib/types"

export interface TopicMastery {
  topic: string
  score: number
  evidenceCount: number
}
function key(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

export function getProjectTopicMastery(project: Project): TopicMastery[] {
  const evidence = new Map<string, { label: string; total: number; count: number }>()
  const add = (topic: string, score: number) => {
    const normalized = key(topic)
    if (!normalized || !Number.isFinite(score)) return
    const current = evidence.get(normalized) ?? { label: topic.trim(), total: 0, count: 0 }
    current.total += Math.max(0, Math.min(100, score))
    current.count += 1
    evidence.set(normalized, current)
  }

  for (const result of project.results ?? []) {
    const score = result.maxScore > 0 ? result.score / result.maxScore * 100 : 0
    for (const topic of result.topics) add(topic, score)
  }
  for (const card of project.studyCards ?? []) {
    if (card.reviewCount === 0) continue
    const score = card.correctCount / card.reviewCount * 100
    for (const topic of card.topics) add(topic, score)
  }

  return Array.from(evidence.values(), (item) => ({
    topic: item.label,
    score: Math.round(item.total / item.count),
    evidenceCount: item.count,
  })).sort((a, b) => a.score - b.score || a.topic.localeCompare(b.topic))
}

export function getProjectMasteryScore(project: Project): number | null {
  const topics = getProjectTopicMastery(project)
  if (topics.length > 0) {
    return Math.round(topics.reduce((sum, topic) => sum + topic.score, 0) / topics.length)
  }
  const results = project.results ?? []
  if (results.length === 0) return null
  return Math.round(results.reduce((sum, result) => sum + result.score / result.maxScore * 100, 0) / results.length)
}
