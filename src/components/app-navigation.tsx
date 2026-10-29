import { Fragment, lazy, Suspense, useEffect, useState } from "react"
import { ArrowUpRight, Calculator, Menu, BookOpen, CalendarDays, CalendarRange, ChartColumn, ChartNoAxesCombined, ChevronDown, CircleUserRound, GraduationCap, Layers, Library, ListChecks, MessageSquare, Plus, Search, Settings2, Target, Timer, TrendingUp, Users, UsersRound } from "lucide-react"
import { toast } from "sonner"
import { Button } from "./ui/button"

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
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "./ui/sidebar"
import { useSidebar } from "../hooks/use-sidebar"
import type { AppView } from "../lib/app-view"
import { NAVIGATION_GROUPS, SETTINGS_ITEM } from "../lib/navigation"
import type { useStudySessionSync } from "../lib/study-session-sync"
import { isPaused, isRunning } from "../lib/sync/sessionContract"
import type { SyncStatus } from "../lib/sync"
import { cn } from "../lib/utils"
import { useAppearance } from "../lib/appearance"

type SessionSync = ReturnType<typeof useStudySessionSync>
const AppCommandMenu = lazy(() => import("./app-command-menu").then((module) => ({ default: module.AppCommandMenu })))
const MobileSearch = lazy(() => import("./app-command-menu").then((module) => ({ default: module.MobileSearch })))

const NAVIGATION_ICONS = {
  chat: MessageSquare,
  calendar: CalendarDays, exams: BookOpen, focus: Timer, mistakes: Layers,
  timetable: CalendarRange, sacs: GraduationCap, library: Library,
  progress: ChartNoAxesCombined, stoplight: ListChecks, goals: Target,
  predictor: TrendingUp, atar: Calculator, vcaa: ChartColumn, friends: UsersRound,
}

const MOBILE_TABS = [
  { id: "calendar", label: "Today" }, { id: "focus", label: "Timer" },
  { id: "mistakes", label: "Mistakes" }, { id: "exams", label: "Exams" },
] as const

