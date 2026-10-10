export const ACCENT_THEMES = [
  { id: "sage", label: "Sage", swatch: "#315647" },
  { id: "blue", label: "Blue", swatch: "#2f5d8c" },
  { id: "clay", label: "Clay", swatch: "#9a4f32" },
] as const

export type AccentTheme = (typeof ACCENT_THEMES)[number]["id"]

const ACCENT_STORAGE_KEY = "focal:accent:v1"

export function loadAccentTheme(): AccentTheme {
  const stored = localStorage.getItem(ACCENT_STORAGE_KEY)
  return ACCENT_THEMES.find((theme) => theme.id === stored)?.id ?? "sage"
}

export function setAccentTheme(accent: AccentTheme) {
  localStorage.setItem(ACCENT_STORAGE_KEY, accent)
  document.documentElement.dataset.accent = accent
}
