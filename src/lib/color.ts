import { normalizeHexColor } from "@/lib/materialTheme"

export interface HsvColor {
  h: number
  s: number
  v: number
}

export function hexToHsv(hex: string): HsvColor {
  const value = normalizeHexColor(hex) ?? "#000000"
  const [red, green, blue] = [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  return {
    h: hue < 0 ? hue + 360 : hue,
    s: max ? (delta / max) * 100 : 0,
    v: max * 100,
  }
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const saturation = s / 100
  const brightness = v / 100
  const chroma = brightness * saturation
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const match = brightness - chroma
  const [red, green, blue] = h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
      : h < 180 ? [0, chroma, x]
        : h < 240 ? [0, x, chroma]
          : h < 300 ? [x, 0, chroma]
            : [chroma, 0, x]
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`
}
