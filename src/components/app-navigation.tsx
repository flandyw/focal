import { Fragment } from "react"
import { AppCommandMenu } from "./app-command-menu"
import { ArrowUpRight, BookOpen, CalendarDays, CalendarRange, ChartColumn, ChartNoAxesCombined, ChevronDown, CircleUserRound, GraduationCap, Layers, Library, ListChecks, Plus, Search, Target, Timer, TrendingUp, Users } from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar"
import type { AppView } from "../lib/app-view"
import { NAVIGATION_GROUPS, SETTINGS_ITEM } from "../lib/navigation"
import type { useStudySessionSync } from "../lib/study-session-sync"
import { isPaused, isRunning } from "../lib/sync/sessionContract"
import type { SyncStatus } from "../lib/sync"
import { cn } from "../lib/utils"

type SessionSync = ReturnType<typeof useStudySessionSync>

const NAVIGATION_ICONS = {
  calendar: CalendarDays, exams: BookOpen, focus: Timer, mistakes: Layers,
  timetable: CalendarRange, sacs: GraduationCap, library: Library,
  progress: ChartNoAxesCombined, stoplight: ListChecks, goals: Target,
  predictor: TrendingUp, vcaa: ChartColumn,
}

/** Minutes actually spent in a sitting: finished segments plus the one in progress. */
function workedLabel(session: SessionSync["sessions"][number]) {
  const minutes = session.segments.reduce((total, segment) => total + (new Date(segment.ended_at ?? Date.now()).getTime() - new Date(segment.started_at).getTime()) / 60_000, 0)
  const rounded = Math.max(0, Math.round(minutes))
  return `${Math.floor(rounded / 60)}h ${rounded % 60}m`
}

