import type { ExamAttempt, Mistake } from "./exam-data"

const TEX_SPECIALS = /[#$%&_{}~^\\]/g

function escapeTex(value: string) {
  return value.replace(TEX_SPECIALS, (character) => ({
    "#": "\\#",
    "$": "\\$",
    "%": "\\%",
    "&": "\\&",
    "_": "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
    "\\": "\\textbackslash{}",
  })[character]!)
}

function questionToTex(value: string) {
  return value
    .split(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^\n$]+\$|\\\([^\n]*?\\\))/g)
    .map((part) => /^(\$|\\\[|\\\()/.test(part) ? part : escapeTex(part).replace(/\r?\n{2,}/g, "\n\n\\par\n").replace(/\r?\n/g, " "))
    .join("")
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function worksheetDetails(mistakes: Mistake[], attemptMap: Map<string, ExamAttempt>) {
  const attempts = mistakes.map((mistake) => attemptMap.get(mistake.attemptId)).filter((attempt): attempt is ExamAttempt => Boolean(attempt))
  const subjects = unique(attempts.map((attempt) => attempt.subject))
  const papers = unique(attempts.map((attempt) => attempt.paper))
  const knownMarks = mistakes.every((mistake) => typeof mistake.totalMarks === "number")
  const totalMarks = knownMarks ? mistakes.reduce((total, mistake) => total + mistake.totalMarks!, 0) : null

  return {
    subject: subjects.length === 1 ? subjects[0] : "Mistake practice",
    paper: papers.length === 1 ? papers[0] : "Mixed examination tasks",
    totalMarks,
  }
}

export function buildMistakesTex(mistakes: Mistake[], attempts: ExamAttempt[]) {
  const attemptMap = new Map(attempts.map((attempt) => [attempt.id, attempt]))
  const details = worksheetDetails(mistakes, attemptMap)
  const generatedDate = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
  const questionCount = mistakes.length
  const questionWord = questionCount === 1 ? "task" : "tasks"
  const totalMarks = details.totalMarks === null ? "Not all marks supplied" : `${details.totalMarks} marks`
  const pages = mistakes.map((mistake, index) => {
    const attempt = attemptMap.get(mistake.attemptId)
    const source = attempt
      ? `${attempt.provider} ${attempt.examYear} ${attempt.paper}`
      : "Source examination unavailable"
    const marks = mistake.totalMarks === undefined
      ? "\\markbox{--}"
      : `\\markbox{${mistake.totalMarks}}`
    const pageStyle = index === mistakes.length - 1 ? "\\thispagestyle{lastquestion}\n" : ""

    return `${pageStyle}\\questionheader{Question ${index + 1}}{${marks}}
\\sourcequestion{${escapeTex(source)}}{${escapeTex(mistake.question)}}

\\vspace{1.2em}
${questionToTex(mistake.questionText?.trim() || mistake.question)}

\\vspace{1.4em}
\\workingarea
\\questionend{${index + 1}}`
  })

  return `% ExamTrack mistake worksheet
\\documentclass[11pt,a4paper]{article}
\\usepackage[left=22mm,right=22mm,top=20mm,bottom=19mm,headheight=18pt,headsep=9mm,footskip=12mm]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{mathptmx}
\\usepackage{amsmath,amssymb}
\\usepackage{xcolor}
\\usepackage{fancyhdr}
\\usepackage{array}
\\usepackage{enumitem}

\\definecolor{examgray}{gray}{0.32}
\\definecolor{rulegray}{gray}{0.72}
\\definecolor{panelgray}{gray}{0.94}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.45em}
\\setlength{\\fboxsep}{0pt}
\\setlength{\\fboxrule}{0.8pt}
\\raggedbottom

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\sffamily\\fontsize{8.5}{10}\\selectfont\\bfseries ${escapeTex(details.subject.toUpperCase())}}
\\fancyhead[R]{\\sffamily\\fontsize{8.5}{10}\\selectfont EXAMTRACK PRACTICE WORKSHEET}
\\renewcommand{\\headrulewidth}{0.7pt}
\\fancyfoot[L]{\\sffamily\\fontsize{8}{9}\\selectfont Unofficial practice material}
\\fancyfoot[C]{\\sffamily\\fontsize{8}{9}\\selectfont Page \\thepage}
\\fancyfoot[R]{\\sffamily\\fontsize{8}{9}\\selectfont CONTINUED OVER}
\\renewcommand{\\footrulewidth}{0pt}
\\fancypagestyle{lastquestion}{%
  \\fancyhf{}
  \\fancyhead[L]{\\sffamily\\fontsize{8.5}{10}\\selectfont\\bfseries ${escapeTex(details.subject.toUpperCase())}}
  \\fancyhead[R]{\\sffamily\\fontsize{8.5}{10}\\selectfont EXAMTRACK PRACTICE WORKSHEET}
  \\fancyfoot[L]{\\sffamily\\fontsize{8}{9}\\selectfont Unofficial practice material}
  \\fancyfoot[C]{\\sffamily\\fontsize{8}{9}\\selectfont Page \\thepage}
  \\fancyfoot[R]{\\sffamily\\fontsize{8}{9}\\selectfont END OF WORKSHEET}
  \\renewcommand{\\headrulewidth}{0.7pt}
  \\renewcommand{\\footrulewidth}{0pt}}

\\newcommand{\\coverrule}{\\par\\vspace{0.45em}\\hrule height 1.1pt\\vspace{0.45em}}
\\newcommand{\\fieldline}[1]{\\textbf{#1}\\hspace{0.7em}\\rule{0.73\\linewidth}{0.5pt}}
\\newcommand{\\markbox}[1]{%
  \\begin{minipage}[c][13mm][c]{22mm}\\centering
  \\sffamily\\fontsize{8}{9}\\selectfont Marks\\par\\vspace{1mm}
  \\fontsize{11}{12}\\selectfont\\textbf{\\rule{7mm}{0.4pt}\\,/\\,#1}
  \\end{minipage}}
\\newcommand{\\questionheader}[2]{%
  \\noindent\\begin{tabular*}{\\textwidth}{@{}p{0.78\\textwidth}@{\\extracolsep{\\fill}}r@{}}
  {\\sffamily\\fontsize{14}{16}\\selectfont\\bfseries #1} & \\fbox{#2}
  \\end{tabular*}\\par\\vspace{0.3em}\\hrule height 0.75pt}
\\newcommand{\\sourcequestion}[2]{%
  \\vspace{0.6em}{\\sffamily\\fontsize{8.5}{10}\\selectfont\\color{examgray}Source: #1 \\textbullet{} original #2}}
\\newcommand{\\workingarea}{%
  {\\sffamily\\fontsize{8}{9}\\selectfont\\bfseries RESPONSE SPACE}\\par\\vspace{0.35em}
  \\fcolorbox{rulegray}{white}{\\begin{minipage}[t][0.48\\textheight][t]{\\dimexpr\\linewidth-2\\fboxrule\\relax}
  \\vspace{0.8em}\\hspace{0pt}
  \\end{minipage}}}
\\newcommand{\\questionend}[1]{%
  \\vfill\\begin{center}{\\sffamily\\fontsize{8}{9}\\selectfont\\bfseries END OF QUESTION #1}\\end{center}}

\\begin{document}
\\thispagestyle{empty}
\\begin{center}
{\\sffamily\\fontsize{9}{11}\\selectfont\\bfseries EXAMTRACK}\\par
\\vspace{0.6em}
{\\sffamily\\fontsize{8.5}{10}\\selectfont\\fbox{\\hspace{1.2em}\\rule{0pt}{2.1em}UNOFFICIAL PRACTICE MATERIAL\\hspace{1.2em}}}\\par
\\vspace{2.2em}
{\\sffamily\\fontsize{14}{17}\\selectfont VICTORIAN CERTIFICATE OF EDUCATION STYLE}\\par
\\vspace{0.6em}
{\\sffamily\\fontsize{22}{25}\\selectfont\\bfseries ${escapeTex(details.subject.toUpperCase())}}\\par
\\vspace{0.4em}
{\\sffamily\\fontsize{15}{18}\\selectfont ${escapeTex(details.paper)}}\\par
\\vspace{1em}
{\\sffamily\\fontsize{18}{21}\\selectfont\\bfseries MISTAKE PRACTICE WORKSHEET}
\\end{center}

\\vspace{2.2em}
\\fieldline{Student name}\\par\\vspace{1.3em}
\\fieldline{School}\\par\\vspace{1.3em}
\\fieldline{Date completed}

\\vspace{2.1em}
\\coverrule
{\\sffamily\\fontsize{11}{13}\\selectfont\\bfseries WORKSHEET INFORMATION}
\\coverrule
\\vspace{0.5em}
\\renewcommand{\\arraystretch}{1.55}
\\begin{tabular}{@{}>{\\bfseries}p{43mm}p{105mm}@{}}
Tasks & ${questionCount} ${questionWord}\\\\
Total marks & ${escapeTex(totalMarks)}\\\\
Generated & ${escapeTex(generatedDate)}\\\\
Source & Selected tasks from your ExamTrack mistake log\\\\
\\end{tabular}

\\vspace{1.6em}
\\colorbox{panelgray}{\\begin{minipage}{\\dimexpr\\linewidth-2\\fboxsep\\relax}
\\vspace{0.8em}\\hspace{1em}\\begin{minipage}{\\dimexpr\\linewidth-2em\\relax}
{\\sffamily\\fontsize{10}{12}\\selectfont\\bfseries INSTRUCTIONS}
\\begin{itemize}[leftmargin=1.5em,itemsep=0.35em,topsep=0.6em]
\\item Complete all tasks in the spaces provided.
\\item Show sufficient reasoning, evidence or working to support each response.
\\item Use only the materials permitted for the source examination.
\\item Record your score in the marks box after checking your work.
\\end{itemize}
\\end{minipage}\\vspace{0.35em}
\\end{minipage}}

\\vfill
\\begin{center}
{\\sffamily\\fontsize{8.5}{10}\\selectfont\\color{examgray}This worksheet is generated by ExamTrack and is not produced or endorsed by the VCAA.}\\par
\\vspace{0.8em}
{\\sffamily\\fontsize{9}{11}\\selectfont\\bfseries Students are NOT permitted to bring mobile phones and/or any other unauthorised electronic devices into the examination room.}
\\end{center}

${pages.length ? `\\newpage
${pages.join("\n\\newpage\n")}` : ""}
\\end{document}
`
}

export async function downloadMistakesPdf(mistakes: Mistake[], attempts: ExamAttempt[], subject = "mistakes") {
  const response = await fetch("/api/mistakes-pdf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tex: buildMistakesTex(mistakes, attempts) }),
  })
  if (!response.ok) throw new Error((await response.text()).slice(0, 500) || "PDF compilation failed.")

  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement("a")
  link.href = url
  link.download = `${subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "mistakes"}-worksheet.pdf`
  link.click()
  URL.revokeObjectURL(url)
}
