import { z } from "zod"

export const day = z.iso.date().describe("Date, YYYY-MM-DD")
export const instant = z.iso.datetime({ offset: true }).describe("Date and time with a UTC offset, e.g. 2026-10-20T16:00:00+11:00")
export const limit = z.number().int().min(1).max(200).default(50)

export const nowIso = () => new Date().toISOString()
export const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places

export function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`No ${what} with that id.`)
  return value
}

/** One JSON line on stderr (journald under systemd) for writes that touch many records; `previous` on each card undoes them. */
export const logWrite = (tool: string, detail: unknown) => console.error(JSON.stringify({ at: nowIso(), tool, ...(detail as object) }))

export const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm, e.g. 09:00").describe("Local time, HH:mm")

/** Without an explicit zone, MCP uses its configured server TZ. Hosted chat supplies the user's zone. */
export function localInstant(date: string, time: string, timeZone?: string) {
  if (timeZone) {
    const wall = Date.parse(`${date}T${time}:00Z`)
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    })
    const wallAt = (at: number) => {
      const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]))
      return Date.parse(`${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
    }
    // Check both sides of a clock change; skipped or repeated local times need an explicit offset.
    const offsets = new Set([-86_400_000, 0, 86_400_000].map((delta) => wallAt(wall + delta) - (wall + delta)))
    const candidates = [...offsets].map((offset) => wall - offset).filter((at) => wallAt(at) === wall)
    if (candidates.length !== 1) throw new Error(`"${date} ${time}" does not exist or is ambiguous in ${timeZone}. Give a timestamp with a UTC offset.`)
    return new Date(candidates[0]).toISOString()
  }
  const parsed = new Date(`${date}T${time}:00`)
  if (Number.isNaN(parsed.getTime())) throw new Error(`"${date} ${time}" is not a valid date and time.`)
  return parsed.toISOString()
}
