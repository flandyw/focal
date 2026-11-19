import { buildMistakeImportPrompt } from "./mistake-json"
import { getCachedVcaaExams, getVcaaExamPaper, getVcaaExamCompanions, type VcaaStudyResources } from "./vcaa-resources"
import { normaliseComparisonName } from "./exam-data"

export function buildPracticePaperPrompt(subject: string, kind: "exam" | "sac", paper: string, minutes: number, weakAreas: string[], studies: VcaaStudyResources[], template: string, areaOfStudy = "") {
  const matching = studies.filter((study) => normaliseComparisonName(study.studyName) === normaliseComparisonName(subject))
  const exams = getCachedVcaaExams(matching).filter((exam) => kind === "sac" || getVcaaExamPaper(exam) === paper || paper === "Exam")
    .toSorted((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 4)
  const references = [...new Map([...exams, ...exams.flatMap((exam) => {
    const companions = getVcaaExamCompanions(exam, matching.find((study) => study.pageUrl === exam.pageUrl))
    return [...companions.reports, ...(companions.specification ? [companions.specification] : [])]
  }), ...matching.flatMap((study) => study.resources.filter((resource) => resource.kind === "specification"))].map((resource) => [resource.url, resource])).values()]
  const importPrompt = buildMistakeImportPrompt()
  const fieldRules = importPrompt.slice(importPrompt.indexOf("Each object must use"), importPrompt.indexOf("EXAM LOG (optional)"))
  return `You are my VCE ${subject} practice-paper setter and marker.
Assessment: ${kind.toUpperCase()} — ${paper}
Writing time: ${minutes} minutes
Area of study: ${areaOfStudy || "Full examinable course"}
Weak areas: ${[...new Set(weakAreas)].join("; ") || "None recorded; balance coverage across the course."}

Step 1 — generate the paper:
- Read the linked past exams, specifications and examiner/external assessment reports below. Model the format, mark allocation and command terms on them, but write original questions. If links cannot be accessed, ask me to upload the documents; do not claim to have read them.
- Write a full practice paper in XeLaTeX. Reuse the supplied template's preamble, macros, cover, page layout and ruled answer lines. Adapt subject details, instructions and formula sheets; substitute installed fonts if needed. Label it Focal practice, not an official VCAA paper.
- Compile with xelatex twice and give me the downloadable PDF. Do not print answers or the marking scheme.
- Weight questions toward the weak areas while preserving the paper's overall coverage. For a SAC, use a school-assessed task style for the chosen area of study, with the same typesetting.
- Privately build a per-question marking scheme using the linked examiner reports' criteria: what earns each mark, acceptable working and common errors examiners penalise. Keep it for Step 2.

Step 2 — after I upload my completed paper:
- Mark strictly against that private rubric, considering working as well as answers. Ask for clearer uploads if needed; never invent unreadable responses.
- Reply with ONLY one fenced JSON block containing {"exam":{"subject":${JSON.stringify(subject)},"provider":"Focal practice","examYear":${new Date().getFullYear()},"paper":${JSON.stringify(paper)},"completedAt":"YYYY-MM-DD","rawScore":0,"rawMax":1,"comment":"Overall feedback","questions":[{"label":"Question 1","marksAwarded":0,"maxMarks":1,"areaOfStudy":"Topic","examinerNote":"Criterion-based feedback"}]},"mistakes":[]}.
- Replace example scores with actual marks. Include every question exactly once, with unique labels, positive maxMarks and marksAwarded between 0 and maxMarks. Question totals must sum to rawScore/rawMax. Use the actual completion date (ask if unknown).
- Populate mistakes for errors using the shared field rules below; use [] when there are no mistakes. These rules describe mistake records only; the response envelope must always be the exam/mistakes object above, not a bare array.

VCAA references:
${references.map((resource) => `${resource.label}: ${resource.url}`).join("\n") || "No matching resources found. Ask me to upload the official exams, specification and reports."}

Mistake record rules:
${fieldRules}
Template (sample.tex):
\`\`\`latex
${template.trim()}
\`\`\`
`
}
