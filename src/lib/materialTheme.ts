import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
} from "@material/material-color-utilities"

export const DEFAULT_SEED_COLOR = "#3f5f90"

export type ThemeVariables = Record<`--${string}`, string>

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
}

export function normalizeHexColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "")
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${[...hex].map((character) => character.repeat(2)).join("")}`.toLowerCase()
  }
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null
}

export function createMaterialTheme(seedColor: string, dark: boolean): ThemeVariables {
  const theme = themeFromSourceColor(argbFromHex(seedColor), [
    { name: "success", value: argbFromHex("#146c2e"), blend: true },
    { name: "warning", value: argbFromHex("#8a4f00"), blend: true },
  ])
  const scheme = dark ? theme.schemes.dark : theme.schemes.light
  const [success, warning] = theme.customColors.map((color) => dark ? color.dark : color.light)
  const tone = (palette: typeof theme.palettes.primary, light: number, darkTone: number) =>
    hexFromArgb(palette.tone(dark ? darkTone : light))

  return {
    "--background": hexFromArgb(scheme.background),
    "--foreground": hexFromArgb(scheme.onBackground),
    "--card": hexFromArgb(scheme.surface),
    "--card-foreground": hexFromArgb(scheme.onSurface),
    "--popover": hexFromArgb(scheme.surface),
    "--popover-foreground": hexFromArgb(scheme.onSurface),
    "--primary": hexFromArgb(scheme.primary),
    "--primary-foreground": hexFromArgb(scheme.onPrimary),
    "--secondary": hexFromArgb(scheme.secondaryContainer),
    "--secondary-foreground": hexFromArgb(scheme.onSecondaryContainer),
    "--muted": hexFromArgb(scheme.surfaceVariant),
    "--muted-foreground": hexFromArgb(scheme.onSurfaceVariant),
    "--accent": hexFromArgb(scheme.tertiaryContainer),
    "--accent-foreground": hexFromArgb(scheme.onTertiaryContainer),
    "--destructive": hexFromArgb(scheme.error),
    "--destructive-foreground": hexFromArgb(scheme.onError),
    "--border": hexFromArgb(scheme.outlineVariant),
    "--input": hexFromArgb(scheme.outline),
    "--ring": hexFromArgb(scheme.primary),
    "--chart-1": tone(theme.palettes.primary, 40, 80),
    "--chart-2": tone(theme.palettes.secondary, 40, 80),
    "--chart-3": tone(theme.palettes.tertiary, 40, 80),
    "--chart-4": tone(theme.palettes.primary, 65, 60),
    "--chart-5": tone(theme.palettes.tertiary, 65, 60),
    "--success": hexFromArgb(success.color),
    "--success-foreground": hexFromArgb(success.onColor),
    "--warning": hexFromArgb(warning.color),
    "--warning-foreground": hexFromArgb(warning.onColor),
    "--info": hexFromArgb(scheme.primary),
    "--info-foreground": hexFromArgb(scheme.onPrimary),
    "--sidebar": tone(theme.palettes.neutral, 96, 10),
    "--sidebar-foreground": hexFromArgb(scheme.onSurface),
    "--sidebar-primary": hexFromArgb(scheme.primary),
    "--sidebar-primary-foreground": hexFromArgb(scheme.onPrimary),
    "--sidebar-accent": hexFromArgb(scheme.secondaryContainer),
    "--sidebar-accent-foreground": hexFromArgb(scheme.onSecondaryContainer),
    "--sidebar-border": hexFromArgb(scheme.outlineVariant),
    "--sidebar-ring": hexFromArgb(scheme.primary),
  }
}

export function applyMaterialTheme(seedColor: string, dark: boolean): void {
  const root = document.documentElement
  for (const [property, value] of Object.entries(createMaterialTheme(seedColor, dark))) {
    root.style.setProperty(property, value)
  }
}
