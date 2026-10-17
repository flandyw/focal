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
