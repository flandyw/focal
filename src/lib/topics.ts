import { normaliseComparisonName, type ExamAttempt, type Mistake, type MistakeCategory } from "./exam-data"

/**
 * Canonical topics per subject. `areaOfStudy` stays free text; `topic` is the small fixed list the
 * paper matrix groups by. To support another subject (Specialist, Chemistry, PE...), add an entry to
 * TOPIC_CONFIGS: its names, topics, a fallback and keyword rules. Subjects without an entry keep free-text topics.
 */
export type TopicRule = {
  topic: string
  /** Each distinct keyword hit scores 2. */
  strong: RegExp
  /** Any hit scores 1; for words too generic to decide alone. */
  weak?: RegExp
}

export type SubjectTopics = {
  /** Subject names as `normaliseComparisonName` writes them. */
  subjects: readonly string[]
  topics: readonly string[]
  fallback: string
  /** Listed in tie-break order (put the broad topics last): on equal scores the earlier rule wins and the match is flagged ambiguous. */
  rules: readonly TopicRule[]
}

export const METHODS_TOPICS = [
  "Functions/domains/transformations",
  "Inverse functions & intersections",
  "Differentiation & applications",
  "Integration & area",
  "Probability (discrete, conditional, binomial)",
  "Continuous distributions, normal, sampling & CIs",
  "Circular functions",
  "Other",
] as const

