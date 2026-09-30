export interface PastStudyLog {
  subjectId: string
  title: string
  notes?: string
  blocks: { start: string; end: string }[]
}

export function pastStudyBlocks(rows: { start: string; minutes: string }[], now = Date.now()) {
  if (!rows.length || rows.length > 100) throw new Error("Enter between 1 and 100 study blocks.")
  const blocks = rows.map(({ start, minutes }) => {
    const date = new Date(start)
    const duration = Number(minutes)
    if (!start || !Number.isFinite(date.getTime()) || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
      throw new Error("Each block needs a valid start and 1–1440 minutes of study.")
    }
    const end = date.getTime() + duration * 60000
    if (end > now) throw new Error("Study must have finished already. Check the start and duration.")
    return { start: date.toISOString(), end: new Date(end).toISOString() }
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  if (blocks.some((block, index) => index > 0 && Date.parse(block.start) < Date.parse(blocks[index - 1].end))) {
    throw new Error("Study blocks overlap. Breaks should be gaps between blocks.")
  }
  return blocks
}

export function localStudyTime(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}
