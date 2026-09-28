import { describe, expect, test } from "bun:test"
import { ATAR_AGGREGATE_REFERENCES } from "../src/lib/atar-data"
import { aggregateToAtar, estimateAtar, type AtarStudyResult } from "../src/lib/atar"

function result(code: string, studyName: string, scaledScore: number): AtarStudyResult {
  return { id: code, code, studyName, rawScore: 40, scaledScore }
}

describe("ATAR estimation", () => {
  test("uses exact official aggregate checkpoints and caps at 99.95", () => {
    const reference = ATAR_AGGREGATE_REFERENCES.find((item) => item.year === 2025)!
    expect(aggregateToAtar(192.10, reference)).toEqual({ atar: 99, label: "99.00" })
    expect(aggregateToAtar(211.42, reference)).toEqual({ atar: 99.95, label: "99.95" })
    expect(aggregateToAtar(230, reference)).toEqual({ atar: 99.95, label: "99.95" })
    expect(aggregateToAtar(70, reference)).toEqual({ atar: null, label: "<40.00" })
  })

  test("requires an English-group result and four permissible studies", () => {
    expect(estimateAtar([
      result("NJ", "Mathematical Methods", 45),
      result("CH", "Chemistry", 42),
      result("PH", "Physics", 41),
      result("PE", "Physical Education", 38),
    ], 2025)).toBeNull()
  })

  test("uses English, the best primary three and two ten-percent increments", () => {
    const estimate = estimateAtar([
      result("EN", "English", 40),
      result("CH", "Chemistry", 45),
      result("PH", "Physics", 44),
      result("PE", "Physical Education", 43),
      result("BI", "Biology", 42),
      result("PY", "Psychology", 41),
    ], 2025)

    expect(estimate?.primaryFour.map((item) => item.code)).toEqual(["EN", "CH", "PH", "PE"])
    expect(estimate?.increments.map((item) => item.code)).toEqual(["BI", "PY"])
    expect(estimate?.aggregate).toBe(180.3)
  })

  test("limits mathematics to two primary studies and three total", () => {
    const estimate = estimateAtar([
      result("EN", "English", 35),
      result("NS", "Specialist Mathematics", 50),
      result("NJ", "Mathematical Methods", 49),
      result("NF", "General Mathematics", 48),
      result("MA10", "Foundation Mathematics", 47),
      result("CH", "Chemistry", 40),
      result("PE", "Physical Education", 39),
    ], 2025)

    expect(estimate?.primaryFour.map((item) => item.code)).toEqual(["EN", "NS", "NJ", "CH"])
    expect(estimate?.increments.map((item) => item.code)).toEqual(["NF", "PE"])
    expect(estimate?.excluded.map((item) => item.code)).toContain("MA10")
  })

  test("treats English and EAL and same-language variants as equivalents", () => {
    const estimate = estimateAtar([
      result("EN", "English", 38),
      result("EF", "English as an Additional Language", 41),
      result("CN", "Chinese First Language", 44),
      result("CL", "Chinese Second Language", 48),
      result("CH", "Chemistry", 43),
      result("PH", "Physics", 42),
      result("PE", "Physical Education", 40),
    ], 2025)

    const included = [...(estimate?.primaryFour ?? []), ...(estimate?.increments ?? [])].map((item) => item.code)
    expect(included).toContain("EF")
    expect(included).not.toContain("EN")
    expect(included).toContain("CL")
    expect(included).not.toContain("CN")
  })
})
