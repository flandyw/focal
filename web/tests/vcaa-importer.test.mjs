import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
    parseGradeDistributionPdfText,
    parseScoreRange,
    toReferenceJson,
} from "../vcaa/import-all-grade-distributions.mjs";

const grades = ["UG", "E", "E+", "D", "D+", "C", "C+", "B", "B+", "A", "A+"];
const text = `Mathematical Methods
Graded Assessment 2
WRITTEN EXAMINATION 1 2025
Grade ${grades.join(" ")}
Total n 1 2 3 4 5 6 7 8 9 10 11
% 1 2 3 4 5 6 7 8 9 20 31
Score Ranges 0 1-2 3-4 5-6 7-8 9-10 11-12 13-14 15-16 17-18 19-20 Max 20`;

describe("VCAA importer", () => {
    test("parses examination bands and emits app reference JSON", () => {
        const assessments = parseGradeDistributionPdfText({
            text,
            year: 2025,
            pageUrl: "https://example.test/page",
            pdfUrl: "https://example.test/methods.pdf",
            fallbackStudyName: "Mathematical Methods",
        });
        expect(assessments).toHaveLength(1);
        expect(assessments[0].gradeBands).toHaveLength(11);
        expect(assessments[0].maxScore).toBe(20);

        const json = JSON.parse(toReferenceJson([{ year: 2025, url: "https://example.test/page", assessments }]));
        expect(json.assessments).toHaveLength(1);
        expect(json.assessments[0].sourceUrl).toBe("https://example.test/methods.pdf");
    });

    test("normalises score ranges", () => {
        expect(parseScoreRange("18-12")).toEqual({ min: 12, max: 18 });
        expect(parseScoreRange("N/A")).toEqual({ min: null, max: null });
    });

    test("merges legacy LOTE study names into the current language name", () => {
        const assessments = parseGradeDistributionPdfText({
            text: text.replace("Mathematical Methods", "LOTE French"),
            year: 2025,
            pageUrl: "https://example.test/page",
            pdfUrl: "https://example.test/french.pdf",
            fallbackStudyName: "LOTE French",
        });
        expect(assessments[0].studyName).toBe("French");
        expect(assessments[0].studyCode).toBe("FRENCH");
    });

    test("bundles valid and unique 2021-2025 examination references", () => {
        const bundle = JSON.parse(readFileSync(new URL("../public/vcaa-grade-distributions.json", import.meta.url), "utf8"));
        const ids = bundle.assessments.map((assessment) => assessment.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(bundle.assessments.some((assessment) => /^LOTE\s/i.test(assessment.studyName))).toBe(false);
        expect([...new Set(bundle.assessments.map((assessment) => assessment.year))].sort()).toEqual([2021, 2022, 2023, 2024, 2025]);
        expect(bundle.assessments.every((assessment) =>
            assessment.maxScore > 0 &&
            assessment.sourceUrl.startsWith("https://www.vcaa.vic.edu.au/") &&
            assessment.gradeBands.length > 0 &&
            assessment.gradeBands.every((band) => band.percentage === null || (band.percentage >= 0 && band.percentage <= 100)),
        )).toBe(true);
    });
});
