import { writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const VCAA_GRADE_DISTRIBUTION_PAGES = [
    {
        year: 2025,
        url: "https://www.vcaa.vic.edu.au/administration/school-administration/performance-senior-secondary/2025-grade-distributions-vce-graded-assessments",
    },
    {
        year: 2024,
        url: "https://www.vcaa.vic.edu.au/administration/school-administration/performance-senior-secondary/2024-grade-distributions-vce-graded-assessments",
    },
    {
        year: 2023,
        url: "https://www.vcaa.vic.edu.au/administration/school-administration/performance-senior-secondary/2023-grade-distributions-graded-assessment-vce",
    },
    {
        year: 2022,
        url: "https://www.vcaa.vic.edu.au/administration/school-administration/performance-senior-secondary/2022-grade-distributions-graded-assessment-vce",
    },
    {
        year: 2021,
        url: "https://www.vcaa.vic.edu.au/administration/school-administration/performance-senior-secondary/2021-grade-distributions-graded-assessment-vce",
    },
];

const GRADES = ["UG", "E", "E+", "D", "D+", "C", "C+", "B", "B+", "A", "A+"];
const DEFAULT_OUT = "public/vcaa-grade-distributions.json";
const PARSER_VERSION = "vcaa-inline-html-all-v1";
const STANDARD_FONT_DATA_URL = `${resolve("node_modules/pdfjs-dist/standard_fonts")}${sep}`;

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const pages = args.year
        ? VCAA_GRADE_DISTRIBUTION_PAGES.filter(
              (page) => page.year === args.year,
          )
        : VCAA_GRADE_DISTRIBUTION_PAGES;
    if (pages.length === 0)
        throw new Error(`No configured VCAA page for year ${args.year}`);

    const parsedPages = [];
    for (const page of pages) {
        const html = await fetchHtml(page.url);
        const parsed = parseGradeDistributionPage({ ...page, html });
        if (parsed.assessments.length === 0) {
            const pdfParsed = await parsePdfIndexPage({ ...page, html });
            parsed.assessments = pdfParsed.assessments;
            parsed.studyCount = pdfParsed.studyCount;
            parsed.failedPdfCount = pdfParsed.failedPdfCount;
        }
        parsedPages.push(parsed);
        process.stderr.write(
            `Parsed ${parsed.assessments.length} assessment tables across ${parsed.studyCount} studies for ${page.year}${
                parsed.failedPdfCount
                    ? ` (${parsed.failedPdfCount} PDFs skipped)`
                    : ""
            }.\n`,
        );
    }

    const json = toReferenceJson(parsedPages);
    const output = resolve(args.out ?? DEFAULT_OUT);
    writeFileSync(output, json);
    process.stderr.write(`Wrote ${output}\n`);
}

function parseArgs(argv) {
    const args = { out: null, year: null };
    for (let index = 0; index < argv.length; index += 1) {
        const flag = argv[index];
        const value = argv[index + 1];
        if (flag === "--out") {
            args.out = value;
            index += 1;
        } else if (flag === "--year") {
            args.year = Number(value);
            index += 1;
        }
    }
    return args;
}

async function fetchHtml(url) {
    const response = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 VCE Tracker importer" },
    });
    if (!response.ok)
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return response.text();
}

function parseGradeDistributionPage({ year, url, html }) {
    const headingPattern =
        /<p class="MuiTypography-root MuiTypography-body1 font-vic-semibold! css-fyswvn">([\s\S]*?)<\/p>/g;
    const headings = [...html.matchAll(headingPattern)].map((match) => ({
        title: cleanText(match[1]),
        index: match.index ?? 0,
    }));

    const assessments = [];
    const studyCodes = new Set();

    headings.forEach((heading, index) => {
        const next = headings[index + 1]?.index ?? html.length;
        const chunk = html.slice(heading.index, next);
        const parsedStudy = parseStudyChunk({
            year,
            pageUrl: url,
            title: heading.title,
            chunk,
        });
        if (!parsedStudy || parsedStudy.assessments.length === 0) return;
        studyCodes.add(parsedStudy.studyCode);
        assessments.push(...parsedStudy.assessments);
    });

    return { year, url, studyCount: studyCodes.size, assessments };
}

