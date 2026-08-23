import type { QuickLink } from "@/lib/types"

export const QUICK_LINKS_STORAGE_KEY = "focal-quick-links"

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

export function normaliseQuickLinkUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname
      ? url.toString()
      : null
  } catch {
    return null
  }
}

export function parseQuickLinks(value: unknown): QuickLink[] {
  if (!Array.isArray(value)) return []
  return value.filter((link): link is QuickLink => {
    if (!link || typeof link !== "object" || Array.isArray(link)) return false
    const record = link as Record<string, unknown>
    return ["id", "label", "icon", "color"].every((field) => typeof record[field] === "string")
      && isHttpUrl(record.url)
  })
}

export function getStoredQuickLinks(): QuickLink[] {
  try {
    return parseQuickLinks(JSON.parse(localStorage.getItem(QUICK_LINKS_STORAGE_KEY) ?? "[]"))
  } catch {
    return []
  }
}
