import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CalendarClock, Check, Clock, Copy, Flame, HeartHandshake, Link2, LogIn, Pencil, Plus, Radio, Settings2, Sigma, Trash2, Trophy, UserPlus, UsersRound } from "lucide-react"
import { differenceInCalendarDays, format, formatDistanceToNow, subDays } from "date-fns"
import { toast } from "sonner"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Skeleton } from "./ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { PageHeader } from "./page-header"
import { Delta, EmptyState, Panel, StatGrid, StatTile, WorkspacePage } from "./workspace-layout"
import { useTickingNow } from "../hooks/use-ticking-now"
import { getHeatColor, getSubjectColor, heatLevel } from "../lib/progress-chart-theme"
import { formatDuration as duration, subjectLabel as subjectName } from "../lib/progress-utils"
import { supabase } from "../lib/supabase"
import { cn } from "../lib/utils"
import { Avatar, AvatarBadge, AvatarFallback } from "./ui/avatar"
import { Checkbox } from "./ui/checkbox"
import { Label } from "./ui/label"
import { FriendStudySessions } from "./friend-study-sessions"
import { FriendsInsights, type InsightRow } from "./friends-insights"
import type { CanonicalStudySession } from "../lib/sync/sessionContract"

type SharedExam = { subject: string | null; title: string | null; provider: string | null; examYear: number | null; paper: string | null; referenceId: string | null; rawScore: number | null; rawMax: number | null; completedAt: string | null }
type Person = {
  user_id: string
  display_name: string
  username: string
  nickname: string | null
  status_message: string
  status: "me" | "friend" | "incoming" | "outgoing"
  studying_since: string | null
  studying_subject: string | null
  studying_kind: string | null
  total_ms: number
  daily: Record<string, number> | null
  today_blocks: [string, string | null, string?][] | null
  subjects: Record<string, number> | null
  exams: SharedExam[] | null
}
type Profile = { username: string; display_name: string; status_message: string; share_exams: boolean; share_subjects: boolean; require_requests: boolean }
type BlockedPerson = { user_id: string; username: string | null; display_name: string | null }
type Period = "today" | "week" | "month" | "quarter"
type Cheer = { sender_id: string; recipient_id: string; sender_name: string; created_at: string; message?: string | null }
type Group = { id: string; name: string; goal_minutes: number; owner_id: string; members: string[] }
type Countdown = { user_id: string; title: string; starts: string }
type GroupDraft = { id: string | null; name: string; hours: string; members: string[] }
const CHEER_MESSAGES = ["Good luck!", "Keep going!", "Join me?", "Nice work!"]
const INVITE_BASE = import.meta.env.VITE_DESKTOP ? "https://focal.flandolf.me" : location.origin
type StudyStats = ReturnType<typeof activity>

const PERIOD_LABEL: Record<Period, string> = { today: "Today", week: "7 days", month: "30 days", quarter: "12 weeks" }
const PERIOD_DAYS: Record<Period, number> = { today: 1, week: 7, month: 30, quarter: 84 }
const TILE_GRID = "md:grid-cols-3 2xl:grid-cols-6"
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

const personName = (person: Person) => person.nickname || person.display_name

const clock = (ms: number) => [Math.floor(ms / 3_600_000), Math.floor(ms / 60_000) % 60, Math.floor(ms / 1000) % 60].map((n) => String(n).padStart(2, "0")).join(":")
const dayKey = (date: Date) => format(date, "yyyy-MM-dd")
const percent = (exam: SharedExam) => exam.rawScore != null && exam.rawMax ? Math.round(exam.rawScore / exam.rawMax * 100) : null

/** Activity for one person with the running block topped up to `now`, so live timers tick between fetches. */
function activity(person: Person, now: Date, fetchedAt: number) {
  const live = person.studying_since ? Math.max(0, now.getTime() - fetchedAt) : 0
  const day = (offset: number) => {
    const date = subDays(now, offset)
    const start = new Date(date).setHours(0, 0, 0, 0)
    const end = new Date(date).setHours(24, 0, 0, 0)
    const extra = person.studying_since ? Math.max(0, Math.min(now.getTime(), end) - Math.max(fetchedAt, start)) : 0
    return (person.daily?.[dayKey(date)] ?? 0) + extra
  }
  const sum = (days: number) => Array.from({ length: days }, (_, offset) => day(offset)).reduce((a, b) => a + b, 0)
  let streak = day(0) >= 60_000 ? 1 : 0
  for (let offset = 1; offset < 84 && day(offset) >= 60_000; offset++) streak++
  return {
    day, streak,
    period: { today: day(0), week: sum(7), month: sum(30), quarter: sum(84) } as Record<Period, number>,
    activeDays: (days: number) => Array.from({ length: days }, (_, offset) => day(offset)).filter((ms) => ms >= 60_000).length,
    total: person.total_ms + live,
    session: person.studying_since ? Math.max(0, now.getTime() - new Date(person.studying_since).getTime()) : 0,
  }
}

function PersonAvatar({ person, className }: { person: Person; className?: string }) {
  return (
    <Avatar className={cn("size-9 text-sm font-medium", className)} aria-hidden>
      <AvatarFallback className="text-[length:inherit]">{personName(person).slice(0, 1).toUpperCase()}</AvatarFallback>
      {person.studying_since ? <AvatarBadge /> : null}
    </Avatar>
  )
}

const personColor = (index: number) => `var(--chart-${index % 8 + 1})`
const timeOfDay = (iso: string) => format(new Date(iso), "h:mmaaa")