async function parsePdfIndexPage({ year, url, html }) {
    const links = extractPdfLinks(html);
    const assessments = [];
    let failedPdfCount = 0;
    for (const link of links) {
        try {
            const response = await fetch(link.url, {
                headers: { "user-agent": "Mozilla/5.0 VCE Tracker importer" },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await extractPdfText(await response.arrayBuffer());
            const parsed = parseGradeDistributionPdfText({
                text,
                year,
                pageUrl: url,
                pdfUrl: link.url,
                fallbackStudyName: link.label,
            });
            assessments.push(...parsed);
        } catch {
            failedPdfCount += 1;
        }
    }

    return {
        assessments,
        studyCount: new Set(
            assessments.map((assessment) => assessment.studyCode),
        ).size,
        failedPdfCount,
    };
}

async function extractPdfText(buffer) {
    const document = await getDocument({
        data: new Uint8Array(buffer),
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
    }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const rows = new Map();
        for (const item of content.items) {
            if (!("str" in item) || !item.str.trim()) continue;
            const y = Math.round(item.transform[5] / 2) * 2;
            const row = rows.get(y) ?? [];
            row.push({ x: item.transform[4], text: item.str });
            rows.set(y, row);
        }
        pages.push(
            [...rows.entries()]
                .sort(([first], [second]) => second - first)
                .map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join("  "))
                .join("\n"),
        );
    }
    return pages.join("\n");
}

function extractPdfLinks(html) {
    const seen = new Set();
    const links = [];
    for (const match of html.matchAll(
        /<a[^>]+href="([^"]+?\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi,
    )) {
        const href = normalizeVcaaUrl(decodeEntities(match[1]));
        const label = cleanText(match[2]);
        if (!href || !label || seen.has(href)) continue;
        seen.add(href);
        links.push({ url: href, label });
    }
    return links;
}

function parseGradeDistributionPdfText({
    text,
    year,
    pageUrl,
    pdfUrl,
    fallbackStudyName,
}) {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const studyName = cleanStudyName(lines[0] ?? fallbackStudyName);
    const displayName = studyName;
    const studyCode = stableStudyCode(displayName);
    const assessments = [];

    for (let index = 0; index < lines.length; index += 1) {
        const gaMatch = lines[index]?.match(/^Graded Assessment\s+(\d+)/i);
        if (!gaMatch) continue;
        const gaCode = `GA ${gaMatch[1]}`;
        const detail = findNextDetailLine(lines, index + 1, year);
        const totalIndex = findNextLineIndex(lines, index, /^Total\s+n\s+/i);
        const scoreRangeIndex = findNextLineIndex(
            lines,
            index,
            /^Score Ranges\s+/i,
        );
        if (totalIndex === -1 || scoreRangeIndex === -1) continue;
        const percentageIndex = findNextLineIndex(
            lines,
            totalIndex + 1,
            /^%\s+/,
        );
        if (percentageIndex === -1 || percentageIndex > scoreRangeIndex)
            continue;

        const countTokens = tokenizePdfRow(lines[totalIndex]).slice(2);
        const percentageTokens = tokenizePdfRow(lines[percentageIndex]).slice(
            1,
        );
        const rangeTokens = parsePdfScoreRanges(lines[scoreRangeIndex]);
        const gradeBands = GRADES.map((grade, gradeIndex) => {
            const range = parseScoreRange(rangeTokens[gradeIndex]);
            return {
                grade,
                minScore: range.min,
                maxScore: range.max,
                count: parseInteger(countTokens[gradeIndex]),
                percentage: parseNumber(percentageTokens[gradeIndex]),
                sortOrder: gradeIndex,
                rawRow: {
                    source: "official VCAA PDF text",
                    assessment: gaCode,
                    detail,
                    pdf_url: pdfUrl,
                    page_url: pageUrl,
                    grade,
                    score_range: rangeTokens[gradeIndex] ?? null,
                },
            };
        }).filter(
            (band) =>
                band.count !== null ||
                band.percentage !== null ||
                band.minScore !== null,
        );

        if (gradeBands.length === 0) continue;
        assessments.push({
            studyName,
            displayName,
            studyCode,
            studyArea: null,
            year,
            gaCode,
            name: normalizeAssessmentName(detail || gaCode),
            maxScore: inferMaxScore(gradeBands),
            weightingPercent: null,
            sortOrder: assessmentSortOrder(gaCode),
            sourceUrl: pdfUrl,
            gradeBands,
        });
    }

    return assessments;
}

