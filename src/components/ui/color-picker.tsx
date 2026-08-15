import * as React from "react"
import { Check, Pipette } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { hexToHsv, hsvToHex, type HsvColor } from "@/lib/color"
import { normalizeHexColor } from "@/lib/materialTheme"

const PRESET_COLORS = [
  "#6750a4",
  "#3f5f90",
  "#006a6a",
  "#386a20",
  "#8c4a60",
  "#984061",
  "#825500",
  "#765b00",
]

interface ColorPickerProps {
  value: string
  onValueChange: (value: string) => void
  className?: string
  "aria-label"?: string
}

export function ColorPicker({
  value,
  onValueChange,
  className,
  "aria-label": ariaLabel = "Choose color",
}: ColorPickerProps) {
  const [draft, setDraft] = React.useState(value)
  const [hsv, setHsv] = React.useState(() => hexToHsv(value))

  React.useEffect(() => setDraft(value), [value])
  React.useEffect(() => {
    setHsv((current) => hsvToHex(current) === value.toLowerCase() ? current : hexToHsv(value))
  }, [value])

  const applyHsv = React.useCallback((next: HsvColor) => {
    setHsv(next)
    onValueChange(hsvToHex(next))
  }, [onValueChange])

  const updateSaturation = (element: HTMLDivElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect()
    applyHsv({
      h: hsv.h,
      s: Math.max(0, Math.min(100, ((clientX - bounds.left) / bounds.width) * 100)),
      v: Math.max(0, Math.min(100, 100 - ((clientY - bounds.top) / bounds.height) * 100)),
    })
  }

  const commitDraft = () => {
    const normalized = normalizeHexColor(draft)
    if (normalized) onValueChange(normalized)
    else setDraft(value)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("w-full justify-start gap-3", className)}
          aria-label={`${ariaLabel}: ${value}`}
        >
          <span
            className="h-4 w-4 rounded-sm border border-black/15 shadow-inner"
            style={{ backgroundColor: value }}
          />
          <span className="font-mono text-xs uppercase">{value}</span>
          <Pipette className="ml-auto text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Seed color</PopoverTitle>
        </PopoverHeader>

        <div
          role="slider"
          tabIndex={0}
          aria-label="Saturation and brightness"
          aria-valuetext={`${Math.round(hsv.s)}% saturation, ${Math.round(hsv.v)}% brightness`}
          className="relative h-36 cursor-crosshair touch-none overflow-hidden rounded-md outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            backgroundColor: hsvToHex({ h: hsv.h, s: 100, v: 100 }),
            backgroundImage: "linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, transparent)",
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            updateSaturation(event.currentTarget, event.clientX, event.clientY)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              updateSaturation(event.currentTarget, event.clientX, event.clientY)
            }
          }}
          onKeyDown={(event) => {
            const amount = event.shiftKey ? 10 : 1
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
            event.preventDefault()
            applyHsv({
              h: hsv.h,
              s: Math.max(0, Math.min(100, hsv.s + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0))),
              v: Math.max(0, Math.min(100, hsv.v + (event.key === "ArrowUp" ? amount : event.key === "ArrowDown" ? -amount : 0))),
            })
          }}
        >
          <span
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
            style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: value }}
          />
        </div>

        <input
          type="range"
          min="0"
          max="359"
          value={Math.round(hsv.h)}
          onChange={(event) => applyHsv({ ...hsv, h: Number(event.target.value) })}
          aria-label="Hue"
          className="h-3 w-full cursor-pointer appearance-none rounded-full bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] accent-foreground [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-sm"
        />

        <div className="flex gap-2">
          <span className="h-8 w-8 shrink-0 rounded-md border" style={{ backgroundColor: value }} />
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitDraft()
            }}
            aria-label="Hex color"
            spellCheck={false}
            className="font-mono uppercase"
          />
        </div>

        <div className="grid grid-cols-8 gap-1.5" aria-label="Suggested colors">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onValueChange(color)}
              aria-label={`Use ${color}`}
              aria-pressed={value === color}
              className="flex aspect-square items-center justify-center rounded-md border border-black/10 outline-none ring-offset-2 hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ backgroundColor: color }}
            >
              {value === color && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
