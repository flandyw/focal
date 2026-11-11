export const ACCENT_THEMES = [
  { id: "sage", label: "Sage", swatch: "#0b4c37" },
  { id: "blue", label: "Blue", swatch: "#2a5fc4" },
  { id: "clay", label: "Clay", swatch: "#9a4f32" },
  { id: "violet", label: "Violet", swatch: "#7753a6" },
  { id: "rose", label: "Rose", swatch: "#a33f63" },
  { id: "graphite", label: "Graphite", swatch: "#51545b" },
] as const

export type AccentTheme = (typeof ACCENT_THEMES)[number]["id"]

export const DEFAULT_ACCENT: AccentTheme = "blue"

const ACCENT_STORAGE_KEY = "focal:accent:v1"

export function loadAccentTheme(): AccentTheme {
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY)
    return ACCENT_THEMES.find((theme) => theme.id === stored)?.id ?? DEFAULT_ACCENT
  } catch { return DEFAULT_ACCENT }
}