/** One 24-hour track; blocks are today's study, the open one runs to now. Hover or focus a block for its time, duration and subject. */
function DayTrack({ blocks, now, className, color }: { blocks: Person["today_blocks"]; now: Date; className?: string; color?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const start = new Date(now).setHours(0, 0, 0, 0)
  const end = new Date(now).setHours(24, 0, 0, 0)
  const at = (iso: string | null) => Math.min(100, Math.max(0, ((iso ? new Date(iso).getTime() : now.getTime()) - start) / (end - start) * 100))
  const tip = hover === null ? null : (blocks ?? [])[hover]
  const center = tip ? Math.min(85, Math.max(15, (at(tip[0]) + at(tip[1])) / 2)) : 0
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className={cn("relative h-3 overflow-hidden rounded-sm bg-muted", className)}>
        {[25, 50, 75].map((left) => <span key={left} className="absolute inset-y-0 w-px bg-border" style={{ left: `${left}%` }} />)}
        {(blocks ?? []).map(([from, to], index) => (
          <span key={index} tabIndex={0} role="img" aria-label={`Studied ${timeOfDay(from)} to ${to ? timeOfDay(to) : "now"}`} onClick={() => setHover(index)} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} className={cn("absolute inset-y-0 rounded-[2px] bg-primary outline-none transition-[filter] hover:brightness-125 focus-visible:brightness-125", !to && "motion-safe:animate-pulse")} style={{ left: `${at(from)}%`, width: `max(5px, ${at(to) - at(from)}%)`, background: color }} />
        ))}
        <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${at(null)}%` }} />
      </div>
      {tip ? <div role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md" style={{ left: `${center}%` }}>
        <span className="font-medium tabular-nums">{duration((tip[1] ? new Date(tip[1]).getTime() : now.getTime()) - new Date(tip[0]).getTime())}</span>
        {tip[2] != null ? <> · {subjectName(tip[2] || null)}</> : null}
        <span className="block text-muted-foreground tabular-nums">{timeOfDay(tip[0])} – {tip[1] ? timeOfDay(tip[1]) : "now"}</span>
      </div> : null}
    </div>
  )
}

function PeriodBars({ day, days }: { day: (offset: number) => number; days: number }) {
  const values = Array.from({ length: days }, (_, index) => day(days - 1 - index))
  const max = Math.max(...values, 3_600_000)
  return (
    <div className="flex h-6 items-end gap-0.5" role="img" aria-label={`Daily study over the last ${days} days`} title={`Daily study over the last ${days} days`}>
      {values.map((value, index) => <span key={index} className={cn(days === 7 ? "w-1.5" : "min-w-0 flex-1", "rounded-t-[2px]", value ? "bg-primary/70" : "bg-muted")} style={{ height: `${Math.max(8, value / max * 100)}%` }} />)}
    </div>
  )
}

type ChartSeries = { id: string; name: string; day: (offset: number) => number; className: string }

/** Paired bars for the last 30 days; oldest day on the left. Hover or focus a day to read it. */
function DailyChart({ series, now }: { series: ChartSeries[]; now: Date }) {
  const [hover, setHover] = useState<number | null>(null)
  const days = Array.from({ length: 30 }, (_, index) => 29 - index)
  const sum = (s: ChartSeries) => days.reduce((total, offset) => total + s.day(offset), 0)
  const max = Math.max(...days.flatMap((offset) => series.map((s) => s.day(offset))), 3_600_000)
  return (
    <div className="grid gap-1.5" onMouseLeave={() => setHover(null)}>
      <div className="flex min-h-5 flex-wrap items-center gap-x-3 text-xs text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground">{hover === null ? "Daily average" : format(subDays(now, hover), "EEE d MMM")}</span>
        {series.map((s) => <span key={s.id} className="flex items-center gap-1"><span className={cn("size-2 rounded-full", s.className)} />{s.name} <span className="tabular-nums text-foreground">{duration(hover === null ? sum(s) / 30 : s.day(hover))}</span></span>)}
      </div>
      <div className="flex h-24 items-end gap-[2px]" role="group" aria-label={`Daily study for the last 30 days. ${series.map((s) => `${s.name}: ${duration(sum(s))}`).join(". ")}.`}>
        {days.map((offset) => (
          <div key={offset} tabIndex={0} role="img" aria-label={`${format(subDays(now, offset), "EEEE d MMMM")}: ${series.map((s) => `${s.name} ${duration(s.day(offset))}`).join(", ")}`} onClick={() => setHover(offset)} onMouseEnter={() => setHover(offset)} onFocus={() => setHover(offset)} onBlur={() => setHover(null)} className={cn("flex h-full flex-1 items-end gap-px rounded-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring", hover !== null && hover !== offset && "opacity-40", hover === offset && "bg-muted/60")}>
            {series.map((s) => <span key={s.id} className={cn("w-full rounded-t-[2px]", s.className)} style={{ height: `${Math.max(s.day(offset) ? 3 : 0, s.day(offset) / max * 100)}%` }} />)}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden><span>{days[0]} days ago</span><span>Today</span></div>
    </div>
  )
}

/** Average study per weekday over the last 12 weeks, Monday first. */
function WeekdayChart({ series, now }: { series: ChartSeries[]; now: Date }) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const today = (now.getDay() + 6) % 7
  const averages = (day: (offset: number) => number) => names.map((_, weekday) => {
    const offsets = Array.from({ length: 84 }, (_, offset) => offset).filter((offset) => ((today - offset) % 7 + 7) % 7 === weekday)
    return offsets.reduce((sum, offset) => sum + day(offset), 0) / offsets.length
  })
  const data = series.map((s) => ({ ...s, values: averages(s.day) }))
  const max = Math.max(...data.flatMap((s) => s.values), 3_600_000)
  return (
    <div className="grid grid-cols-7 gap-2" role="img" aria-label={`Average study per weekday over 12 weeks. ${data.map((s) => `${s.name}: ${s.values.map((v, i) => `${names[i]} ${duration(v)}`).join(", ")}`).join(". ")}.`}>
      {names.map((name, index) => (
        <div key={name} className="grid gap-1 text-center text-xs text-muted-foreground">
          <div className="flex h-20 items-end justify-center gap-0.5">
            {data.map((s) => <span key={s.id} className={cn("w-full max-w-4 rounded-t-[2px]", s.className)} style={{ height: `${Math.max(s.values[index] ? 4 : 0, s.values[index] / max * 100)}%` }} title={`${s.name}: ${duration(s.values[index])} on average`} />)}
          </div>
          {name}
        </div>
      ))}
    </div>
  )
}

type FriendsCache = { userId?: string; profile: Profile | null; people: Person[]; fetchedAt: number; cheers: Cheer[] | null }
const emptyCache = (userId?: string): FriendsCache => ({ userId, profile: null, people: [], fetchedAt: 0, cheers: null })
// In memory only: revisiting Friends shows the last result at once while it refreshes. Another account never sees it.
let cache = emptyCache()
// Event handlers update the module cache through this, never during render.
const rememberProfile = (profile: Profile) => { cache.profile = profile }
supabase?.auth.onAuthStateChange((_event, session) => { if (session?.user.id !== cache.userId) cache = emptyCache(session?.user.id) })

export function FriendsPage({ signedIn, userId, sessions, onSignIn, onJoin }: {
  signedIn: boolean; userId?: string; sessions: CanonicalStudySession[]; onSignIn: () => void
  onJoin: (subject?: string, intent?: string, sessionId?: string) => void
}) {
  const [dialog, setDialog] = useState<"add" | "profile" | null>(() => new URLSearchParams(location.search).has("add") ? "add" : null)
  const [profile, setProfile] = useState(cache.profile)
  const [draft, setDraft] = useState({ name: cache.profile?.display_name ?? "", username: cache.profile?.username ?? "", status: cache.profile?.status_message ?? "" })
  const [people, setPeople] = useState(cache.people)
  const [fetchedAt, setFetchedAt] = useState(cache.fetchedAt)
  const [friendUsername, setFriendUsername] = useState(() => (new URLSearchParams(location.search).get("add") ?? "").replace(/^@/, "").toLowerCase().slice(0, 24))
  const [period, setPeriod] = useState<Period>("today")
  const [cheers, setCheers] = useState(cache.cheers ?? [])
  const [blocked, setBlocked] = useState<BlockedPerson[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState("all")
  const [editing, setEditing] = useState<GroupDraft | null>(null)
  const [countdowns, setCountdowns] = useState<Countdown[]>([])
  const [cheerMessage, setCheerMessage] = useState(CHEER_MESSAGES[1])
  const [cheersError, setCheersError] = useState(false)
  const [cheersLoaded, setCheersLoaded] = useState(cache.cheers !== null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [profileError, setProfileError] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null)
  const [manualCopy, setManualCopy] = useState<string | null>(null)
  const actionInFlight = useRef(false)
  const loadSequence = useRef(0)
  const poll = useTickingNow(30_000)
  // Live totals only move while someone studies; otherwise a once-a-second render of every row buys nothing.
  const now = useTickingNow(people.some((person) => person.studying_since) ? 1_000 : 30_000)

  const loadCheers = useCallback(async () => {
    try {
      const { data, error } = await supabase!.rpc("friends_cheers")
      if (error) throw error
      cache.cheers = (data ?? []) as Cheer[]
      setCheers(cache.cheers)
      setCheersError(false)
      setCheersLoaded(true)
    } catch {
      setCheersError(true)
    }
  }, [])

  // Groups, exam countdowns, blocked people: optional extras, so a failure just leaves them empty.
  const loadExtras = useCallback(async () => {
    const [g, c, b] = await Promise.all([supabase!.rpc("friends_groups"), supabase!.rpc("friends_countdowns"), supabase!.rpc("friends_blocked")])
    if (!g.error) setGroups((g.data ?? []) as Group[])
    if (!c.error) setCountdowns((c.data ?? []) as Countdown[])
    if (!b.error) setBlocked((b.data ?? []) as BlockedPerson[])
  }, [])

  const load = useCallback(async () => {
    if (!signedIn) return
    const sequence = ++loadSequence.current
    try {
      const { data, error } = await supabase!.rpc("friends_list", { p_tz: TIME_ZONE })
      if (sequence !== loadSequence.current) return
      if (error) throw error
      cache = { ...cache, people: (data ?? []) as Person[], fetchedAt: Date.now() }
      setPeople(cache.people)
      setFetchedAt(cache.fetchedAt)
      setLoadError(false)
    } catch {
      if (sequence === loadSequence.current) setLoadError(true)
    }
  }, [signedIn])

  const loadProfile = useCallback(async () => {
    try {
      const { data, error } = await supabase!.rpc("friends_me").single<Profile>()
      if (error) throw error
      setProfileError(false)
      cache.profile = data
      setProfile(data)
      setDraft({ name: data.display_name, username: data.username, status: data.status_message })
    } catch {
      setProfileError(true)
    }
  }, [])

  useEffect(() => {
    if (!signedIn) return
    // oxlint-disable-next-line react/set-state-in-effect
    void loadProfile()
  }, [signedIn, loadProfile])
  // shortcut: data refreshes on a 30 s poll (and when the tab returns), not realtime; timers tick locally in between.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load(); if (signedIn) { void loadCheers(); void loadExtras() } }, [load, loadCheers, loadExtras, signedIn, poll])

  async function call(fn: string, args: Record<string, unknown>, failure: string) {
    if (actionInFlight.current) return false
    actionInFlight.current = true
    setPending(fn)
    try {
      const { error } = await supabase!.rpc(fn, args)
      if (error) { toast.error(error.message || failure); return false }
      await load()
      await loadCheers()
      await loadExtras()
      return true
    } catch {
      toast.error(failure)
      return false
    } finally {
      actionInFlight.current = false
      setPending(null)
    }
  }

  async function saveProfile(next: Profile) {
    const args = { p_username: next.username, p_display_name: next.display_name, p_status_message: next.status_message, p_share_exams: next.share_exams, p_share_subjects: next.share_subjects, p_require_requests: next.require_requests }
    if (await call("friends_update_profile", args, "Could not save your profile.")) {
      rememberProfile(next)
      setProfile(next)
      toast.success("Profile updated")
    }
  }

  const group = groups.find((entry) => entry.id === groupId)
  // Stable per person (not per rank or group filter), so a colour keeps meaning everywhere.
  const colorOf = (id: string) => personColor(Math.max(0, people.findIndex((person) => person.user_id === id)))
  const board = useMemo(() => {
    const rows = people.filter((person) => (person.status === "me" || person.status === "friend") && (!group || group.members.includes(person.user_id))).map((person) => {
      const stats = activity(person, now, fetchedAt)
      return { person, stats, score: Math.floor(stats.period[period] / 60_000), rank: 0 }
    }).sort((a, b) => b.score - a.score || personName(a.person).localeCompare(personName(b.person)) || a.person.user_id.localeCompare(b.person.user_id))
    for (let index = 0; index < rows.length; index++) {
      const previous = rows[index - 1]
      rows[index].rank = previous?.score === rows[index].score ? previous.rank : index + 1
    }
    return rows
  }, [people, group, now, fetchedAt, period])
  // The statistics follow the minute, not the second: live timers must not redraw every chart each tick.
  const minute = Math.floor(now.getTime() / 60_000)
  const insightRows = useMemo(() => people.flatMap((person, index): InsightRow[] => {
    if ((person.status !== "me" && person.status !== "friend") || (group && !group.members.includes(person.user_id))) return []
    const stats = activity(person, new Date(minute * 60_000), fetchedAt)
    return [{
      id: person.user_id, name: person.status === "me" ? "You" : personName(person), color: personColor(index), isMe: person.status === "me",
      days: Array.from({ length: 84 }, (_, offset) => stats.day(offset)), streak: stats.streak, total: stats.total, blocks: person.today_blocks, subjects: person.subjects,
      exams: person.exams?.flatMap((exam) => {
        const score = percent(exam)
        return score == null || !exam.completedAt ? [] : [{ title: `${exam.title ?? exam.subject ?? "Exam"}${exam.paper ? ` · ${exam.paper}` : ""}`, percent: score, at: Date.parse(exam.completedAt) }]
      }) ?? null,
    }]
  }), [people, group, minute, fetchedAt])

  if (!signedIn) {
    return (
      <WorkspacePage>
        <PageHeader icon={UsersRound} title="Friends" />
        <div className="rounded-lg border border-border bg-card"><EmptyState icon={UsersRound} title="Study alongside friends" description="See who’s studying now, cheer each other on, and compare study time. Friends need an account, so nothing leaves this device until you sign in." action={<Button onClick={onSignIn}><LogIn />Sign in to add friends</Button>} className="py-12" /></div>
      </WorkspacePage>
    )
  }

  const requests = people.filter((person) => person.status === "incoming" || person.status === "outgoing")
  const incoming = requests.filter((person) => person.status === "incoming").length
  const friends = people.filter((person) => person.status === "friend")
  const studying = board.filter(({ person }) => person.studying_since)
  const me = board.find(({ person }) => person.status === "me")
  const nextRival = me ? board.findLast((entry) => entry.score > me.score) : undefined
  const selected = board.find(({ person }) => person.user_id === selectedId)
  const loading = !fetchedAt && !loadError
  const nameOf = (id: string) => { const person = people.find((entry) => entry.user_id === id); return person?.status === "me" ? "You" : person ? personName(person) : "" }
  const receivedCheers = cheers.filter((cheer) => cheer.recipient_id === me?.person.user_id && friends.some((person) => person.user_id === cheer.sender_id))
  const cheered = (id: string) => cheers.some((cheer) => cheer.sender_id === me?.person.user_id && cheer.recipient_id === id && now.getTime() - new Date(cheer.created_at).getTime() < 86_400_000)
  const cheerOff = !!pending || !cheersLoaded || cheersError
  const cheerFriend = async (person: Person) => {
    if (person.status !== "friend" || cheered(person.user_id)) return
    if (await call("friends_cheer", { p_user_id: person.user_id, p_message: cheerMessage === "none" ? null : cheerMessage }, "Could not send your cheer. Try again.")) toast.success(`Cheer sent to ${personName(person)}`)
  }
  const saveGroup = async () => {
    if (!editing) return
    const ok = await call("friends_group_save", { p_id: editing.id, p_name: editing.name, p_goal_minutes: Math.round((Number(editing.hours) || 0) * 60), p_members: editing.members }, "Could not save the group.")
    if (ok) { setEditing(null); toast.success("Group saved") }
  }
  const weekOf = (id: string) => { const person = people.find((entry) => entry.user_id === id); return person ? activity(person, now, fetchedAt).period.week : 0 }
  // Promise.resolve().then also catches a missing Clipboard API, which throws synchronously.
  const copy = (text: string, done: string) => {
    setManualCopy(null)
    void Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => toast.success(done), () => { setManualCopy(text); toast.error("Could not copy. Select the text below and copy it manually.") })
  }
  const exams = countdowns.filter((entry) => people.some((person) => person.user_id === entry.user_id)).slice(0, 8)
  const standing = !me || board.length < 2 ? ""
    : nextRival ? `${duration((nextRival.score - me.score) * 60_000)} behind ${personName(nextRival.person)}`
    : board[0].score === 0 ? "no study logged yet"
    : board[1].score === me.score ? "you’re tied for the lead"
    : `you lead by ${duration((me.score - board[1].score) * 60_000)}`

  const days = PERIOD_DAYS[period]
  const sparkDays = Math.max(14, days)
  const others = board.filter(({ person }) => person.status !== "me")
  const mine = me?.stats.period[period] ?? 0
  // The period just before this one; twelve weeks is all the history there is, so it has none.
  const previous = !me || period === "quarter" ? 0 : Array.from({ length: days }, (_, offset) => me.stats.day(days + offset)).reduce((a, b) => a + b, 0)
  const friendsAverage = others.reduce((sum, { stats }) => sum + stats.period[period], 0) / (others.length || 1)
  const combined = board.reduce((sum, { stats }) => sum + stats.period[period], 0)
  const topStreak = board.reduce((best, entry) => entry.stats.streak > best.stats.streak ? entry : best, board[0])

  return (
    <WorkspacePage>
      <PageHeader icon={UsersRound} title="Friends" description="See who’s studying, keep each other going.">
        <Button variant="outline" onClick={() => setDialog("profile")}><Settings2 />Profile & sharing</Button>
        <Button onClick={() => setDialog("add")}><UserPlus />Add friend</Button>
      </PageHeader>

      {loadError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4 text-sm">
        <p>{fetchedAt ? "Could not refresh friends. Showing the last available activity." : "Could not load friends. Check your connection and try again."}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
      </div> : null}

      {requests.length ? <Panel flush id="friend-requests" icon={UserPlus} title={`Requests${incoming ? ` · ${incoming} to answer` : ""}`}>
        <ul className="divide-y">
          {requests.map((person) => <li key={person.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm sm:px-5">
            <PersonAvatar person={person} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{personName(person)}</span><span className="block truncate text-xs text-muted-foreground">@{person.username} · {person.status === "incoming" ? "wants to be friends" : "request sent"}</span></span>
            <div className="flex gap-2">
              {person.status === "incoming" ? <Button size="sm" disabled={!!pending} aria-label={`Accept ${personName(person)}'s friend request`} onClick={() => void call("friends_accept", { p_user_id: person.user_id }, "Could not accept the request.").then((ok) => { if (ok) toast.success("Friend request accepted") })}>Accept</Button> : null}
              <Button size="sm" variant="outline" disabled={!!pending} aria-label={`${person.status === "incoming" ? "Decline" : "Cancel"} ${personName(person)}'s friend request`} onClick={() => void call("friends_remove", { p_user_id: person.user_id }, "Could not update the request.").then((ok) => { if (ok) toast.success(person.status === "incoming" ? "Request declined" : "Request cancelled") })}>{person.status === "incoming" ? "Decline" : "Cancel"}</Button>
              {person.status === "incoming" ? <Button size="sm" variant="ghost" disabled={!!pending} aria-label={`Block ${personName(person)}`} onClick={() => void call("friends_block", { p_user_id: person.user_id }, "Could not block this person.").then((ok) => { if (ok) toast.success("Blocked") })}>Block</Button> : null}
            </div>
          </li>)}
        </ul>
      </Panel> : null}

      <div className="grid min-w-0 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="focal-section-title">Overview</h2>
          <div className="flex flex-wrap items-center gap-3">
          {groups.length ? <Select value={group?.id ?? "all"} onValueChange={(value) => { if (value) setGroupId(value) }}>
            <SelectTrigger aria-label="Filter by group"><SelectValue>{group?.name ?? "Everyone"}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="all">Everyone</SelectItem>{groups.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent>
          </Select> : null}
          <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)}>
            <TabsList aria-label="Period">{(Object.keys(PERIOD_LABEL) as Period[]).map((key) => <TabsTrigger key={key} value={key}>{PERIOD_LABEL[key]}</TabsTrigger>)}</TabsList>
          </Tabs>
          </div>
        </div>
        {loading ? <StatGrid className={TILE_GRID}>{[0, 1, 2, 3, 4, 5].map((index) => <Skeleton key={index} className="h-28 motion-reduce:animate-none" />)}</StatGrid> : me ? <StatGrid className={TILE_GRID}>
          <StatTile icon={Radio} tone={studying.length ? "success" : "default"} label="Studying now" value={<>{studying.length}<span className="text-base font-medium text-muted-foreground"> / {board.length}</span></>} hint={studying.map(({ person }) => person.status === "me" ? "You" : personName(person)).join(", ") || "No one right now"} />
          <StatTile icon={Trophy} label={`Your rank · ${PERIOD_LABEL[period].toLowerCase()}`} value={<>#{me.rank}<span className="text-base font-medium text-muted-foreground"> of {board.length}</span></>} hint={standing ? standing[0].toUpperCase() + standing.slice(1) : "Add a friend to compete"} />
          <StatTile icon={Clock} label="Your study time" value={duration(mine)} delta={period !== "today" && previous >= 60_000 ? <Delta value={Math.round((mine - previous) / previous * 100)} suffix="%" /> : undefined}
            hint={period === "today" ? `Yesterday: ${duration(previous)}` : period === "quarter" ? `${duration(mine / days)} a day on average` : `Before that: ${duration(previous)}`}
            spark={mine ? Array.from({ length: sparkDays }, (_, index) => me.stats.day(sparkDays - 1 - index)) : undefined} onClick={() => setSelectedId(me.person.user_id)} />
          <StatTile icon={UsersRound} label="Friends’ average" value={others.length ? duration(friendsAverage) : "—"} hint={!others.length ? "Add a friend to compare" : Math.abs(mine - friendsAverage) < 60_000 ? "You’re level with it" : `You’re ${duration(Math.abs(mine - friendsAverage))} ${mine > friendsAverage ? "ahead" : "behind"}`} />
          <StatTile icon={Flame} tone={me.stats.streak ? "warning" : "default"} label="Your streak" value={`${me.stats.streak}d`} hint={!topStreak.stats.streak ? "Study today to start one" : me.stats.streak >= topStreak.stats.streak ? "Longest on the list" : `${personName(topStreak.person)} leads with ${topStreak.stats.streak}d`} />
          <StatTile icon={Sigma} label="Combined time" value={duration(combined)} hint={`${board.filter(({ score }) => score > 0).length} of ${board.length} studied`}
            spark={combined ? Array.from({ length: sparkDays }, (_, index) => board.reduce((sum, { stats }) => sum + stats.day(sparkDays - 1 - index), 0)) : undefined} />
        </StatGrid> : null}
      </div>

      {userId ? <FriendStudySessions userId={userId} sessions={sessions} friends={friends.map((person) => ({ id: person.user_id, name: personName(person), studying: !!person.studying_since }))} onOpenTimer={onJoin} /> : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel flush id="friends-board" icon={Trophy} title="Leaderboard" description={period === "today" ? "Study time today" : `Study time over the last ${PERIOD_LABEL[period]}`} className="self-start">
          {loading ? <div role="status" className="grid gap-2 p-4"><span className="sr-only">Loading friends</span>{[0, 1, 2].map((index) => <Skeleton key={index} className="h-14 motion-reduce:animate-none" />)}</div> : null}
          {board.length ? <ol className="min-w-0 divide-y">
            {board.map(({ person, stats, rank }) => {
              const isMe = person.status === "me"
              const done = cheered(person.user_id)
              return <li key={person.user_id} className="flex min-w-0 items-center gap-2 px-2 py-1 sm:gap-4 sm:px-3">
                <Button variant="ghost" onClick={() => setSelectedId(person.user_id)} aria-label={`${isMe ? "You" : personName(person)}, rank ${rank}, ${duration(stats.period[period])} ${period === "today" ? "today" : `in the last ${PERIOD_DAYS[period]} days`}. Open details`} className="h-auto min-w-0 flex-1 justify-start gap-3 px-1 py-2 text-left font-normal sm:px-2">
                  <span className={cn("w-5 shrink-0 text-center text-sm tabular-nums", rank === 1 && stats.period[period] >= 60_000 ? "font-semibold text-primary" : "text-muted-foreground")}>{rank}</span>
                  <PersonAvatar person={person} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{personName(person)}{isMe ? <span className="text-muted-foreground"> (you)</span> : null}</span>
                      {stats.streak > 1 ? <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" title={`${stats.streak}-day streak`}><Flame className="size-3" />{stats.streak}</span> : null}
                    </span>
                    <span className={cn("block truncate text-xs", person.studying_since ? "text-primary" : "text-muted-foreground")}>{person.studying_since
                      ? `${person.studying_kind === "exam" ? "Sitting an exam" : person.studying_subject ? `Studying ${subjectName(person.studying_subject)}` : "Studying"} · ${clock(stats.session)}`
                      : person.status_message || `@${person.username}`}</span>
                  </span>
                </Button>
                <div className="hidden w-44 shrink-0 md:block 2xl:w-72">{period === "today"
                  ? <div role="group" aria-label={`${personName(person)}: ${duration(stats.period.today)} studied today`}><DayTrack blocks={person.today_blocks} now={now} color={colorOf(person.user_id)} /></div>
                  : <PeriodBars day={stats.day} days={PERIOD_DAYS[period]} />}</div>
                <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">{duration(stats.period[period])}</span>
                {isMe ? <span className="w-9 shrink-0" /> : <Button variant="ghost" size="icon" disabled={cheerOff || done} title={done ? "Cheered · one cheer per friend every 24 hours" : `Cheer ${personName(person)}`} aria-label={done ? `Already cheered ${personName(person)}` : `Cheer ${personName(person)}`} onClick={() => void cheerFriend(person)}>{done ? <Check /> : <HeartHandshake />}</Button>}
              </li>
            })}
          </ol> : null}
          {period === "today" && board.length ? <div className="hidden items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground md:flex" aria-hidden>
            <span className="flex-1" /><span className="flex w-44 justify-between 2xl:w-72"><span>12am</span><span>12pm</span><span>12am</span></span><span className="w-16" /><span className="w-9" />
          </div> : null}
          {fetchedAt && !friends.length ? <div className="grid justify-items-start gap-2 p-4 sm:px-5"><p className="text-sm text-muted-foreground">It’s just you so far. Add a friend to see who’s studying and compare your time.</p><Button variant="outline" size="sm" onClick={() => setDialog("add")}><UserPlus />Add friend</Button></div> : null}
        </Panel>

        <aside className="grid min-w-0 content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Panel id="friends-cheers" icon={HeartHandshake} title="Cheers" action={
          <Select value={cheerMessage} onValueChange={(value) => { if (value) setCheerMessage(value) }}>
            <SelectTrigger size="sm" aria-label="Message sent with your cheers"><SelectValue>{cheerMessage === "none" ? "No message" : cheerMessage}</SelectValue></SelectTrigger>
            <SelectContent>{CHEER_MESSAGES.map((message) => <SelectItem key={message} value={message}>{message}</SelectItem>)}<SelectItem value="none">No message</SelectItem></SelectContent>
          </Select>
          }>
            <div className="grid gap-3">
              {cheersError ? <div role="alert" className="grid justify-items-start gap-2 text-sm"><p>Cheers are unavailable.</p><Button variant="outline" size="sm" onClick={() => void loadCheers()}>Retry</Button></div>
                : !cheersLoaded ? <Skeleton className="h-10 motion-reduce:animate-none" />
                : receivedCheers.length ? receivedCheers.map((cheer) => <div key={cheer.sender_id} className="flex min-w-0 items-center gap-3 text-sm">
                  <div className="min-w-0 flex-1"><p><span className="font-medium break-words">{cheer.sender_name}</span> cheered you on{cheer.message ? <>: “{cheer.message}”</> : null}</p><time className="text-xs text-muted-foreground" dateTime={cheer.created_at} title={format(new Date(cheer.created_at), "d MMM yyyy, h:mmaaa")}>{formatDistanceToNow(new Date(cheer.created_at), { addSuffix: true })}</time></div>
                  <Button variant="outline" size="sm" disabled={cheerOff || cheered(cheer.sender_id)} onClick={() => { const friend = friends.find((person) => person.user_id === cheer.sender_id); if (friend) void cheerFriend(friend) }}>{cheered(cheer.sender_id) ? "Cheered" : "Cheer back"}</Button>
                </div>) : <p className="text-sm text-muted-foreground">No cheers this week. Send one from the list, once per friend a day.</p>}
            </div>
          </Panel>

          <Panel id="friends-groups" icon={UsersRound} title="Groups" action={<Button size="sm" variant="outline" disabled={!me} onClick={() => setEditing({ id: null, name: "", hours: "", members: [] })}><Plus />New group</Button>}>
            <div className="grid gap-3">
              {groups.length ? groups.map((entry) => {
                const members = entry.members.filter((id) => people.some((person) => person.user_id === id && (person.status === "me" || person.status === "friend")))
                const total = members.reduce((sum, id) => sum + weekOf(id), 0)
                const goal = entry.goal_minutes * 60_000
                return <div key={entry.id} className="grid gap-1.5 text-sm">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" aria-pressed={group?.id === entry.id} className="min-w-0 flex-1 justify-start truncate px-1 font-medium" onClick={() => setGroupId(group?.id === entry.id ? "all" : entry.id)} title="Show only this group in the list">{entry.name}{group?.id === entry.id ? " · showing" : ""}</Button>
                    {entry.owner_id === me?.person.user_id ? <>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${entry.name}`} onClick={() => setEditing({ id: entry.id, name: entry.name, hours: entry.goal_minutes ? String(entry.goal_minutes / 60) : "", members: entry.members.filter((id) => id !== entry.owner_id) })}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${entry.name}`} disabled={!!pending} onClick={() => setDeletingGroup(entry)}><Trash2 /></Button>
                    </> : null}
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${entry.name}: ${duration(total)}${goal ? ` of ${duration(goal)} goal` : ""} in the last 7 days`}>
                    {members.map((id) => <span key={id} title={`${nameOf(id)}: ${duration(weekOf(id))}`} style={{ width: `${weekOf(id) / Math.max(goal, total, 1) * 100}%`, background: colorOf(id) }} />)}
                  </div>
                  <p className="text-xs text-muted-foreground">{members.length} {members.length === 1 ? "member" : "members"} · {duration(total)}{goal ? ` of ${duration(goal)}` : ""} in 7 days{goal && total >= goal ? " · goal reached" : ""}</p>
                </div>
              }) : <p className="text-sm text-muted-foreground">Group a class or study squad and set a shared weekly goal.</p>}
            </div>
          </Panel>

          {exams.length ? <Panel id="friends-exams" icon={CalendarClock} title="Upcoming exams">
            <div className="grid gap-3">
              {exams.map((entry, index) => {
                const days = Math.max(0, differenceInCalendarDays(new Date(entry.starts), now))
                return <div key={index} className="flex min-w-0 items-start gap-2 text-sm">
                  <span className="min-w-0 flex-1 break-words"><span className="font-medium">{nameOf(entry.user_id)}</span> · {entry.title}</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground" title={format(new Date(entry.starts), "EEE d MMM, h:mmaaa")}>{days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}</span>
                </div>
              })}
            </div>
          </Panel> : null}
        </aside>
      </div>

      {insightRows.length ? <FriendsInsights rows={insightRows} days={days} at={minute * 60_000} scope={group?.name ?? "Everyone"} /> : null}

      {selected ? <FriendSheet key={selected.person.user_id} person={selected.person} stats={selected.stats} me={me} period={period} onPeriodChange={setPeriod} now={now} cheered={cheered(selected.person.user_id)} pending={pending} onSaveNickname={(nickname) => call("friends_set_nickname", { p_user_id: selected.person.user_id, p_nickname: nickname }, "Could not save this nickname.")} cheerDisabled={cheerOff} onCheer={() => void cheerFriend(selected.person)} onClose={() => { setSelectedId(null); setRemoving(false) }} onRemove={() => setRemoving(true)} /> : null}

      <Dialog open={dialog === "add"} onOpenChange={(open) => { if (!pending && !open) { setDialog(null); setManualCopy(null) } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a friend</DialogTitle><DialogDescription>Connect by @username. Study activity is shared only once you are friends.</DialogDescription></DialogHeader>
          <form className="grid gap-2" onSubmit={(event) => {
            event.preventDefault()
            const username = friendUsername.trim().replace(/^@/, "").toLowerCase()
            if (!/^[a-z0-9_]{3,24}$/.test(username)) { toast.error("Enter a username with 3–24 letters, numbers or underscores."); return }
            if (username === profile?.username) { toast.error("That is your username. Share it with a friend instead."); return }
            void call("friends_add", { p_username: username }, "Could not add that friend.").then((ok) => { if (ok) { setFriendUsername(""); setDialog(null); setManualCopy(null); toast.success(cache.people.some((person) => person.username === username && person.status === "outgoing") ? "Friend request sent" : "Friend added") } })
          }}>
            <Label htmlFor="friend-username" className="text-sm font-medium">Their username</Label>
            <div className="flex gap-2">
              <Input id="friend-username" autoFocus value={friendUsername} onChange={(event) => setFriendUsername(event.target.value)} placeholder="@username" maxLength={25} autoCapitalize="none" autoComplete="off" spellCheck={false} required disabled={!!pending} className="min-w-0" />
              <Button type="submit" disabled={!!pending || !friendUsername.trim()}>{pending === "friends_add" ? "Adding…" : "Add"}</Button>
            </div>
          </form>
          <div className="grid gap-2 border-t pt-4">
            <p className="text-sm font-medium">Or share yours</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!profile} onClick={() => copy(`@${profile?.username}`, "Username copied")} aria-label={profile ? `Copy your username @${profile.username}` : "Copy username"}><Copy /><span className="max-w-40 truncate">{profile ? `@${profile.username}` : "Username"}</span></Button>
              <Button variant="outline" disabled={!profile} onClick={() => { const url = `${INVITE_BASE}/?view=friends&add=${profile?.username}`; if (matchMedia("(pointer: coarse)").matches && navigator.share) { void navigator.share({ title: "Study with me on Focal", url }).catch(() => undefined); return } copy(url, "Invite link copied") }}><Link2 />Copy invite link</Button>
            </div>
            {manualCopy ? <Input readOnly aria-label="Text to copy manually" value={manualCopy} onFocus={(event) => event.currentTarget.select()} /> : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "profile"} onOpenChange={(open) => { if (!pending && !open) setDialog(null) }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Profile & sharing</DialogTitle><DialogDescription>Friends see your name, status, live study, study time and consistency. Requests see nothing, and your email is never shown.</DialogDescription></DialogHeader>
          {profileError ? <div role="alert" className="grid justify-items-start gap-2 text-sm"><p>Could not load your profile.</p><Button variant="outline" size="sm" onClick={() => void loadProfile()}>Try again</Button></div> : null}
          <fieldset disabled={!profile || !!pending} className="grid min-w-0 gap-4">
            <form className="grid gap-3" onSubmit={(event) => {
              event.preventDefault()
              const username = draft.username.trim().replace(/^@/, "").toLowerCase()
              if (!/^[a-z0-9_]{3,24}$/.test(username)) { toast.error("Use 3–24 letters, numbers or underscores for your username."); return }
              if (profile) void saveProfile({ ...profile, username, display_name: draft.name.trim(), status_message: draft.status.trim() })
            }}>
              <Label className="grid gap-2 text-sm font-medium">Username<Input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} placeholder="@username" maxLength={25} autoCapitalize="none" autoComplete="off" spellCheck={false} aria-describedby="username-help" required /></Label>
              <p id="username-help" className="-mt-1 text-xs text-muted-foreground">3–24 letters, numbers or underscores.</p>
              <Label className="grid gap-2 text-sm font-medium">Display name (optional)<Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="How friends see you" maxLength={40} /></Label>
              <Label className="grid gap-2 text-sm font-medium">Status (optional)<Input value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} placeholder="e.g. Revising for Methods" maxLength={60} /></Label>
              <Button type="submit" variant="outline" className="justify-self-start" disabled={!profile || !draft.username.trim() || (draft.username.trim().replace(/^@/, "").toLowerCase() === profile.username && draft.name.trim() === profile.display_name && draft.status.trim() === profile.status_message)}>{pending === "friends_update_profile" ? "Saving…" : "Save profile"}</Button>
            </form>
            <div className="grid gap-3 border-t pt-4">
              {([["share_subjects", "Share live subjects and subject study totals", true], ["share_exams", "Share recent exam scores, paper titles and upcoming exam dates", false], ["require_requests", "Require my approval when someone adds me", false]] as const).map(([key, label, fallback]) => <Label key={key} className="flex items-start gap-2 text-sm">
                <Checkbox checked={profile?.[key] ?? fallback} onCheckedChange={(checked) => { if (profile) void saveProfile({ ...profile, [key]: checked }) }} />{label}
              </Label>)}
            </div>
            {blocked.length ? <section aria-label="Blocked people" className="grid gap-3 border-t pt-4">
              <h3 className="text-sm font-medium">Blocked people</h3>
              {blocked.map((person) => {
                const name = person.display_name || (person.username ? `@${person.username}` : "Deleted account")
                return <div key={person.user_id} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <Button size="sm" variant="outline" disabled={!!pending} aria-label={`Unblock ${name}`} onClick={() => void call("friends_unblock", { p_user_id: person.user_id }, "Could not unblock this person.").then((ok) => { if (ok) toast.success("Unblocked") })}>Unblock</Button>
                </div>
              })}
            </section> : null}
          </fieldset>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!pending && !open) setEditing(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit group" : "New group"}</DialogTitle><DialogDescription>Pick friends and, optionally, a weekly goal for the whole group.</DialogDescription></DialogHeader>
          {editing ? <form id="group-form" onSubmit={(event) => { event.preventDefault(); void saveGroup() }}><fieldset disabled={!!pending} className="grid min-w-0 gap-3">
            <Label className="grid gap-2 text-sm font-medium">Name<Input value={editing.name} maxLength={40} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="e.g. Methods squad" /></Label>
            <Label className="grid gap-2 text-sm font-medium">Weekly goal in hours (optional)<Input type="number" min={0} max={168} step={0.5} value={editing.hours} onChange={(event) => setEditing({ ...editing, hours: event.target.value })} placeholder="e.g. 20" /></Label>
            <fieldset className="grid max-h-48 gap-2 overflow-y-auto">
              <legend className="mb-1 text-sm font-medium">Friends</legend>
              {friends.map((person) => <Label key={person.user_id} className="flex items-center gap-2 text-sm">
                <Checkbox disabled={!!pending} checked={editing.members.includes(person.user_id)} onCheckedChange={(checked) => setEditing({ ...editing, members: checked ? [...editing.members, person.user_id] : editing.members.filter((id) => id !== person.user_id) })} />
                {personName(person)}
              </Label>)}
              {!friends.length ? <p className="text-sm text-muted-foreground">Add a friend first.</p> : null}
            </fieldset>
          </fieldset></form> : null}
          <DialogFooter><Button variant="outline" disabled={!!pending} onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="group-form" disabled={!!pending || !editing?.name.trim()}>{pending === "friends_group_save" ? "Saving…" : "Save group"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingGroup} onOpenChange={(open) => { if (!pending && !open) setDeletingGroup(null) }}>
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>Delete {deletingGroup?.name}?</DialogTitle>
            <DialogDescription>The group and its weekly goal are removed for everyone in it. Friends stay friends.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={!!pending} onClick={() => setDeletingGroup(null)}>Keep group</Button>
            <Button variant="destructive" disabled={!!pending} onClick={() => {
              if (!deletingGroup) return
              void call("friends_group_delete", { p_id: deletingGroup.id }, "Could not delete the group.").then((ok) => {
                if (ok) { setDeletingGroup(null); toast.success("Group deleted") }
              })
            }}>{pending === "friends_group_delete" ? "Deleting…" : "Delete group"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing && !!selected} onOpenChange={(open) => { if (!pending) setRemoving(open) }}>
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>Remove {selected ? personName(selected.person) : ""}?</DialogTitle>
            <DialogDescription>You will stop sharing study activity with each other. You can reconnect later with a new friend request.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={!!pending} onClick={() => setRemoving(false)}>Keep friend</Button>
            <Button variant="destructive" disabled={!!pending} onClick={() => {
              if (!selected) return
              void call("friends_remove", { p_user_id: selected.person.user_id }, "Could not remove this friend.").then((ok) => {
                if (ok) { setRemoving(false); setSelectedId(null); toast.success("Friend removed") }
              })
            }}>{pending === "friends_remove" ? "Removing…" : "Remove friend"}</Button>
            <Button variant="outline" disabled={!!pending} aria-label={`Block ${selected ? personName(selected.person) : "friend"}`} onClick={() => {
              if (!selected) return
              void call("friends_block", { p_user_id: selected.person.user_id }, "Could not block this person.").then((ok) => {
                if (ok) { setRemoving(false); setSelectedId(null); toast.success("Blocked") }
              })
            }}>{pending === "friends_block" ? "Blocking…" : "Block"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspacePage>
  )
}

function FriendSheet({ person, stats, me, period, onPeriodChange, now, cheered, pending, onSaveNickname, cheerDisabled, onCheer, onClose, onRemove }: {
  person: Person; stats: StudyStats; me: { person: Person; stats: StudyStats } | undefined; period: Period; now: Date
  onPeriodChange: (period: Period) => void; cheered: boolean; cheerDisabled: boolean; onCheer: () => void; onClose: () => void; onRemove: () => void
  pending: string | null; onSaveNickname: (nickname: string) => Promise<boolean>
}) {
  const [nickname, setNickname] = useState(person.nickname ?? "")
  const isMe = person.status === "me"
  // 12 Monday-first columns ending with this week; cells hold "days ago" (negative = later this week).
  const weekday = (now.getDay() + 6) % 7
  const weeks = Array.from({ length: 12 }, (_, week) => Array.from({ length: 7 }, (_, day) => (11 - week) * 7 + weekday - day))
  const best = Math.max(...Array.from({ length: 84 }, (_, offset) => stats.day(offset)))
  const subjects = Object.entries(person.subjects ?? {}).sort((a, b) => b[1] - a[1])
  const subjectTotal = subjects.reduce((sum, [, ms]) => sum + ms, 0) || 1
  const days = PERIOD_DAYS[period]
  const comparison = !isMe && me ? [
    { label: "Study time", mine: me.stats.period[period], theirs: stats.period[period], display: duration },
    { label: "Active days", mine: me.stats.activeDays(days), theirs: stats.activeDays(days), display: (value: number) => `${value}/${days}` },
    { label: "Daily average", mine: me.stats.period[period] / days, theirs: stats.period[period] / days, display: duration },
    { label: "Current streak", mine: me.stats.streak, theirs: stats.streak, display: (value: number) => `${value}d` },
  ] : []
  const comparedSubjects = !isMe && me && person.subjects != null ? [...new Set([...Object.keys(person.subjects), ...Object.keys(me.person.subjects ?? {})])]
    .sort((a, b) => ((person.subjects?.[b] ?? 0) + (me.person.subjects?.[b] ?? 0)) - ((person.subjects?.[a] ?? 0) + (me.person.subjects?.[a] ?? 0))) : []

  const chartSeries = [
    ...(!isMe && me ? [{ id: me.person.user_id, name: "You", day: me.stats.day, className: "bg-muted-foreground/50" }] : []),
    { id: person.user_id, name: isMe ? "You" : personName(person), day: stats.day, className: "bg-primary" },
  ]

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <PersonAvatar person={person} className="size-11 text-base" />
            <div className="min-w-0">
              <SheetTitle className="break-words">{isMe ? "You" : personName(person)}</SheetTitle>
              <p className="break-all text-sm text-muted-foreground">@{person.username}{person.nickname ? ` · ${person.display_name}` : ""}</p>
              <SheetDescription>{person.studying_since ? `Studying now · ${clock(stats.session)}` : person.status_message || "Not studying right now"}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="grid gap-6 px-4 pb-6">
          {!isMe ? <form className="grid gap-2" onSubmit={(event) => {
            event.preventDefault()
            const value = nickname.trim()
            void onSaveNickname(value).then((ok) => { if (ok) { setNickname(value); toast.success(value ? "Nickname saved" : "Nickname removed") } })
          }}>
            <Label htmlFor="friend-nickname" className="text-sm font-medium">Nickname</Label>
            <div className="flex gap-2">
              <Input id="friend-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder={person.display_name} maxLength={40} disabled={!!pending} aria-describedby="nickname-help" className="min-w-0" />
              <Button type="submit" variant="outline" disabled={!!pending || nickname.trim() === (person.nickname ?? "")}>{pending === "friends_set_nickname" ? "Saving…" : "Save"}</Button>
            </div>
            <p id="nickname-help" className="text-xs text-muted-foreground">Only you see this nickname. Clear it and save to use their display name.</p>
          </form> : null}
          {!isMe ? <div className="grid justify-items-start gap-2"><Button variant="outline" disabled={cheerDisabled || cheered} onClick={onCheer}>{cheered ? <Check /> : <HeartHandshake />}{cheered ? "Cheered" : "Send a cheer"}</Button><p className="text-xs text-muted-foreground">One cheer per friend every 24 hours.</p></div> : null}

          {comparison.length ? <section className="grid min-w-0 gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Head to head</h3>
              <Tabs value={period} onValueChange={(value) => onPeriodChange(value as Period)}><TabsList aria-label="Comparison period">{(Object.keys(PERIOD_LABEL) as Period[]).map((key) => <TabsTrigger key={key} value={key}>{PERIOD_LABEL[key]}</TabsTrigger>)}</TabsList></Tabs>
            </div>
            <Table className="[&_td]:px-2 [&_th]:px-2">
              <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead className="text-right">You</TableHead><TableHead className="max-w-32 truncate text-right" title={personName(person)}>{personName(person)}</TableHead></TableRow></TableHeader>
              <TableBody>{comparison.map(({ label, mine, theirs, display }) => <TableRow key={label}>
                <TableCell>{label}</TableCell><TableCell className={cn("text-right", mine > theirs && "font-semibold text-primary")}>{display(mine)}{mine > theirs ? <span className="sr-only">, ahead</span> : null}</TableCell><TableCell className={cn("text-right", theirs > mine && "font-semibold text-primary")}>{display(theirs)}{theirs > mine ? <span className="sr-only">, ahead</span> : null}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">An active day has at least one minute of study. Daily averages include every day in the period; streaks are current.</p>
          </section> : null}

          <dl className="grid grid-cols-3 gap-2">
            {([["Today", duration(stats.period.today)], ["7 days", duration(stats.period.week)], ["30 days", duration(stats.period.month)], ["All time", duration(stats.total)], ["Streak", `${stats.streak}d`], ["Best day", duration(best)]] as const).map(([label, value]) => (
              <div key={label} className="rounded-lg border px-3 py-2">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-base font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">{isMe ? "Daily study · 30 days" : "Daily study · you vs " + personName(person)}</h3>
            <DailyChart now={now} series={chartSeries} />
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Typical week · 12 weeks</h3>
            <WeekdayChart now={now} series={chartSeries} />
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Today</h3>
            <DayTrack blocks={person.today_blocks} now={now} className="h-5" />
            <div className="flex justify-between text-xs text-muted-foreground" aria-hidden><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Last 12 weeks</h3>
            <div className="flex gap-[3px]" role="img" aria-label={`Study over the last 12 weeks: ${duration(stats.period.month)} in the last 30 days, best day ${duration(best)}.`}>
              {weeks.map((days, index) => (
                <div key={index} className="flex flex-1 flex-col gap-[3px]">
                  {days.map((offset) => offset < 0 || offset >= 84
                    ? <span key={offset} className="aspect-square" />
                    : <span key={offset} className="aspect-square rounded-[3px]" style={{ backgroundColor: getHeatColor(heatLevel(stats.day(offset))) }} title={`${format(subDays(now, offset), "EEE d MMM")}: ${duration(stats.day(offset))}`} />)}
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Subjects · 30 days</h3>
            {person.subjects == null ? <p className="text-sm text-muted-foreground">{personName(person)} keeps their subjects private.</p>
              : comparedSubjects.length ? <Table>
                <TableHeader><TableRow><TableHead>Subject</TableHead><TableHead className="text-right">You</TableHead><TableHead className="max-w-32 truncate text-right" title={personName(person)}>{personName(person)}</TableHead></TableRow></TableHeader>
                <TableBody>{comparedSubjects.map((id) => <TableRow key={id}><TableCell className="max-w-40 whitespace-normal">{subjectName(id || null)}</TableCell><TableCell className="text-right">{me?.person.subjects == null ? "—" : duration(me.person.subjects[id] ?? 0)}</TableCell><TableCell className="text-right">{duration(person.subjects?.[id] ?? 0)}</TableCell></TableRow>)}</TableBody>
              </Table>
              : subjects.length === 0 ? <p className="text-sm text-muted-foreground">No study in the last 30 days.</p>
              : <>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                  {subjects.map(([id, ms]) => <span key={id} style={{ width: `${ms / subjectTotal * 100}%`, backgroundColor: getSubjectColor(id) }} />)}
                </div>
                {subjects.map(([id, ms]) => (
                  <div key={id} className="flex items-center gap-2 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: getSubjectColor(id) }} />
                    <span className="min-w-0 flex-1 truncate">{subjectName(id || null)}</span>
                    <span className="tabular-nums text-muted-foreground">{duration(ms)} · {Math.round(ms / subjectTotal * 100)}%</span>
                  </div>
                ))}
              </>}
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Recent exams</h3>
            {!person.exams?.length ? <p className="text-sm text-muted-foreground">{person.exams || isMe ? "No exams logged yet." : `${personName(person)} doesn't share exam results.`}</p>
              : person.exams.map((exam, index) => {
                const score = percent(exam)
                const myExam = !isMe ? me?.person.exams?.find((candidate) => candidate.subject === exam.subject && candidate.rawMax === exam.rawMax && percent(candidate) != null && (
                  exam.referenceId ? candidate.referenceId === exam.referenceId
                    : exam.provider && exam.examYear && exam.paper && candidate.provider === exam.provider && candidate.examYear === exam.examYear && candidate.paper === exam.paper && candidate.title === exam.title
                )) : undefined
                const myScore = myExam ? percent(myExam) : null
                return (
                  <div key={index} className="grid gap-1">
                  <div className="grid grid-cols-[minmax(0,1fr)_5rem_2.5rem] items-center gap-3 text-sm">
                    <span className="min-w-0 truncate" title={`${exam.title ?? exam.subject ?? "Exam"}${exam.paper ? ` · ${exam.paper}` : ""}`}>{exam.title ?? exam.subject ?? "Exam"}{exam.paper ? ` · ${exam.paper}` : ""}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${score ?? 0}%` }} /></span>
                    <span className="text-right tabular-nums">{score == null ? "—" : `${score}%`}</span>
                  </div>
                  {myScore != null ? <p className="text-xs text-muted-foreground">You: {myScore}% on the same paper{score != null ? ` · ${score === myScore ? "tied" : `${Math.abs(score - myScore)} percentage points ${myScore > score ? "ahead" : "behind"}`}` : ""}</p> : null}
                  </div>
                )
              })}
          </section>

          {isMe ? null : <Button variant="outline" className="justify-self-start" onClick={onRemove}>Remove friend</Button>}
        </div>
      </SheetContent>
    </Sheet>
  )
}
