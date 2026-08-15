import { useCallback, type ReactNode } from "react";
import { Moon, Sun, Monitor, Minus, Plus } from "lucide-react";
import type { ThemeMode } from "@/lib/themes";
import { isMacOS } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { DEFAULT_SEED_COLOR } from "@/lib/materialTheme";

interface ModeOption {
  value: ThemeMode;
  icon: typeof Sun;
  label: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

interface AppearanceSectionProps {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  seedColor: string;
  setSeedColor: (color: string) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

function ModeButton({
  selected,
  onSelect,
  icon,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      variant={selected ? "default" : "outline"}
      className="flex-1"
    >
      {icon}
      {label}
    </Button>
  );
}

export function AppearanceSection({
  mode,
  setMode,
  seedColor,
  setSeedColor,
  zoom,
  onZoomChange,
}: AppearanceSectionProps) {
  const shortcutModifier = isMacOS ? "Cmd" : "Ctrl";

  const handleZoomOut = useCallback(() => {
    onZoomChange(Math.max(zoom - 0.1, 0.75));
  }, [zoom, onZoomChange]);

  const handleZoomIn = useCallback(() => {
    onZoomChange(Math.min(zoom + 0.1, 1.5));
  }, [zoom, onZoomChange]);

  const handleZoomReset = useCallback(() => {
    onZoomChange(1);
  }, [onZoomChange]);

  return (
    <div className="space-y-7">
      <section className="border-t border-border/70 pt-5">
        <div>
          <h2 className="text-sm font-medium">Mode</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            System follows your OS. Light and dark work everywhere.
          </p>
        </div>
        <div className="mt-4 flex gap-2">
          {MODE_OPTIONS.map(({ value, icon: Icon, label }) => (
            <ModeButton
              key={value}
              selected={mode === value}
              onSelect={() => setMode(value)}
              icon={<Icon className="h-4 w-4" />}
              label={label}
            />
          ))}
        </div>
      </section>

      <section className="border-t border-border/70 pt-5">
        <div className="grid grid-cols-[1fr_auto] items-start gap-4">
          <div>
            <h2 className="text-sm font-medium">Theme color</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Build a complete Material 3 theme from a seed color.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSeedColor(DEFAULT_SEED_COLOR)}
            disabled={seedColor === DEFAULT_SEED_COLOR}
          >
            Reset
          </Button>
        </div>
        <div className="mt-4 max-w-xs">
          <ColorPicker value={seedColor} onValueChange={setSeedColor} aria-label="Theme seed color" />
        </div>
      </section>

      <section className="border-t border-border/70 pt-5">
        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div>
            <h2 className="text-sm font-medium">Zoom</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Adjust the overall app scale. Keyboard: {shortcutModifier}+= to
              zoom in, {shortcutModifier}+- to zoom out, {shortcutModifier}+0
              to reset.
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button
            type="button"
            onClick={handleZoomOut}
            disabled={zoom <= 0.75}
            aria-label="Zoom out"
            variant="outline"
            size="icon"
          >
            <Minus />
          </Button>
          <input
            type="range"
            min="0.75"
            max="1.5"
            step="0.05"
            value={zoom}
            onChange={(event) => onZoomChange(parseFloat(event.target.value))}
            aria-label="Zoom level"
            className="w-full accent-primary"
          />
          <Button
            type="button"
            onClick={handleZoomIn}
            disabled={zoom >= 1.5}
            aria-label="Zoom in"
            variant="outline"
            size="icon"
          >
            <Plus />
          </Button>
          <Button
            type="button"
            onClick={handleZoomReset}
            disabled={zoom === 1}
            variant="outline"
          >
            Reset
          </Button>
        </div>
      </section>
    </div>
  );
}