function SharedSessions({ sessions, onControl }: { sessions: SessionSync["sessions"]; onControl: SessionSync["control"] }) {
  const active = sessions.filter((session) => session.originating_app !== "examtrack" && (isRunning(session) || isPaused(session)))
  if (active.length === 0) return null

  // ponytail: no per-row pending state; the menu closes on click and sync polls the
  // canonical session list. Upgrade path if that latency ever matters: track busy ids.
  // Worked minutes are read at render, so they tick as often as the sync poll does.
  function control(session: SessionSync["sessions"][number], action: "pause" | "resume" | "complete" | "cancel") {
    void onControl(session, action).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not save the session action.")
    })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton tooltip="Shared study sessions" />}>
            <Users aria-hidden className="opacity-70" strokeWidth={1.5} />
            <span className="group-data-[collapsible=icon]:hidden">Shared sessions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {active.map((session, index) => (
              <Fragment key={session.id}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">
                    {session.title}
                    <span className="ml-1 text-muted-foreground">{workedLabel(session)}</span>
                  </DropdownMenuLabel>
                  {isPaused(session)
                    ? <DropdownMenuItem onClick={() => control(session, "resume")}>Resume</DropdownMenuItem>
                    : <DropdownMenuItem onClick={() => control(session, "pause")}>Pause</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => control(session, "complete")}>Finish</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => control(session, "cancel")}>Cancel</DropdownMenuItem>
                </DropdownMenuGroup>
                {index < active.length - 1 ? <DropdownMenuSeparator /> : null}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

const SYNC_LABELS: Record<SyncStatus, string> = {
  synced: "Synced with your account",
  syncing: "Syncing…",
  pending: "Changes queued to sync",
  error: "Sync failed. Retry from settings",
  "signed-out": "Not signed in. Stored on this device",
  unconfigured: "Cloud sync is not configured. Stored on this device",
}

function SyncIndicator({ status }: { status: SyncStatus }) {
  return (
    <span
      role="status"
      title={SYNC_LABELS[status]}
      aria-label={SYNC_LABELS[status]}
      className={cn(
        "size-2 shrink-0 rounded-full bg-muted-foreground/40",
        status === "synced" && "bg-primary",
        status === "error" && "bg-destructive",
        (status === "syncing" || status === "pending") && "animate-pulse bg-primary",
      )}
    />
  )
}

export function AppSidebar({
  view,
  dueMistakes,
  plannedTasks,
  syncStatus,
  user,
  sessions,
  onViewChange,
  onSignOut,
  onControlSession,
  onLogExam,
  onLogPastStudy,
  onLogMistake,
  onSearch,
  commandOpen,
  onCommandOpenChange,
}: {
  view: AppView
  dueMistakes: number
  plannedTasks: number
  syncStatus: SyncStatus
  user: { email?: string } | null
  sessions: SessionSync["sessions"]
  onViewChange: (view: AppView) => void
  onSignOut: () => void
  onControlSession: SessionSync["control"]
  onLogExam: () => void
  onLogPastStudy: () => void
  onLogMistake: () => void
  onSearch: () => void
  commandOpen: boolean
  onCommandOpenChange: (open: boolean) => void
}) {
  const { setOpen, setOpenMobile } = useSidebar()
  const accountLabel = user?.email || "Account"
  const accountStatus = user ? "Signed in" : "Not signed in"
  const accountTooltip = `${accountLabel} · ${accountStatus}. Open account menu`

  function navigate(nextView: AppView) {
    onViewChange(nextView)
    setOpenMobile(false)
  }

  function run(action: () => void) {
    setOpenMobile(false)
    action()
  }

  return (
    <Sidebar collapsible="icon" className="focal-navigation">
      <SidebarHeader className="gap-5 px-5 pt-7 pb-5 group-data-[collapsible=icon]:gap-3 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:pt-3">
        <div className="flex items-center group-data-[collapsible=icon]:justify-center">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
            aria-label="Focal home"
            onClick={() => navigate("calendar")}
          >
            <span className="font-heading text-[2.75rem] leading-none tracking-[-0.06em] text-sidebar-primary">focal<span className="text-chart-1">.</span></span>
          </button>
          <SidebarTrigger className="shrink-0 text-sidebar-foreground/60" />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton tooltip="Add" className="h-10 gap-2 rounded-sm bg-primary px-3 text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" />}>
                <Plus aria-hidden />
                <span className="flex-1 group-data-[collapsible=icon]:hidden">Add to your study</span>
                <ChevronDown aria-hidden className="size-3! opacity-60 group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52">
                <DropdownMenuItem onClick={() => run(onLogExam)}>Log exam</DropdownMenuItem>
                <DropdownMenuItem onClick={() => run(onLogPastStudy)}>Log past study</DropdownMenuItem>
                <DropdownMenuItem onClick={() => run(onLogMistake)}>Log mistake</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => run(onSearch)}>Search actions</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-4 px-3">
        <button type="button" aria-label="Search anything" onClick={() => { setOpen(true); run(onSearch) }} className="mx-2 flex items-center gap-2 border-b border-sidebar-border pb-3 text-xs text-sidebar-foreground/80 hover:text-sidebar-primary group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-b-0 group-data-[collapsible=icon]:pb-0"><Search className="size-3.5" aria-hidden /><span className="group-data-[collapsible=icon]:hidden">Search anything</span><span className="ml-auto text-[10px] group-data-[collapsible=icon]:hidden" aria-hidden>⌘ / Ctrl K</span></button>
        {commandOpen && <div className="mx-2 -mt-2 group-data-[collapsible=icon]:hidden"><AppCommandMenu onOpenChange={onCommandOpenChange} onViewChange={navigate} onLogExam={() => run(onLogExam)} onLogMistake={() => run(onLogMistake)} /></div>}
        {NAVIGATION_GROUPS.map((group, index) => <SidebarGroup className="p-0" key={group.label}>
          <SidebarGroupLabel className="focal-eyebrow mb-1 h-6 gap-2 px-3"><span aria-hidden className="font-normal opacity-50">0{index + 1}</span>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = NAVIGATION_ICONS[item.id as keyof typeof NAVIGATION_ICONS]
                return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={view === item.id}
                    aria-current={view === item.id ? "page" : undefined}
                    tooltip={item.label}
                    className="h-9 gap-3 rounded-xs px-3 text-[13px]"
                    onClick={() => navigate(item.id)}
                  >
                    <Icon aria-hidden className="size-4! opacity-70" strokeWidth={1.5} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.id === "mistakes" && dueMistakes > 0 ? (
                    <SidebarMenuBadge aria-label={`${dueMistakes} mistakes due`}>{dueMistakes}</SidebarMenuBadge>
                  ) : null}
                  {item.id === "calendar" && plannedTasks > 0 ? (
                    <SidebarMenuBadge aria-label={`${plannedTasks} study tasks due`}>{plannedTasks}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              )})}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>)}
      </SidebarContent>
      <SidebarFooter className="gap-3 px-5 pt-4 pb-5 group-data-[collapsible=icon]:px-2">
        <SharedSessions sessions={sessions} onControl={onControlSession} />
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={accountTooltip} aria-label={accountTooltip} />}>
                <CircleUserRound aria-hidden className="size-6! text-sidebar-foreground/60" strokeWidth={1.25} />
                <span className="flex min-w-0 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
                  <span className="truncate">{accountLabel}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><SyncIndicator status={syncStatus} />{accountStatus}</span>
                </span>
                <ArrowUpRight aria-hidden className="ml-auto size-3.5! opacity-50 group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">{accountLabel}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => navigate(SETTINGS_ITEM.id)}>
                    Settings
                  </DropdownMenuItem>
                  {user
                    ? <DropdownMenuItem variant="destructive" onClick={() => onSignOut()}>Sign out</DropdownMenuItem>
                    : <DropdownMenuItem onClick={() => navigate(SETTINGS_ITEM.id)}>Sign in</DropdownMenuItem>}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
