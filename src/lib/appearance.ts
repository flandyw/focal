import { useSyncExternalStore } from "react"
import { ACCENT_THEMES, loadAccentTheme } from "./accent-theme"
import { NAVIGATION_GROUPS } from "./navigation"

export const SURFACE_THEMES = [
  { id: "focal", label: "Focal", description: "The original warm green", background: "#f6f4ee", sidebar: "#eeeee5", darkBackground: "#191e1b", darkSidebar: "#161c18" },
  { id: "paper", label: "Paper", description: "Clean, neutral whites", background: "#ffffff", sidebar: "#f4f4f4", darkBackground: "#191919", darkSidebar: "#151515" },
  { id: "sand", label: "Sand", description: "A softer, warmer workspace", background: "#f5efe5", sidebar: "#eae1d2", darkBackground: "#211e19", darkSidebar: "#1b1814" },
  { id: "forest", label: "Forest", description: "Quiet green surfaces", background: "#edf3ee", sidebar: "#dfe9e0", darkBackground: "#18221c", darkSidebar: "#131d17" },
  { id: "slate", label: "Slate", description: "Cool blue-grey surfaces", background: "#f0f3f7", sidebar: "#e0e6ee", darkBackground: "#191f29", darkSidebar: "#141a23" },
  { id: "rose", label: "Rose", description: "A little warmth and colour", background: "#faf0f1", sidebar: "#f0e0e3", darkBackground: "#261c21", darkSidebar: "#20171c" },
] as const

export const FONT_FAMILIES = [
  { id: "instrument", label: "Instrument Sans", value: '"Instrument Sans Variable", sans-serif' },
  { id: "system", label: "System sans", value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: "humanist", label: "Humanist", value: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { id: "newsreader", label: "Newsreader", value: '"Newsreader", Georgia, serif' },
  { id: "serif", label: "Classic serif", value: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' },
  { id: "mono", label: "Monospace", value: 'ui-monospace, "SFMono-Regular", Consolas, monospace' },
] as const

type FontFamily = (typeof FONT_FAMILIES)[number]["id"]
type Pane = "calendarPane" | "mistakePane" | "editorPane"
export type Appearance = {
  surface: (typeof SURFACE_THEMES)[number]["id"]
  customAccent: string | null
  sidebarTint: string | null
  bodyFont: FontFamily
  headingFont: FontFamily
  fontSize: number
  readingSpacing: number
  density: "compact" | "default" | "comfortable"
  contentWidth: "full" | "wide" | "reading"
  radius: number
  sidebarWidth: number
  sidebarSide: "left" | "right"
  sidebarLabels: boolean
  hiddenLinks: string[]
  linkOrder: string[]
  reduceMotion: boolean
  calendarPane: number
  mistakePane: number
  editorPane: number
}

export const DEFAULT_APPEARANCE: Appearance = {
  surface: "focal", customAccent: null, sidebarTint: null,
  bodyFont: "instrument", headingFont: "newsreader", fontSize: 16, readingSpacing: 1.6,
  density: "default", contentWidth: "full", radius: 5,
  sidebarWidth: 248, sidebarSide: "left", sidebarLabels: true,
  hiddenLinks: [], linkOrder: [], reduceMotion: false,
  calendarPane: 65, mistakePane: 40, editorPane: 40,
}

const STORAGE_KEY = "focal:appearance:v1"
const navigationIds = NAVIGATION_GROUPS.flatMap((group) => group.items.map((item) => item.id))
const listeners = new Set<() => void>()
const bounds = { fontSize: [14, 20], readingSpacing: [1.4, 2], radius: [0, 16], sidebarWidth: [200, 400], calendarPane: [35, 75], mistakePane: [25, 70], editorPane: [25, 85] } as const
const choices = {
  surface: SURFACE_THEMES.map((item) => item.id),
  bodyFont: FONT_FAMILIES.map((item) => item.id),
  headingFont: FONT_FAMILIES.map((item) => item.id),
  density: ["compact", "default", "comfortable"], contentWidth: ["full", "wide", "reading"], sidebarSide: ["left", "right"],
}

function readAppearance(): Appearance {
  const result = { ...DEFAULT_APPEARANCE }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return result
    const values = saved as Record<string, unknown>
    for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
      if (typeof values[key] === "string" && (choices[key] as readonly string[]).includes(values[key])) Object.assign(result, { [key]: values[key] })
    }
    for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
      const value = values[key]
      if (typeof value === "number" && Number.isFinite(value)) result[key] = Math.min(bounds[key][1], Math.max(bounds[key][0], value))
    }
    for (const key of ["customAccent", "sidebarTint"] as const) {
      if (typeof values[key] === "string" && /^#[0-9a-f]{6}$/i.test(values[key])) result[key] = values[key]
    }
    for (const key of ["sidebarLabels", "reduceMotion"] as const) if (typeof values[key] === "boolean") result[key] = values[key]
    for (const key of ["hiddenLinks", "linkOrder"] as const) {
      if (Array.isArray(values[key])) result[key] = [...new Set(values[key].filter((id): id is string => typeof id === "string" && navigationIds.some((item) => item === id)))]
    }
  } catch { /* Use defaults when storage is unavailable or malformed. */ }
  return result
}

