import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  interpolateScaledScore,
  normaliseScalingStudyName,
  predictScaledStudyScore,
  type ScalingReference,
} from "../src/lib/scaling"
import { extractPageText, parseScalingReportText, REPORTS } from "../vtac/import-scaling-reports.mjs"

const points = [20, 25, 30, 35, 40, 45, 50].map((rawScore, index) => ({
  rawScore,
  scaledScore: [21, 28, 35, 41, 46, 49, 51][index],
}))

describe("VTAC scaling", () => {
  test("parses a scaling row extracted from the official PDF", () => {
    const references = parseScalingReportText({
      year: 2025,
      url: "https://example.test/scaling.pdf",
      text: "NJ Mathematical Methods 34.4 8.4 21 28 35 41 46 49 51",
    })
    expect(references).toEqual([expect.objectContaining({
      code: "NJ",
      studyName: "Mathematical Methods",
      year: 2025,
      points,
    })])
  })

  test("parses archive rows without study codes", () => {
    const references = parseScalingReportText({
      year: 2012,
      url: "https://example.test/archive-scaling.pdf",
      text: "Mathematical Methods (CAS) 35.1 7.1 24 30 36 41 45 48 50",
    })
    expect(references).toEqual([expect.objectContaining({
      code: "LEGACY_MATHEMATICAL_METHODS_CAS",
      studyName: "Mathematical Methods (CAS)",
      year: 2012,
      points: [20, 25, 30, 35, 40, 45, 50].map((rawScore, index) => ({
        rawScore,
        scaledScore: [24, 30, 36, 41, 45, 48, 50][index],
      })),
    })])
  })

  test("recovers rows when a PDF page has collapsed coordinates", () => {
    const text = extractPageText([
      {
        str: "LA Latin 45.0 6.5 35 41 46 50 52 54 55",
        transform: [1, 0, 0, 1, 10, 100],
        hasEOL: true,
      },
      {
        str: "MA Macedonian 32.4 6.7 23 28 32 36 40 45 50",
        transform: [1, 0, 0, 1, 10, 100],
        hasEOL: true,
      },
    ])
    const references = parseScalingReportText({
      year: 2018,
      url: "https://example.test/scaling-2018.pdf",
      text,
    })
    expect(references.map((reference) => reference.code)).toEqual(["LA", "MA"])
  })

  test("accepts an appended page footer and removes duplicate rows", () => {
    const row = "KS Korean Second Language 38.4 6.8 27 33 39 43 47 50 52 14 December 2018 2 of 3"
    const references = parseScalingReportText({
      year: 2018,
      url: "https://example.test/scaling-2018.pdf",
      text: `${row}\n${row}`,
    })
    expect(references).toEqual([expect.objectContaining({
      code: "KS",
      studyName: "Korean Second Language",
      points: expect.arrayContaining([{ rawScore: 50, scaledScore: 52 }]),
    })])
  })

  test("catalogues current and archive scaling reports from 2012 to 2025", () => {
    expect(REPORTS.map((report) => report.year).toSorted()).toEqual(
      Array.from({ length: 14 }, (_, index) => 2012 + index),
    )
  })

  test("normalises legacy study names for historical comparisons", () => {
    expect(normaliseScalingStudyName("Mathematical Methods (CAS)")).toBe("mathematical methods")
    expect(normaliseScalingStudyName("Further Mathematics")).toBe("general mathematics")
    expect(normaliseScalingStudyName("Chinese (SL Advanced)")).toBe("chinese second language advanced")
    expect(normaliseScalingStudyName("English (ESL)")).toBe("english as an additional language")
  })

  test("interpolates between the raw scores published by VTAC", () => {
    expect(interpolateScaledScore(40, points)).toBe(46)
    expect(interpolateScaledScore(42.5, points)).toBe(47.5)
    expect(interpolateScaledScore(19, points)).toBeNull()
  })

  test("averages matching estimates across available report years", () => {
    const references: ScalingReference[] = [
      { id: "NJ:2024", code: "NJ", studyName: "Mathematical Methods", year: 2024, mean: 34, standardDeviation: 8, sourceUrl: "2024.pdf", points },
      { id: "LEGACY_MATHEMATICAL_METHODS_CAS:2012", code: "LEGACY_MATHEMATICAL_METHODS_CAS", studyName: "Mathematical Methods (CAS)", year: 2012, mean: 34, standardDeviation: 8, sourceUrl: "2012.pdf", points: points.map((point) => ({ ...point, scaledScore: point.scaledScore + 1 })) },
    ]
    expect(predictScaledStudyScore(40, "Mathematical Methods", references)).toMatchObject({
      scaledScore: 46.5,
      minimum: 46,
      maximum: 47,
    })
    expect(predictScaledStudyScore(40, "Mathematical Methods", references, 2024)).toMatchObject({
      scaledScore: 46,
      minimum: 46,
      maximum: 46,
      yearEstimates: [expect.objectContaining({ year: 2024 })],
    })
  })

  test("bundles valid and unique 2012–2025 scaling references", () => {
    const data = JSON.parse(readFileSync(new URL("../public/vtac-scaling-reports.json", import.meta.url), "utf8")) as {
      references: ScalingReference[]
    }
    const expectedYears = REPORTS.map((report) => report.year).toSorted()
    expect(data.references.length).toBeGreaterThanOrEqual(REPORTS.length * 50)
    expect(new Set(data.references.map((reference) => reference.id)).size).toBe(data.references.length)
    expect([...new Set(data.references.map((reference) => reference.year))].toSorted()).toEqual(expectedYears)
    expect(data.references.filter((reference) => normaliseScalingStudyName(reference.studyName) === "mathematical methods")).toHaveLength(REPORTS.length)
    expect(data.references.every((reference) => reference.points.length === 7)).toBe(true)
  })
})
