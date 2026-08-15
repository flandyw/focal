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
