import { useCallback } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { platform } from "@tauri-apps/plugin-os"
import {
  CalendarPlus,
  ChevronDown,
  CircleHelp,
  Clock3,
  ClipboardList,
  Minus,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const IS_MACOS = (() => {
  try {
    return platform() === "macos"
  } catch {
    return false
  }
})()
const SEARCH_SHORTCUT = IS_MACOS ? "⌘K" : "Ctrl K"
const SETTINGS_SHORTCUT = IS_MACOS ? "⌘," : "Ctrl ,"
const SEARCH_ARIA_SHORTCUT = IS_MACOS ? "Meta+K" : "Control+K"
const SETTINGS_ARIA_SHORTCUT = IS_MACOS ? "Meta+," : "Control+,"

const noop = () => { /* no-op */ }

interface TitleBarProps {
  onNewAssessment?: () => void
  onNewEvent?: () => void
  onNewSession?: () => void
  onSearch?: () => void
  onSettings?: () => void
  onHelp?: () => void
  children?: React.ReactNode
}

interface TrafficLightProps {
  onClick: () => void
  color: string
  ringColor: string
  label: string
  icon: typeof X
}

function TrafficLight({ onClick, color, ringColor, label, icon: Icon }: TrafficLightProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="group flex size-7 items-center justify-center rounded-md opacity-90 transition-[background-color,opacity] hover:bg-accent hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px"
    >
      <span className="flex h-3 w-3 items-center justify-center rounded-full" style={{ background: color, color: ringColor }}>
        <Icon className="hidden h-2.5 w-2.5 stroke-[2.5] group-hover:block group-focus-visible:block" aria-hidden="true" />
      </span>
    </button>
  )
}

// ponytail: macOS goes close→minimize→maximize (left-to-right); Windows/Linux
// conventionally go minimize→maximize→close. Flip the row when inverted.
const LIGHT_CONFIG = {
  close: { color: "#ff5f57", ringColor: "#4d0000", label: "Close window", icon: X },
  minimize: { color: "#febc2e", ringColor: "#995700", label: "Minimize window", icon: Minus },
  maximize: { color: "#28c840", ringColor: "#006500", label: "Toggle maximize", icon: Plus },
} as const

const LIGHT_ORDER_MACOS = ["close", "minimize", "maximize"] as const
const LIGHT_ORDER_OTHER = ["minimize", "maximize", "close"] as const

function TrafficLights({
  onClose,
  onMinimize,
  onMaximize,
  className,
  inverted = false,
}: {
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
  className?: string
  inverted?: boolean
}) {
  const order = inverted ? LIGHT_ORDER_OTHER : LIGHT_ORDER_MACOS
  const handlers = { close: onClose, minimize: onMinimize, maximize: onMaximize }
  return (
    <div className={className} role="group" aria-label="Window controls">
      {order.map((key) => {
        const { color, ringColor, label, icon: Icon } = LIGHT_CONFIG[key]
        return (
          <TrafficLight
            key={key}
            onClick={handlers[key]}
            color={color}
            ringColor={ringColor}
            label={label}
            icon={Icon}
          />
        )
      })}
    </div>
  )
}

function AppActions({
  onNewAssessment,
  onNewEvent,
  onNewSession,
  onSearch,
  onSettings,
  onHelp,
  children,
  className,
}: {
  onNewAssessment: () => void
  onNewEvent: () => void
  onNewSession: () => void
  onSearch: () => void
  onSettings: () => void
  onHelp: () => void
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 px-2.5"
            aria-label="Create new item"
            title="Create new item"
          >
            <Plus />
            <span className="max-[620px]:hidden">New</span>
            <ChevronDown className="size-3 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onNewAssessment}>
            <ClipboardList />
            Assessment
            <DropdownMenuShortcut>{IS_MACOS ? "⌘N" : "Ctrl N"}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewEvent}>
            <CalendarPlus />
            Event
            <DropdownMenuShortcut>{IS_MACOS ? "⌘⇧N" : "Ctrl Shift N"}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewSession}>
            <Clock3 />
            Study session
            <DropdownMenuShortcut>{IS_MACOS ? "⌘⇧S" : "Ctrl Shift S"}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onHelp}
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts="?"
          >
            <CircleHelp />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">Keyboard shortcuts · ?</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onSearch}
            aria-label="Search"
            aria-keyshortcuts={SEARCH_ARIA_SHORTCUT}
          >
            <Search />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">Search · {SEARCH_SHORTCUT}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onSettings}
            aria-label="Settings"
            aria-keyshortcuts={SETTINGS_ARIA_SHORTCUT}
          >
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">Settings · {SETTINGS_SHORTCUT}</TooltipContent>
      </Tooltip>
      {children}
    </div>
  )
}

export function TitleBar({
  onNewAssessment = noop,
  onNewEvent = noop,
  onNewSession = noop,
  onSearch = noop,
  onSettings = noop,
  onHelp = noop,
  children,
}: TitleBarProps) {
  const handleMinimize = useCallback(() => {
    void getCurrentWindow().minimize()
  }, [])

  const handleToggleMaximize = useCallback(() => {
    void getCurrentWindow().toggleMaximize()
  }, [])

  const handleClose = useCallback(() => {
    void getCurrentWindow().close()
  }, [])

  return (
    <div
      data-tauri-drag-region
      className="relative z-10 flex h-11 shrink-0 items-center border-b border-border/80 bg-card/90 shadow-xs backdrop-blur-md select-none"
    >
      {IS_MACOS ? (
        <div className="w-[84px] shrink-0" aria-hidden="true" />
      ) : (
        <AppActions
          onNewAssessment={onNewAssessment}
          onNewEvent={onNewEvent}
          onNewSession={onNewSession}
          onSearch={onSearch}
          onSettings={onSettings}
          onHelp={onHelp}
          className="flex items-center gap-1.5 px-3 min-[900px]:gap-2 min-[900px]:px-4"
        >
          {children}
        </AppActions>
      )}

      <div
        data-tauri-drag-region
        className="pointer-events-none absolute inset-0 hidden items-center justify-center px-4 min-[720px]:flex"
      >
        <span data-tauri-drag-region className="font-display text-sm font-semibold tracking-[-0.015em] text-foreground/85">Focal</span>
      </div>

      {IS_MACOS ? (
        <AppActions
          onNewAssessment={onNewAssessment}
          onNewEvent={onNewEvent}
          onNewSession={onNewSession}
          onSearch={onSearch}
          onSettings={onSettings}
          onHelp={onHelp}
          className="ml-auto flex items-center gap-1.5 px-3 min-[900px]:gap-2 min-[900px]:px-4"
        >
          {children}
        </AppActions>
      ) : (
        <TrafficLights
          onClose={handleClose}
          onMinimize={handleMinimize}
          onMaximize={handleToggleMaximize}
          inverted
          className="ml-auto flex items-center gap-1 px-2 min-[900px]:gap-1.5 min-[900px]:px-3"
        />
      )}
    </div>
  )
}
