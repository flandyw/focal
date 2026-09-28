import { ATAR_AGGREGATE_REFERENCES, type AtarAggregateReference } from "@/lib/atar-data"

export type AtarStudyResult = {
  id: string
  code: string
  studyName: string
  rawScore: number
  scaledScore: number
}

export type AtarContribution = AtarStudyResult & {
  contribution: number
  role: "English" | "Primary" | "Increment"
}

export type AtarEstimate = {
  aggregate: number
  atar: number | null
  atarLabel: string
  primaryFour: AtarContribution[]
  increments: AtarContribution[]
  excluded: AtarStudyResult[]
  reference: AtarAggregateReference
}

const ENGLISH_CODES = new Set(["EN", "EF", "EG", "LI"])
const MATHEMATICS_CODES = new Set(["MA10", "NF", "NJ", "NS"])
const HISTORY_CODES = new Set(["HI17", "HA", "HR"])
const INFORMATION_TECHNOLOGY_CODES = new Set(["AL03", "IT02", "IT03", "IN60", "ET16"])
const MUSIC_CODES = new Set(["MD", "MC06", "MC05", "MC04", "MI19", "MI30"])
const CONTEMPORARY_SOCIETY_CODES = new Set(["SO03"])
const LANGUAGE_CODES = new Set([
  "AI", "AR", "AM", "AU", "BE", "LO50", "LO53", "CN", "LO57", "CK", "CL", "AG",
  "LO51", "CR", "DU", "FP", "FR", "GN", "MG", "HB", "HI", "HU", "IN", "IX", "IL",
  "JA", "JS", "LO55", "KH", "KO", "KS", "LA", "MA", "PN", "PO", "PG", "LO49", "RO",
  "RU", "SE", "SI", "SP", "SW", "TA", "TU", "LO54", "LO31", "LO52",
])

const VET_INDUSTRY_GROUPS: Record<string, string> = {
  BU23: "vet-business-services",
  CT41: "vet-community-services",
  MU07: "vet-creative-arts",
  DN17: "vet-creative-arts",
  EG47: "vet-engineering",
  EQ08: "vet-animal-care",
  FN40: "vet-furnishing",
  HL08: "vet-health",
  HL06: "vet-health",
  HS63: "vet-hospitality",
  HS65: "vet-hospitality",
  LB26: "vet-laboratory-operations",
  SR80: "vet-sport-fitness-recreation",
}

function roundTo(value: number, places: number) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export function isEnglishStudy(code: string) {
  return ENGLISH_CODES.has(code)
}

export function studyAreaGroup(code: string): string | null {
  if (ENGLISH_CODES.has(code)) return "english"
  if (MATHEMATICS_CODES.has(code)) return "mathematics"
  if (HISTORY_CODES.has(code)) return "history"
  if (INFORMATION_TECHNOLOGY_CODES.has(code)) return "information-technology"
  if (MUSIC_CODES.has(code)) return "music"
  if (CONTEMPORARY_SOCIETY_CODES.has(code)) return "contemporary-society"
  if (LANGUAGE_CODES.has(code)) return "languages"
  return VET_INDUSTRY_GROUPS[code] ?? null
}

function languageEquivalenceKey(studyName: string): string | null {
  const match = studyName.match(/^(Chinese|Indonesian|Japanese|Korean|Vietnamese)\b/i)
  return match ? `language:${match[1].toLowerCase()}` : null
}

export function equivalenceKey(result: Pick<AtarStudyResult, "code" | "studyName">): string {
  if (result.code === "EN" || result.code === "EF") return "english-or-eal"
  return languageEquivalenceKey(result.studyName) ?? `study:${result.code}`
}

function deduplicateEquivalentStudies(results: AtarStudyResult[]): AtarStudyResult[] {
  const best = new Map<string, AtarStudyResult>()
  for (const result of results) {
    const key = equivalenceKey(result)
    const current = best.get(key)
    if (!current || result.scaledScore > current.scaledScore) best.set(key, result)
  }
  return [...best.values()]
}

function combinations<T>(values: T[], size: number): T[][] {
  if (size === 0) return [[]]
  if (values.length < size) return []
  const output: T[][] = []
  for (let index = 0; index <= values.length - size; index += 1) {
    for (const tail of combinations(values.slice(index + 1), size - 1)) {
      output.push([values[index], ...tail])
    }
  }
  return output
}

