const COMPILER_URL = "https://texlive.net/cgi-bin/latexcgi"

export async function handleMistakesPdf(request: Request) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })

  let tex: unknown
  try {
    tex = (await request.json() as { tex?: unknown }).tex
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }
  if (typeof tex !== "string" || !tex.startsWith("% ExamTrack mistake worksheet\n") || tex.length > 100_000) {
    return new Response("Invalid worksheet", { status: 400 })
  }

  const form = new FormData()
  form.append("engine", "pdflatex")
  form.append("return", "pdf")
  form.append("filename[]", "document.tex")
  form.append("filecontents[]", tex)

  try {
    const compiled = await fetch(COMPILER_URL, { method: "POST", body: form, signal: AbortSignal.timeout(55_000) })
    if (!compiled.ok || !compiled.headers.get("content-type")?.includes("application/pdf")) {
      return new Response((await compiled.text()).slice(-4_000), { status: 422 })
    }
    return new Response(compiled.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="mistakes-worksheet.pdf"',
        "cache-control": "no-store",
      },
    })
  } catch {
    return new Response("TeX compiler unavailable", { status: 502 })
  }
}