const METHODS: SubjectTopics = {
  subjects: ["mathematical methods", "mathematical methods cas"],
  topics: METHODS_TOPICS,
  fallback: "Other",
  rules: [
    {
      topic: METHODS_TOPICS[1],
      strong: /(inverses?(?!\s+normal)|intersect\w*|one-to-one|f\s*\^?\s*[-−]\s*1|f⁻¹)/gi,
    },
    {
      topic: METHODS_TOPICS[2],
      strong: /(differentiat\w*|\bderivatives?|tangents?|normals? (?:to|line)|gradients?|stationary|turning points?|maxim\w*|minim\w*|optimi[sz]\w*|rates? of change|chain rule|product rule|quotient rule|concav\w*|inflection)/gi,
      weak: /(calculus|\bcurves?\b|\bslopes?\b)/gi,
    },
    {
      topic: METHODS_TOPICS[3],
      strong: /(integrat\w*|integral\w*|antiderivative\w*|area (?:between|under|enclosed|bounded)|definite|fundamental theorem|trapez\w+|average value|signed area)/gi,
      weak: /(calculus|\barea\b(?! of study)|under (?:the )?curve)/gi,
    },
    {
      topic: METHODS_TOPICS[4],
      strong: /(probabilit(?:y|ies)(?! density)|binomial|bernoulli|conditional|hypergeometric|discrete|tree diagram|venn|independent events?|pr\(|geometric|combinatori\w*|permutation|combination)/gi,
      weak: /(random variables?|expected|\bevents?\b)/gi,
    },
    {
      topic: METHODS_TOPICS[5],
      strong: /(continuous|normal distribution|normal dist\w*|standard normal|z-?scores?|\bpdf\b|probability density|\bcdf\b|cumulative|sampling|sample (?:proportion|mean)s?|confidence intervals?|\bcis?\b|inverse normal|invnorm|normalcdf|standard deviation|\bmedian\b|\bquantiles?\b|margin of error|population proportion|\bsamples?\b)/gi,
      weak: /(\bnormal\b|distributions?|\bmean\b|variance)/gi,
    },
    {
      topic: METHODS_TOPICS[6],
      strong: /(circular|trigonometr\w*|\b(?:sin|cos|tan)\b|sinusoidal|sine|cosine|radians?|amplitude|period\w*|\bphase\b|unit circle|compound angle)/gi,
    },
    {
      topic: METHODS_TOPICS[0],
      strong: /\b(transformations?|dilations?|reflections?|translations?|hybrid|piecewise|logarithm\w*|logs?|exponential\w*|asymptotes?|composite|composition|surds?|indices|index laws?|absolute value|modulus)\b/gi,
      weak: /\b(domains?|ranges?|polynomials?|cubics?|quartics?|quadratics?|graphs?|sketch\w*|algebra\w*|equations?)\b/gi,
    },
  ],
}

export const TOPIC_CONFIGS: readonly SubjectTopics[] = [METHODS]

export const topicConfigFor = (subject: string) => {
  const name = normaliseComparisonName(subject)
  return TOPIC_CONFIGS.find((config) => config.subjects.includes(name))
}

export type TopicMatch = { topic: string; matched: boolean; ambiguous: boolean }

const hits = (pattern: RegExp, text: string) => new Set(text.toLowerCase().match(pattern)).size

export function inferTopic(config: SubjectTopics, text: string): TopicMatch {
  const scored = config.rules
    .map((rule) => ({ topic: rule.topic, score: 2 * hits(rule.strong, text) + (rule.weak && hits(rule.weak, text) ? 1 : 0) }))
    .filter((entry) => entry.score > 0)
    .toSorted((first, second) => second.score - first.score)
  if (!scored.length) return { topic: config.fallback, matched: false, ambiguous: false }
  return { topic: scored[0].topic, matched: true, ambiguous: scored[1]?.score === scored[0].score }
}

export type MistakeTopicMatch = TopicMatch & { basis: "areaOfStudy" | "text" | "none" }

/** The label first; only when it says nothing, the start of the card text (which can hold SVG, so it is capped). */
export function inferMistakeTopic(config: SubjectTopics, mistake: Pick<Mistake, "areaOfStudy" | "question" | "questionText" | "explanation">): MistakeTopicMatch {
  const byLabel = mistake.areaOfStudy?.trim() ? inferTopic(config, mistake.areaOfStudy) : undefined
  if (byLabel?.matched) return { ...byLabel, basis: "areaOfStudy" }
  const byText = inferTopic(config, [mistake.question, mistake.explanation, mistake.questionText?.slice(0, 500)].filter(Boolean).join(" "))
  return byText.matched ? { ...byText, basis: "text" } : { ...byText, basis: "none" }
}

/** The canonical spelling of `topic` for `subject`, or why it is not allowed. Subjects without a config take any text. */
export function validateTopic(subject: string, topic: string): { topic: string } | { error: string } {
  const trimmed = topic.trim()
  const config = topicConfigFor(subject)
  if (!config) return trimmed ? { topic: trimmed } : { error: "Topic cannot be empty." }
  const match = config.topics.find((name) => name.toLowerCase() === trimmed.toLowerCase())
  return match ? { topic: match } : { error: `"${trimmed}" is not a ${subject} topic. Use one of: ${config.topics.join("; ")}.` }
}

/** The topic the matrix files a card under: the stored one if it is on the list, else inferred. */
export function topicOfMistake(config: SubjectTopics, mistake: Mistake) {
  const stored = mistake.topic && config.topics.find((name) => name.toLowerCase() === mistake.topic!.trim().toLowerCase())
  return stored || inferMistakeTopic(config, mistake).topic
}

export type MistakeEdit = { topic?: string; areaOfStudy?: string; category?: MistakeCategory }
export type MistakeChange = {
  id: string
  question: string
  before: { topic: string | null; areaOfStudy: string | null; category: MistakeCategory }
  after: { topic: string | null; areaOfStudy: string | null; category: MistakeCategory }
}

/** What applying `edit` to `mistake` would change; null when nothing differs. */
export function diffMistake(mistake: Mistake, edit: MistakeEdit): MistakeChange | null {
  const before = { topic: mistake.topic ?? null, areaOfStudy: mistake.areaOfStudy ?? null, category: mistake.category }
  const after = {
    topic: edit.topic ?? before.topic,
    areaOfStudy: edit.areaOfStudy === undefined ? before.areaOfStudy : edit.areaOfStudy.trim() || null,
    category: edit.category ?? before.category,
  }
  return before.topic === after.topic && before.areaOfStudy === after.areaOfStudy && before.category === after.category
    ? null
    : { id: mistake.id, question: mistake.question, before, after }
}

/** Applies diffs, remembering the old values in `previous` so `revertMistakes` can undo them. */
export function applyMistakeChanges(mistakes: Mistake[], changes: readonly MistakeChange[], at: string): Mistake[] {
  const byId = new Map(changes.map((change) => [change.id, change]))
  return mistakes.map((mistake) => {
    const change = byId.get(mistake.id)
    if (!change) return mistake
    const { topic, areaOfStudy, category } = change.after
    return { ...mistake, topic: topic ?? undefined, areaOfStudy: areaOfStudy ?? undefined, category, previous: { at, ...change.before }, updatedAt: at }
  })
}

/** Restores the values saved by the last bulk edit of each card in `ids`. */
export function revertMistakes(mistakes: Mistake[], ids: ReadonlySet<string>, at: string): { mistakes: Mistake[]; reverted: string[] } {
  const reverted: string[] = []
  return {
    mistakes: mistakes.map((mistake) => {
      if (!ids.has(mistake.id) || !mistake.previous) return mistake
      reverted.push(mistake.id)
      const { previous, ...rest } = mistake
      return { ...rest, topic: previous.topic ?? undefined, areaOfStudy: previous.areaOfStudy ?? undefined, category: previous.category, updatedAt: at }
    }),
    reverted,
  }
}

export type TopicBackfillPlan = {
  /** Cards that would get a topic (or change from "Other"). */
  changes: Array<MistakeChange & { basis: MistakeTopicMatch["basis"]; ambiguous: boolean }>
  /** Every in-scope card that ends up in the fallback topic, for a person (or model) to reclassify. */
  unmatched: Array<{ id: string; question: string; areaOfStudy: string | null }>
  /** Cards already holding a real topic, left alone. */
  alreadyTopical: number
  /** Cards outside the scope: no exam, another subject, or a subject without a topic list. */
  skipped: number
}

/**
 * Maps cards without a topic to one by keyword. Idempotent: a card with a real topic is never touched and
 * a card whose inference equals what it holds produces no change, so a second run has nothing to do.
 * Cards stuck in the fallback are re-tried, so growing the rule table and re-running picks them up.
 */
export function planTopicBackfill(attempts: readonly ExamAttempt[], mistakes: readonly Mistake[], subject?: string): TopicBackfillPlan {
  const subjectOf = new Map(attempts.map((attempt) => [attempt.id, attempt.subject]))
  const plan: TopicBackfillPlan = { changes: [], unmatched: [], alreadyTopical: 0, skipped: 0 }
  for (const mistake of mistakes) {
    const cardSubject = subjectOf.get(mistake.attemptId)
    const config = cardSubject && (!subject || normaliseComparisonName(cardSubject) === normaliseComparisonName(subject)) ? topicConfigFor(cardSubject) : undefined
    if (!config) { plan.skipped += 1; continue }
    if (mistake.topic && mistake.topic !== config.fallback) { plan.alreadyTopical += 1; continue }
    const match = inferMistakeTopic(config, mistake)
    const change = diffMistake(mistake, { topic: match.topic })
    if (change) plan.changes.push({ ...change, basis: match.basis, ambiguous: match.ambiguous })
    if (match.topic === config.fallback) plan.unmatched.push({ id: mistake.id, question: mistake.question, areaOfStudy: mistake.areaOfStudy ?? null })
  }
  return plan
}
