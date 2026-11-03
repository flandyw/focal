import { cn } from "../lib/utils"

// The Study Grid mark, drawn from currentColor and --card so it follows the accent, sidebar tint, and theme.
// The app-icon files in public/ keep the fixed brand colours.
export function FocalMark({ className }: { className?: string }) {
  return (
    <svg viewBox="54 54 916 916" aria-hidden className={cn("shrink-0", className)}>
      <rect x="54" y="54" width="916" height="916" rx="235" fill="color-mix(in srgb, currentColor 14%, transparent)" />
      <rect x="250" y="244" width="246" height="246" rx="68" fill="currentColor" />
      <rect x="528" y="244" width="246" height="246" rx="68" fill="var(--card)" />
      <rect x="250" y="522" width="246" height="246" rx="68" fill="color-mix(in srgb, currentColor 42%, transparent)" />
      <rect x="528" y="522" width="246" height="246" rx="68" fill="var(--card)" />
      <path d="M586 651 L633 697 L717 609" fill="none" stroke="currentColor" strokeWidth="29" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
