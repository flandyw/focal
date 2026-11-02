import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** "1 mark", "2 marks": counts appear everywhere on small screens, where a wrong plural is impossible to miss. */
export const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
