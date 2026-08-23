export function getSearchNavigationIndex(
  key: string,
  currentIndex: number,
  totalItems: number,
  pageSize = 5,
): number | null {
  if (totalItems <= 0) return null
  if (key === "ArrowDown") return currentIndex < 0 ? 0 : (currentIndex + 1) % totalItems
  if (key === "ArrowUp") return currentIndex < 0 ? totalItems - 1 : (currentIndex - 1 + totalItems) % totalItems
  if (key === "Home") return 0
  if (key === "End") return totalItems - 1
  if (key === "PageDown") return Math.min(totalItems - 1, Math.max(0, currentIndex) + pageSize)
  if (key === "PageUp") return Math.max(0, currentIndex - pageSize)
  return null
}

export const MAX_RECENT_SEARCHES = 5

export function normaliseRecentSearches(
  value: unknown,
  limit = MAX_RECENT_SEARCHES,
): string[] {
  if (!Array.isArray(value) || limit <= 0) return []
  const seen = new Set<string>()
  const searches: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const query = item.trim().slice(0, 120)
    const key = query.toLocaleLowerCase()
    if (!query || seen.has(key)) continue
    seen.add(key)
    searches.push(query)
    if (searches.length === limit) break
  }
  return searches
}

export function addRecentSearch(history: string[], query: string): string[] {
  return normaliseRecentSearches([query, ...history])
}
