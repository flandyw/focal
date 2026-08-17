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
  Square,
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

interface WindowControlProps {
  onClick: () => void
  label: string
  icon: typeof X
  close?: boolean
}

function WindowControl({ onClick, label, icon: Icon, close = false }: WindowControlProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={close
        ? "flex h-full w-11 items-center justify-center text-foreground/80 transition-colors hover:bg-[#c42b1c] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        : "flex h-full w-11 items-center justify-center text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"}
    >
      <Icon className="size-3.5 stroke-[1.5]" aria-hidden="true" />
    </button>
  )
}

function WindowControls({
  onClose,
  onMinimize,
  onMaximize,
  className,
}: {
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
  className?: string
}) {
  return (
    <div className={className} role="group" aria-label="Window controls">
      <WindowControl onClick={onMinimize} label="Minimize window" icon={Minus} />
      <WindowControl onClick={onMaximize} label="Toggle maximize" icon={Square} />
      <WindowControl onClick={onClose} label="Close window" icon={X} close />
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
        <WindowControls
          onClose={handleClose}
          onMinimize={handleMinimize}
          onMaximize={handleToggleMaximize}
          className="ml-auto flex h-full items-stretch"
        />
      )}
    </div>
  )
}
