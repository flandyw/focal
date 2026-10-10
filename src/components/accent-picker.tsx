import { useState } from "react"
import { ACCENT_THEMES, loadAccentTheme, setAccentTheme, type AccentTheme } from "../lib/accent-theme"
import { Button } from "./ui/button"

export function AccentPicker() {
  const [accent, setAccent] = useState<AccentTheme>(loadAccentTheme)

  return (
    <div role="group" aria-label="Accent" className="flex flex-wrap gap-2">
      {ACCENT_THEMES.map((theme) => (
        <Button
          key={theme.id}
          variant={accent === theme.id ? "secondary" : "outline"}
          aria-pressed={accent === theme.id}
          onClick={() => {
            setAccentTheme(theme.id)
            setAccent(theme.id)
          }}
        >
          <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: theme.swatch }} />
          {theme.label}
        </Button>
      ))}
    </div>
  )
}