/** Phone-style tab bar for the four daily destinations; everything else stays in the "More" sheet. */
export function MobileTabBar({ view, dueMistakes, plannedTasks, onViewChange }: { view: AppView; dueMistakes: number; plannedTasks: number; onViewChange: (view: AppView) => void }) {
  const { openMobile, setOpenMobile } = useSidebar()
  const inTabs = MOBILE_TABS.some((tab) => tab.id === view)
  // The active tab grows into a labelled pill; the rest stay icon-only with the label kept for screen readers.
  const tab = (key: string, label: string, Icon: typeof Menu, active: boolean, onClick: () => void, badge = 0) => (
    <button key={key} type="button" aria-current={active ? "page" : undefined} onClick={onClick}
      className={`relative flex h-11 min-w-11 items-center justify-center gap-2 rounded-full text-sm transition-[background-color,padding,color] duration-200 ease-(--ease-spring) ${active ? "shrink-0 bg-accent px-4 font-semibold text-accent-foreground" : "flex-1 text-muted-foreground"}`}>
      <Icon aria-hidden className="size-5 shrink-0" strokeWidth={active ? 2 : 1.5} />
      <span className={active ? "whitespace-nowrap" : "sr-only"}>{label}</span>
      {badge > 0 ? <span aria-label={`${badge} due`} className={`absolute top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[0.625rem] leading-4 font-semibold text-primary-foreground ring-2 ${active ? "left-7 ring-accent" : "left-1/2 ml-1 ring-card"}`}>{badge > 99 ? "99+" : badge}</span> : null}
    </button>
  )
  return (
    <nav aria-label="Main" className="mobile-tabbar pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-[max(1rem,env(safe-area-inset-left))] lg:hidden">
      <div className="pointer-events-auto flex w-full max-w-sm items-center gap-1 rounded-full border border-border bg-card p-1.5 shadow-lg shadow-black/10 dark:shadow-black/40">
      {MOBILE_TABS.map((item) => tab(item.id, item.label, NAVIGATION_ICONS[item.id], !openMobile && view === item.id, () => { setOpenMobile(false); onViewChange(item.id) },
        item.id === "mistakes" ? dueMistakes : item.id === "calendar" ? plannedTasks : 0))}
      {tab("more", "More", Menu, openMobile || !inTabs, () => setOpenMobile(!openMobile))}
      </div>
    </nav>
  )
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
  restoring: "Restoring your account…",
  reconnecting: "Reconnecting. Changes stay on this device",
  "sign-in-required": "Session ended. Sign in again to sync",
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
        status === "synced" && "bg-success",
        (status === "error" || status === "sign-in-required") && "bg-destructive",
        (status === "syncing" || status === "pending" || status === "restoring" || status === "reconnecting") && "animate-pulse bg-warning",
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
  onStartExam,
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
  onStartExam: () => void
  onLogMistake: () => void
  onSearch: () => void
  commandOpen: boolean
  onCommandOpenChange: (open: boolean) => void
}) {
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const appearance = useAppearance()
  useEffect(() => {
    if (commandOpen && !isMobile) setOpen(true)
  }, [commandOpen, isMobile, setOpen])
  const [commandLoaded, setCommandLoaded] = useState(false)
  if (commandOpen && !commandLoaded) setCommandLoaded(true)
  const accountLabel = user?.email || "Account"
  const accountStatus = syncStatus === "sign-in-required" ? "Sign in again" : syncStatus === "restoring" ? "Restoring account…"
    : syncStatus === "reconnecting" ? "Reconnecting…" : user ? "Signed in" : "Not signed in"
  const accountTooltip = `${accountLabel} · ${accountStatus}. Open account menu`

  function navigate(nextView: AppView) {
    onViewChange(nextView)
    setOpenMobile(false)
  }

  function run(action: () => void) {
    setOpenMobile(false)
    action()
  }

  const searchButton = <Button variant="ghost" aria-label="Search anything" onClick={() => run(onSearch)} className="mx-2 h-8 justify-start gap-2 rounded-xs px-3 font-normal text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
    <Search className="size-4 shrink-0 opacity-70" strokeWidth={1.5} aria-hidden />
    <span className="flex-1 text-left text-[0.8125rem]">Search</span>
    <kbd className="rounded-xs border border-sidebar-border px-1.5 font-sans text-[0.625rem] text-sidebar-foreground/60" aria-hidden>{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd>
  </Button>

  return (
    <>
    {isMobile && commandLoaded && <Suspense fallback={null}><MobileSearch open={commandOpen} onOpenChange={onCommandOpenChange} icons={NAVIGATION_ICONS} onViewChange={navigate} onLogExam={() => run(onLogExam)} onLogPastStudy={() => run(onLogPastStudy)} onLogMistake={() => run(onLogMistake)} onStartExam={() => run(onStartExam)} /></Suspense>}
    <Sidebar side={appearance.sidebarSide} collapsible="icon" className="focal-navigation">
      <SidebarHeader className="gap-5 px-5 pt-7 pb-5 group-data-[collapsible=icon]:gap-3 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:pt-3">
        <div className="flex items-center group-data-[collapsible=icon]:justify-center">
          <Button
            variant="ghost"
            className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-sm p-0 text-left hover:bg-transparent group-data-[collapsible=icon]:hidden"
            aria-label="Focal home"
            onClick={() => navigate("calendar")}
          >
            <span className="font-heading text-[2.75rem] leading-none tracking-[-0.06em] text-sidebar-primary">focal<span className="text-chart-1">.</span></span>
          </Button>
          <SidebarTrigger className="shrink-0 text-sidebar-foreground/60" />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton tooltip="Add" data-tour="add" className="h-10 gap-2 rounded-sm bg-primary px-3 text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" />}>
                <Plus aria-hidden />
                <span className="min-w-0 flex-1 truncate text-left group-data-[collapsible=icon]:hidden">Add to your study</span>
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
      <SidebarContent className="gap-4 px-3 group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-2">
        {!isMobile && (commandOpen || commandLoaded) ? <Suspense fallback={searchButton}><AppCommandMenu open={commandOpen} onOpenChange={onCommandOpenChange} onViewChange={navigate} onLogExam={() => run(onLogExam)} onLogPastStudy={() => run(onLogPastStudy)} onLogMistake={() => run(onLogMistake)} onStartExam={() => run(onStartExam)} /></Suspense> : searchButton}
        <Button variant="ghost" aria-label="Search anything" onClick={() => { setOpen(true); onSearch() }} className="hidden h-8 rounded-xs text-sidebar-foreground/70 hover:bg-sidebar-accent group-data-[collapsible=icon]:flex"><Search className="size-4 opacity-70" strokeWidth={1.5} aria-hidden /></Button>
        {NAVIGATION_GROUPS.map((group) => {
          const items = [...group.items].filter((item) => !appearance.hiddenLinks.includes(item.id)).sort((a, b) => (appearance.linkOrder.indexOf(a.id) + 1 || 100) - (appearance.linkOrder.indexOf(b.id) + 1 || 100))
          if (!items.length) return null
          return <SidebarGroup className="p-0" data-nav-group={group.label} key={group.label}>
          {appearance.sidebarLabels ? <SidebarGroupLabel className="focal-eyebrow mb-1 h-6 gap-2 px-3">{group.label}</SidebarGroupLabel> : null}
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = NAVIGATION_ICONS[item.id as keyof typeof NAVIGATION_ICONS]
                return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={view === item.id}
                    aria-current={view === item.id ? "page" : undefined}
                    tooltip={item.label}
                    data-tour={`nav-${item.id}`}
                    className="h-9 gap-3 rounded-xs px-3 text-[0.8125rem]"
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
        </SidebarGroup>})}
      </SidebarContent>
      <SidebarFooter className="gap-3 px-5 pt-4 pb-5 group-data-[collapsible=icon]:px-2">
        <SharedSessions sessions={sessions} onControl={onControlSession} />
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings" data-tour="settings" isActive={view === "settings"} aria-current={view === "settings" ? "page" : undefined} onClick={() => navigate("settings")}>
              <Settings2 aria-hidden strokeWidth={1.5} /><span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" data-tour="account" tooltip={accountTooltip} aria-label={accountTooltip} />}>
                <CircleUserRound aria-hidden className="size-6! text-sidebar-foreground/60" strokeWidth={1.25} />
                <span className="flex min-w-0 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
                  <span className="truncate">{accountLabel}</span>
                  <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground"><SyncIndicator status={syncStatus} />{accountStatus}</span>
                </span>
                <ArrowUpRight aria-hidden className="ml-auto size-3.5! opacity-50 group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">{accountLabel}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => navigate(SETTINGS_ITEM.id)}>
                    Settings
                  </DropdownMenuItem>
                  {user && syncStatus === "sign-in-required" ? <DropdownMenuItem onClick={() => navigate(SETTINGS_ITEM.id)}>Sign in again</DropdownMenuItem> : null}
                  {user
                    ? <DropdownMenuItem variant="destructive" onClick={() => onSignOut()}>Sign out</DropdownMenuItem>
                    : <DropdownMenuItem onClick={() => navigate(SETTINGS_ITEM.id)}>Sign in</DropdownMenuItem>}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    </>
  )
}