let appearance = readAppearance()
let accent = loadAccentTheme()

// Custom accents keep readable buttons and text in both modes, including very pale colours.
function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map((part) => parseInt(part, 16) / 255).map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
function readableAccent(hex: string, dark: boolean) {
  let channels = hex.slice(1).match(/../g)!.map((part) => parseInt(part, 16))
  let colour = hex
  for (let i = 0; i < 30; i++) {
    const light = luminance(colour)
    if (dark ? (light + 0.05) / (luminance("#354332") + 0.05) >= 4.5 : (luminance("#e9e1d2") + 0.05) / (light + 0.05) >= 4.5) break
    channels = channels.map((n) => Math.round(n * 0.85 + (dark ? 255 : 0) * 0.15))
    colour = `#${channels.map((n) => n.toString(16).padStart(2, "0")).join("")}`
  }
  return colour
}

export function applyAppearance() {
  const root = document.documentElement
  const a = appearance
  root.dataset.surface = a.surface
  root.dataset.accent = accent
  root.dataset.density = a.density
  root.dataset.contentWidth = a.contentWidth
  root.dataset.sidebarSide = a.sidebarSide
  root.dataset.reduceMotion = String(a.reduceMotion)
  root.style.fontSize = `${a.fontSize / 16 * 100}%`
  root.style.setProperty("--app-font-body", FONT_FAMILIES.find((font) => font.id === a.bodyFont)!.value)
  root.style.setProperty("--app-font-heading", FONT_FAMILIES.find((font) => font.id === a.headingFont)!.value)
  root.style.setProperty("--reading-spacing", String(a.readingSpacing))
  root.style.setProperty("--radius", `${a.radius / 16}rem`)
  root.style.setProperty("--app-sidebar-width", `${a.sidebarWidth}px`)
  root.style.setProperty("--spacing", `${a.density === "compact" ? 0.21875 : a.density === "comfortable" ? 0.28125 : 0.25}rem`)
  const colour = a.customAccent ?? ACCENT_THEMES.find((theme) => theme.id === accent)!.swatch
  const light = readableAccent(colour, false)
  const dark = readableAccent(colour, true)
  root.style.setProperty("--primary", `light-dark(${light}, ${dark})`)
  root.style.setProperty("--primary-foreground", "light-dark(#ffffff, #141815)")
  root.style.setProperty("--ring", "var(--primary)")
  root.style.setProperty("--accent", `color-mix(in srgb, var(--primary) 12%, var(--background))`)
  root.style.setProperty("--accent-foreground", "var(--primary)")
  root.style.setProperty("--secondary", "var(--accent)")
  root.style.setProperty("--secondary-foreground", "var(--primary)")
  root.style.setProperty("--sidebar-accent", "color-mix(in srgb, var(--primary) 14%, var(--sidebar))")
  root.style.setProperty("--sidebar-accent-foreground", "var(--primary)")
  if (a.sidebarTint) {
    root.style.setProperty("--sidebar", `light-dark(color-mix(in srgb, ${a.sidebarTint} 12%, #ffffff), color-mix(in srgb, ${a.sidebarTint} 14%, #16191c))`)
    root.style.setProperty("--sidebar-foreground", "var(--foreground)")
  } else {
    root.style.removeProperty("--sidebar")
    root.style.removeProperty("--sidebar-foreground")
  }
}

export function updateAppearance(changes: Partial<Appearance>) {
  appearance = { ...appearance, ...changes }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance)) } catch { /* Changes still apply for this session. */ }
  applyAppearance()
  listeners.forEach((listener) => listener())
}

export function selectAccent(next: typeof accent) {
  accent = next
  try { localStorage.setItem("focal:accent:v1", next) } catch { /* Changes still apply for this session. */ }
  updateAppearance({ customAccent: null })
}

export function useAppearance() {
  return useSyncExternalStore(subscribe, () => appearance)
}
export function useAccent() {
  return useSyncExternalStore(subscribe, () => accent)
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function savePaneSize(pane: Pane, percent: number) {
  if (Number.isFinite(percent)) updateAppearance({ [pane]: Math.min(bounds[pane][1], Math.max(bounds[pane][0], percent)) })
}

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY && event.key !== "focal:accent:v1" && event.key !== null) return
  appearance = readAppearance()
  accent = loadAccentTheme()
  applyAppearance()
  listeners.forEach((listener) => listener())
})
