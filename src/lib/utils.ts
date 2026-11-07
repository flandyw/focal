import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** "1 mark", "2 marks": counts appear everywhere on small screens, where a wrong plural is impossible to miss. */
export const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Count overlapping study once, without changing the caller's ranges or rounding away short blocks. */
export function mergedStudyMilliseconds(ranges: readonly { start: number; end: number }[]): number {
  const sorted = ranges.filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start)
  let total = 0, coveredUntil = -Infinity
  for (const { start, end } of sorted) {
    total += Math.max(0, end - Math.max(start, coveredUntil))
    coveredUntil = Math.max(coveredUntil, end)
  }
  return total
}
