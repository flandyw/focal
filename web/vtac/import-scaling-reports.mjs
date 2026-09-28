import { writeFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"

const CURRENT_REPORTS = [
  { year: 2025, url: "https://vtac.edu.au/files/pdf/reports/scaling-report-25.pdf" },
  { year: 2024, url: "https://vtac.edu.au/files/pdf/reports/scaling-report-24.pdf" },
  { year: 2023, url: "https://vtac.edu.au/files/pdf/reports/scaling-report-23-24.pdf" },
  { year: 2022, url: "https://vtac.edu.au/files/pdf/reports/scaling-report-22-23.pdf" },
  { year: 2021, url: "https://vtac.edu.au/files/pdf/reports/scaling-report-21-22.pdf" },
]
const ARCHIVE_REPORTS = [
  { year: 2020, url: "https://vtac.edu.au/files/pdf/reports/scaling-report-20-21.pdf" },
  { year: 2019, url: "https://vtac.edu.au/files/pdf/reports/scaling_report_19.pdf" },
  { year: 2018, url: "https://vtac.edu.au/files/pdf/scaling_report_18.pdf" },
  { year: 2017, url: "https://vtac.edu.au/files/pdf/scaling_report_17.pdf" },
  { year: 2016, url: "https://vtac.edu.au/files/pdf/scaling_report_16.pdf" },
  { year: 2015, url: "https://vtac.edu.au/files/pdf/scaling-report-15.pdf" },
  { year: 2014, url: "https://vtac.edu.au/files/pdf/scaling_report_2014.pdf" },
  { year: 2013, url: "https://vtac.edu.au/pdf/scaling_report.pdf" },
  { year: 2012, url: "https://vtac.edu.au/pdf/scaling_report_2013.pdf" },
]
const REPORTS = [...CURRENT_REPORTS, ...ARCHIVE_REPORTS]
const RAW_SCORES = [20, 25, 30, 35, 40, 45, 50]
const DEFAULT_OUT = "public/vtac-scaling-reports.json"
const PARSER_VERSION = "vtac-scaling-pdf-v3"
const STANDARD_FONT_DATA_URL = `${resolve("node_modules/pdfjs-dist/standard_fonts")}${sep}`
const NUMBER_PATTERN = "-?\\d+(?:\\.\\d+)?"
const SCORE_COLUMNS_PATTERN = Array.from({ length: 9 }, () => `(${NUMBER_PATTERN})`).join("\\s+")
const PAGE_FOOTER_PATTERN = "(?:\\s+(?:\\d{1,2}\\s+)?[A-Za-z]+\\s+\\d{4}\\s+\\d+\\s+of\\s+\\d+)?"
const CODED_ROW_PATTERN = new RegExp(`^\\s*([A-Z]{1,4}\\d{0,2})\\s+(.+?)\\s+${SCORE_COLUMNS_PATTERN}${PAGE_FOOTER_PATTERN}\\s*$`)
const LEGACY_ROW_PATTERN = new RegExp(`^\\s*(.+?[A-Za-z].*?)\\s+${SCORE_COLUMNS_PATTERN}${PAGE_FOOTER_PATTERN}\\s*$`)

async function main() {
  const output = resolve(process.argv[2] ?? DEFAULT_OUT)
  const references = []
  for (const report of REPORTS) {
    const response = await fetch(report.url, {
      headers: { "user-agent": "Mozilla/5.0 ExamTrack scaling importer" },
    })
    if (!response.ok) throw new Error(`Failed to fetch ${report.url}: ${response.status}`)
    const text = await extractPdfText(await response.arrayBuffer())
    assertReportYear(report, text)
    const parsed = parseScalingReportText({ ...report, text })
    if (parsed.length < 50) throw new Error(`Only parsed ${parsed.length} studies for ${report.year}`)
    references.push(...parsed)
    process.stderr.write(`Parsed ${parsed.length} scaling rows for ${report.year}.\n`)
  }

  writeFileSync(output, `${JSON.stringify({
    parserVersion: PARSER_VERSION,
    generatedAt: new Date().toISOString(),
    reports: REPORTS,
    references,
  }, null, 2)}\n`)
  process.stderr.write(`Wrote ${output}\n`)
}

async function extractPdfText(buffer) {
  const document = await getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(extractPageText(content.items))
  }
  return pages.join("\n")
}

function extractPageText(items) {
  const positionedRows = new Map()
  const streamLines = []
  let streamLine = []
  let previousY = null

  function flushStreamLine() {
    const line = streamLine.join(" ").trim()
    if (line) streamLines.push(line)
    streamLine = []
  }

  for (const item of items) {
    if (!("str" in item) || !item.str.trim()) continue
    const x = item.transform[4]
    const y = item.transform[5]
    const rowY = Math.round(y / 2) * 2
    const row = positionedRows.get(rowY) ?? []
    row.push({ x, text: item.str })
    positionedRows.set(rowY, row)

    if (previousY !== null && Math.abs(y - previousY) > 2) flushStreamLine()
    streamLine.push(item.str)
    if (item.hasEOL) flushStreamLine()
    previousY = y
  }
  flushStreamLine()

  const positionedText = [...positionedRows.entries()]
    .sort(([first], [second]) => second - first)
    .map(([, row]) => row.toSorted((a, b) => a.x - b.x).map((item) => item.text).join(" "))
    .join("\n")
  const streamText = streamLines.join("\n")

  if (!streamText || streamText === positionedText) return positionedText
  return `${positionedText}\n${streamText}`
}

function assertReportYear(report, text) {
  const match = text.match(/\b((?:19|20)\d{2})\s+Scaling Report\b/i)
  if (match && Number(match[1]) !== report.year) {
    throw new Error(`Expected a ${report.year} scaling report at ${report.url}, found ${match[1]}`)
  }
}

function normaliseExtractedLine(line) {
  return line.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
}

function legacyStudyCode(studyName) {
  const slug = studyName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return `LEGACY_${slug}`
}

function parseScalingReportText({ year, url, text }) {
  const references = new Map()
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = normaliseExtractedLine(sourceLine)
    if (!line) continue
    const codedMatch = line.match(CODED_ROW_PATTERN)
    const legacyMatch = codedMatch ? null : line.match(LEGACY_ROW_PATTERN)
    const match = codedMatch ?? legacyMatch
    if (!match) continue

    const code = codedMatch ? match[1] : legacyStudyCode(match[1])
    const studyName = codedMatch ? match[2] : match[1]
    const numericOffset = codedMatch ? 3 : 2
    const [mean, standardDeviation, ...scaledScores] = match.slice(numericOffset, numericOffset + 9).map(Number)
    if (![mean, standardDeviation, ...scaledScores].every(Number.isFinite)) continue

    const id = `${code}:${year}`
    references.set(id, {
      id,
      code,
      studyName,
      year,
      mean,
      standardDeviation,
      sourceUrl: url,
      points: RAW_SCORES.map((rawScore, index) => ({
        rawScore,
        scaledScore: scaledScores[index],
      })),
    })
  }
  return [...references.values()]
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

export { ARCHIVE_REPORTS, CURRENT_REPORTS, REPORTS, extractPageText, parseScalingReportText }
