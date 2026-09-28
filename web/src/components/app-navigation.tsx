import {
  GraduationCap,
  Search,
} from "lucide-react"

import { Button } from "@/components/ui/button"
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
  useSidebar,
} from "@/components/ui/sidebar"
import type { AppView } from "@/lib/app-view"
import { NAVIGATION_GROUPS, SETTINGS_ITEM } from "@/lib/navigation"

export function AppSidebar({
  view,
  dueMistakes,
  plannedTasks,
  syncLabel,
  onViewChange,
}: {
  view: AppView
  dueMistakes: number
  plannedTasks: number
  syncLabel: string
  onViewChange: (view: AppView) => void
}) {
  const { setOpenMobile } = useSidebar()

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
          onClick={() => navigate("dashboard")}
        >
          <GraduationCap className="size-5 shrink-0" aria-hidden />
          <span className="font-semibold group-data-[collapsible=icon]:hidden">ExamTrack</span>
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
                  {item.id === "planner" && plannedTasks > 0 ? (
                    <SidebarMenuBadge aria-label={`${plannedTasks} study tasks due`}>{plannedTasks}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>)}
      </SidebarContent>
      <SidebarFooter className="gap-1 pt-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={view === SETTINGS_ITEM.id}
              aria-current={view === SETTINGS_ITEM.id ? "page" : undefined}
              tooltip={SETTINGS_ITEM.label}
              onClick={() => navigate(SETTINGS_ITEM.id)}
            >
              <SETTINGS_ITEM.icon />
              <span>{SETTINGS_ITEM.label}</span>
            </SidebarMenuButton>
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