function countGroups(results: AtarStudyResult[]) {
  const counts = new Map<string, number>()
  for (const result of results) {
    const group = studyAreaGroup(result.code)
    if (group) counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return counts
}

function primaryCombinationIsPermissible(results: AtarStudyResult[]) {
  return [...countGroups(results).values()].every((count) => count <= 2)
}

function chooseIncrements(primary: AtarStudyResult[], remaining: AtarStudyResult[]) {
  const groupCounts = countGroups(primary)
  const increments: AtarStudyResult[] = []
  for (const result of remaining.toSorted((first, second) => second.scaledScore - first.scaledScore)) {
    const group = studyAreaGroup(result.code)
    if (group && (groupCounts.get(group) ?? 0) >= 3) continue
    increments.push(result)
    if (group) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1)
    if (increments.length === 2) break
  }
  return increments
}

export function aggregateToAtar(
  aggregate: number,
  reference: AtarAggregateReference,
): { atar: number | null; label: string } {
  const points = reference.points.toSorted((first, second) => first.aggregate - second.aggregate)
  const lowest = points[0]
  const highest = points.at(-1)
  if (!lowest || !highest || !Number.isFinite(aggregate)) return { atar: null, label: "—" }
  if (aggregate < lowest.aggregate) return { atar: null, label: `<${lowest.atar.toFixed(2)}` }
  if (aggregate >= highest.aggregate) return { atar: highest.atar, label: highest.atar.toFixed(2) }

  const upperIndex = points.findIndex((point) => point.aggregate > aggregate)
  const lower = points[upperIndex - 1]
  const upper = points[upperIndex]
  const position = (aggregate - lower.aggregate) / (upper.aggregate - lower.aggregate)
  const interpolated = lower.atar + position * (upper.atar - lower.atar)
  const atar = Math.round(interpolated * 20) / 20
  return { atar, label: atar.toFixed(2) }
}

export function estimateAtar(results: AtarStudyResult[], year: number): AtarEstimate | null {
  const reference = ATAR_AGGREGATE_REFERENCES.find((item) => item.year === year)
  if (!reference) return null

  const valid = deduplicateEquivalentStudies(results.filter((result) =>
    Number.isFinite(result.rawScore) &&
    Number.isFinite(result.scaledScore) &&
    result.rawScore >= 0 &&
    result.rawScore <= 50 &&
    result.scaledScore >= 0,
  ))
  if (valid.length < 4) return null

  const english = valid
    .filter((result) => isEnglishStudy(result.code))
    .toSorted((first, second) => second.scaledScore - first.scaledScore)[0]
  if (!english) return null

  let best: { primary: AtarStudyResult[]; increments: AtarStudyResult[]; aggregate: number } | null = null
  const others = valid.filter((result) => result.id !== english.id)
  for (const additionalPrimary of combinations(others, 3)) {
    const primary = [english, ...additionalPrimary]
    if (!primaryCombinationIsPermissible(primary)) continue
    const primaryIds = new Set(primary.map((result) => result.id))
    const increments = chooseIncrements(primary, valid.filter((result) => !primaryIds.has(result.id)))
    const aggregate = primary.reduce((total, result) => total + result.scaledScore, 0) +
      increments.reduce((total, result) => total + result.scaledScore * 0.1, 0)
    if (!best || aggregate > best.aggregate) best = { primary, increments, aggregate }
  }
  if (!best) return null

  const primaryFour = best.primary
    .map((result) => ({
      ...result,
      contribution: result.scaledScore,
      role: result.id === english.id ? "English" as const : "Primary" as const,
    }))
    .toSorted((first, second) => {
      if (first.role === "English" && second.role !== "English") return -1
      if (second.role === "English" && first.role !== "English") return 1
      return second.contribution - first.contribution
    })
  const increments = best.increments.map((result) => ({
    ...result,
    contribution: result.scaledScore * 0.1,
    role: "Increment" as const,
  }))
  const selectedIds = new Set([...primaryFour, ...increments].map((result) => result.id))
  const conversion = aggregateToAtar(best.aggregate, reference)

  return {
    aggregate: roundTo(best.aggregate, 2),
    atar: conversion.atar,
    atarLabel: conversion.label,
    primaryFour,
    increments,
    excluded: valid.filter((result) => !selectedIds.has(result.id)),
    reference,
  }
}
