import { ACCENT_THEMES } from "../lib/accent-theme"
import { selectAccent, useAccent, useAppearance } from "../lib/appearance"
import { Button } from "./ui/button"

export function AccentPicker() {
  const accent = useAccent()
  const { customAccent } = useAppearance()

  return (
    <div role="group" aria-label="Accent" className="flex flex-wrap gap-2">
      {ACCENT_THEMES.map((theme) => (
        <Button
          key={theme.id}
          variant={!customAccent && accent === theme.id ? "secondary" : "outline"}
          aria-pressed={!customAccent && accent === theme.id}
          onClick={() => selectAccent(theme.id)}
        >
          <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: theme.swatch }} />
          {theme.label}
        </Button>
      ))}
    </div>
  )
}
