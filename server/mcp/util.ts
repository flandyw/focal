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

/** A local date and clock time as the UTC timestamp the app's event dialog stores; local means the server's TZ (Australia/Melbourne). */
export function localInstant(date: string, time: string) {
  const parsed = new Date(`${date}T${time}:00`)
  if (Number.isNaN(parsed.getTime())) throw new Error(`"${date} ${time}" is not a valid date and time.`)
  return parsed.toISOString()
}