function parseStudyChunk({ year, pageUrl, title, chunk }) {
    if (!chunk.includes("<table")) return null;
    const studyHeading = firstMatch(chunk, /<h3>([\s\S]*?)<\/h3>/) ?? title;
    const studyName = cleanStudyName(studyHeading);
    const displayName = cleanStudyName(title);
    const studyCode = stableStudyCode(studyName);
    const studyArea = displayName.includes(":")
        ? (displayName.split(":")[0]?.trim() ?? null)
        : null;
    const pdfUrl = normalizeVcaaUrl(firstMatch(chunk, /href="([^"]+?\.pdf)"/i));

    const assessmentPattern =
        /<h4>([\s\S]*?)<\/h4>[\s\S]*?<p>([\s\S]*?)<\/p>[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/g;
    const assessments = [];
    for (const match of chunk.matchAll(assessmentPattern)) {
        const h4 = cleanText(match[1]);
        const detail = cleanText(match[2]);
        const table = parseTable(match[3]);
        const gradeBands = parseGradeBands(table, {
            h4,
            detail,
            pdfUrl,
            pageUrl,
        });
        if (gradeBands.length === 0) continue;
        const gaCode = normalizeGaCode(h4);
        assessments.push({
            studyName,
            displayName,
            studyCode,
            studyArea,
            year,
            gaCode,
            name: normalizeAssessmentName(detail || h4),
            maxScore: inferMaxScore(gradeBands),
            weightingPercent: null,
            sortOrder: assessmentSortOrder(gaCode),
            sourceUrl: pdfUrl ?? pageUrl,
            gradeBands,
        });
    }

    return { studyCode, assessments };
}

function parseTable(tableHtml) {
    return [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(
        (rowMatch) =>
            [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(
                (cellMatch) => cleanText(cellMatch[1]),
            ),
    );
}

function parseGradeBands(tableRows, metadata) {
    const header = tableRows[0] ?? [];
    const totalIndex = tableRows.findIndex(
        (row) => row[0] === "Total" && row[1] === "N",
    );
    const rangeRow = tableRows.find((row) => row[0] === "Score Ranges");
    if (totalIndex === -1 || !rangeRow) return [];
    const countRow = tableRows[totalIndex];
    const percentageRow = tableRows[totalIndex + 1] ?? [];

    const bands = [];
    for (let column = 2; column < header.length; column += 1) {
        const grade = header[column];
        if (!GRADES.includes(grade)) continue;
        const range = parseScoreRange(rangeRow[column]);
        bands.push({
            grade,
            minScore: range.min,
            maxScore: range.max,
            count: parseInteger(countRow[column]),
            percentage: parseNumber(percentageRow[column]),
            sortOrder: bands.length,
            rawRow: {
                source: "official VCAA inline HTML table",
                assessment: metadata.h4,
                detail: metadata.detail,
                pdf_url: metadata.pdfUrl,
                page_url: metadata.pageUrl,
                grade,
                score_range: rangeRow[column] ?? null,
            },
        });
    }
    return bands;
}

function findNextDetailLine(lines, startIndex, year) {
    for (
        let index = startIndex;
        index < Math.min(lines.length, startIndex + 8);
        index += 1
    ) {
        const line = lines[index];
        if (!line || /^Table of Grade Distribution/i.test(line)) continue;
        if (String(year) === line) continue;
        if (/^Grade\s+UG/i.test(line)) continue;
        return line.replace(new RegExp(`\\b${year}\\b`, "g"), "").trim();
    }
    return "";
}

function findNextLineIndex(lines, startIndex, pattern) {
    for (
        let index = startIndex;
        index < Math.min(lines.length, startIndex + 80);
        index += 1
    ) {
        if (pattern.test(lines[index] ?? "")) return index;
    }
    return -1;
}

function tokenizePdfRow(line) {
    return line.replace(/\s+/g, " ").trim().split(" ");
}

function parsePdfScoreRanges(line) {
    const tokens = tokenizePdfRow(line).slice(2);
    const maxIndex = tokens.findIndex((token) => /^Max$/i.test(token));
    const usable = maxIndex === -1 ? tokens : tokens.slice(0, maxIndex);
    return usable.filter((token) => !/^N\/A$/i.test(token));
}

function toReferenceJson(parsedPages) {
    const assessments = parsedPages.flatMap((page) =>
        page.assessments
            .filter((assessment) => /examination/i.test(assessment.name))
            .map((assessment) => ({
                id: `${assessment.studyCode}:${assessment.year}:${assessment.gaCode.replace(/\s+/g, "-")}`,
                studyCode: assessment.studyCode,
                studyName: assessment.studyName,
                displayName: assessment.displayName,
                year: assessment.year,
                gaCode: assessment.gaCode,
                name: assessment.name,
                maxScore: assessment.maxScore,
                sourceUrl: assessment.sourceUrl ?? page.url,
                gradeBands: assessment.gradeBands.map(({ rawRow: _rawRow, ...band }) => band),
            })),
    );
    if (assessments.length === 0) throw new Error("No VCAA examination distributions were parsed");
    return `${JSON.stringify({ parserVersion: PARSER_VERSION, generatedAt: new Date().toISOString(), assessments }, null, 2)}\n`;
}

function firstMatch(value, pattern) {
    const match = value.match(pattern);
    return match ? cleanText(match[1]) : null;
}

function cleanText(value) {
    return decodeEntities(value)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function decodeEntities(value) {
    return value
        .replaceAll("&nbsp;", " ")
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&#x27;", "'")
        .replaceAll("&#039;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">");
}

function cleanStudyName(value) {
    const text = cleanText(value);
    const name = text.includes(":")
        ? text.split(":").slice(1).join(":").trim()
        : text;
    return name.replace(/^LOTE\s+/i, "");
}

function normalizeAssessmentName(value) {
    return (
        cleanText(value)
            .replace(/\b20\d{2}\b/g, "")
            .trim() || "Graded assessment"
    );
}

function normalizeGaCode(value) {
    const match = value.match(/(\d+)/);
    return match ? `GA ${match[1]}` : cleanText(value);
}

function stableStudyCode(value) {
    return cleanText(value)
        .toUpperCase()
        .replace(/&/g, " AND ")
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function assessmentSortOrder(gaCode) {
    const match = gaCode.match(/\d+/);
    return match ? Number(match[0]) : 0;
}

function parseScoreRange(value) {
    if (!value || /^N\/A$/i.test(value)) return { min: null, max: null };
    const match = value
        .replace(/\s/g, "")
        .match(/^(\d+(?:\.\d+)?)(?:[-–](\d+(?:\.\d+)?))?$/);
    if (!match) return { min: null, max: null };
    const first = Number(match[1]);
    const second = match[2] ? Number(match[2]) : first;
    return { min: Math.min(first, second), max: Math.max(first, second) };
}

function inferMaxScore(bands) {
    const max = Math.max(...bands.map((band) => band.maxScore ?? 0));
    return Number.isFinite(max) && max > 0 ? max : null;
}

function parseInteger(value) {
    if (!value) return null;
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isInteger(parsed) ? parsed : null;
}

function parseNumber(value) {
    if (!value) return null;
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeVcaaUrl(value) {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    const path = value.startsWith("/") ? value : `/${value}`;
    return `https://www.vcaa.vic.edu.au${path}`;
}

if (import.meta.main) {
    main().catch((error) => {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
    });
}

export { parseGradeDistributionPdfText, parseScoreRange, toReferenceJson };
