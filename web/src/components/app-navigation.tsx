import { Fragment } from "react"
import {
  GraduationCap,
  LogIn,
  LogOut,
  MonitorPlay,
  Pause,
  Play,
  Check,
  Trash2,
  Search,
  Settings2,
  UserRound,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  useSidebar,
} from "@/components/ui/sidebar"
import type { AppView } from "@/lib/app-view"
import { NAVIGATION_GROUPS, SETTINGS_ITEM } from "@/lib/navigation"
import type { useStudySessionSync } from "@/lib/study-session-sync"

type SessionSync = ReturnType<typeof useStudySessionSync>

function SharedSessions({ sessions, onControl }: { sessions: SessionSync["sessions"]; onControl: SessionSync["control"] }) {
  const active = sessions.filter((session) => session.originating_app !== "examtrack" && (session.state === "running" || session.state === "paused"))
  if (active.length === 0) return null

  // ponytail: no per-row pending state; the menu closes on click and sync polls the
  // canonical session list. Upgrade path if that latency ever matters: track busy ids.
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
            <MonitorPlay aria-hidden />
            <span>Shared sessions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {active.map((session, index) => (
              <Fragment key={session.id}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">{session.title}</DropdownMenuLabel>
                  {session.state === "paused"
                    ? <DropdownMenuItem onClick={() => control(session, "resume")}><Play aria-hidden />Resume</DropdownMenuItem>
                    : <DropdownMenuItem onClick={() => control(session, "pause")}><Pause aria-hidden />Pause</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => control(session, "complete")}><Check aria-hidden />Finish</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => control(session, "cancel")}><Trash2 aria-hidden />Cancel</DropdownMenuItem>
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

export function AppSidebar({
  view,
  dueMistakes,
  plannedTasks,
  syncLabel,
  user,
  sessions,
  onViewChange,
  onSignOut,
  onControlSession,
}: {
  view: AppView
  dueMistakes: number
  plannedTasks: number
  syncLabel: string
  user: { email?: string } | null
  sessions: SessionSync["sessions"]
  onViewChange: (view: AppView) => void
  onSignOut: () => void
  onControlSession: SessionSync["control"]
}) {
  const { setOpenMobile } = useSidebar()
  const accountLabel = user?.email || "Account"
  const accountStatus = user ? "Signed in" : "Not signed in"
  const accountTooltip = `${accountLabel} · ${accountStatus}. Open account menu`

  function navigate(nextView: AppView) {
    onViewChange(nextView)
    setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="pb-1">
        <button
          type="button"
          className="flex h-10 items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          onClick={() => navigate("calendar")}
        >
          <GraduationCap className="size-5 shrink-0" aria-hidden />
          <span className="font-semibold group-data-[collapsible=icon]:hidden">Focal</span>
        </button>
      </SidebarHeader>
      <SidebarContent className="gap-1 px-1">
        {NAVIGATION_GROUPS.map((group) => <SidebarGroup className="p-1.5" key={group.label}>
          <SidebarGroupLabel className="h-7 px-1.5">{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={view === item.id}
                    aria-current={view === item.id ? "page" : undefined}
                    tooltip={item.label}
                    onClick={() => navigate(item.id)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.id === "mistakes" && dueMistakes > 0 ? (
                    <SidebarMenuBadge aria-label={`${dueMistakes} mistakes due`}>{dueMistakes}</SidebarMenuBadge>
                  ) : null}
                  {item.id === "calendar" && plannedTasks > 0 ? (
                    <SidebarMenuBadge aria-label={`${plannedTasks} study tasks due`}>{plannedTasks}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>)}
      </SidebarContent>
      <SidebarFooter className="gap-3 pt-3">
        <SharedSessions sessions={sessions} onControl={onControlSession} />
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={accountTooltip} aria-label={accountTooltip} />}>
                <UserRound aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
                  <span className="truncate">{accountLabel}</span>
                  <span className="text-xs text-muted-foreground">{accountStatus}</span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">{accountLabel}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => navigate(SETTINGS_ITEM.id)}>
                    <Settings2 aria-hidden />
                    Settings
                  </DropdownMenuItem>
                  {user
                    ? <DropdownMenuItem variant="destructive" onClick={() => onSignOut()}><LogOut aria-hidden />Sign out</DropdownMenuItem>
                    : <DropdownMenuItem onClick={() => navigate(SETTINGS_ITEM.id)}><LogIn aria-hidden />Sign in</DropdownMenuItem>}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <span className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">{syncLabel}</span>
      </SidebarFooter>
    </Sidebar>
  )
}

export function CommandMenuTrigger({ onClick }: { onClick: () => void }) {
  return (
    <>
      <Button variant="outline" size="sm" className="hidden min-w-40 justify-start text-muted-foreground sm:flex" onClick={onClick}>
        <Search aria-hidden />
        <span>Search actions</span>
        <kbd className="ml-auto rounded border bg-muted px-1 font-sans text-[10px] text-muted-foreground">⌘K</kbd>
      </Button>
      <Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label="Search pages and actions" onClick={onClick}>
        <Search aria-hidden />
      </Button>
    </>
  )
}