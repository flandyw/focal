import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy, Flame, HeartHandshake, RefreshCw, Search, Trophy, UserPlus } from "lucide-react"
import { format, formatDistanceToNow, subDays } from "date-fns"
import { toast } from "sonner"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Skeleton } from "./ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { PageHeader } from "./page-header"
import { MetricCard, MetricGrid, WorkspacePage } from "./workspace-layout"
import { useTickingNow } from "../hooks/use-ticking-now"
import { getHeatColor, getSubjectColor } from "../lib/progress-chart-theme"
import { getSubjectById } from "../lib/progress-utils"
import { supabase } from "../lib/supabase"
import { cn } from "../lib/utils"
import { Avatar, AvatarBadge, AvatarFallback } from "./ui/avatar"
import { Checkbox } from "./ui/checkbox"
import { Label } from "./ui/label"

type SharedExam = { subject: string | null; title: string | null; provider: string | null; examYear: number | null; paper: string | null; referenceId: string | null; rawScore: number | null; rawMax: number | null; completedAt: string | null }
type Person = {
  user_id: string
  display_name: string
  status_message: string
  status: "me" | "friend" | "incoming" | "outgoing"
  studying_since: string | null
  studying_subject: string | null
  studying_kind: string | null
  total_ms: number
  daily: Record<string, number> | null
  today_blocks: [string, string | null][] | null
  subjects: Record<string, number> | null
  exams: SharedExam[] | null
}
type Profile = { code: string; display_name: string; status_message: string; share_exams: boolean; share_subjects: boolean }
type Period = "today" | "week" | "month"
type Ranking = "time" | "days"
type Cheer = { sender_id: string; recipient_id: string; sender_name: string; created_at: string }
type StudyStats = ReturnType<typeof activity>

const PERIOD_LABEL: Record<Period, string> = { today: "Today", week: "7 days", month: "30 days" }
const PERIOD_DAYS: Record<Period, number> = { today: 1, week: 7, month: 30 }
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

const duration = (ms: number) => ms < 60_000 ? "0m" : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms / 60_000) % 60}m`
const clock = (ms: number) => [Math.floor(ms / 3_600_000), Math.floor(ms / 60_000) % 60, Math.floor(ms / 1000) % 60].map((n) => String(n).padStart(2, "0")).join(":")
const dayKey = (date: Date) => format(date, "yyyy-MM-dd")
const subjectName = (id: string | null) => getSubjectById(id ?? undefined)?.name ?? "General study"
const percent = (exam: SharedExam) => exam.rawScore != null && exam.rawMax ? Math.round(exam.rawScore / exam.rawMax * 100) : null
const heatLevel = (ms: number) => (ms <= 0 ? 0 : ms < 3_600_000 ? 1 : ms < 7_200_000 ? 2 : ms < 14_400_000 ? 3 : 4) as 0 | 1 | 2 | 3 | 4

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
    period: { today: day(0), week: sum(7), month: sum(30) } as Record<Period, number>,
    activeDays: (days: number) => Array.from({ length: days }, (_, offset) => day(offset)).filter((ms) => ms >= 60_000).length,
    total: person.total_ms + live,
    session: person.studying_since ? Math.max(0, now.getTime() - new Date(person.studying_since).getTime()) : 0,
  }
}

function PersonAvatar({ person, className }: { person: Person; className?: string }) {
  return (
    <Avatar className={cn("size-9 text-sm font-medium", className)} aria-hidden>
      <AvatarFallback className="text-[length:inherit]">{person.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
      {person.studying_since ? <AvatarBadge /> : null}
    </Avatar>
  )
}

/** One 24-hour track; blocks are today's study, the open one runs to now. */
function DayTrack({ blocks, now, className }: { blocks: Person["today_blocks"]; now: Date; className?: string }) {
  const start = new Date(now).setHours(0, 0, 0, 0)
  const end = new Date(now).setHours(24, 0, 0, 0)
  const at = (iso: string | null) => Math.min(100, Math.max(0, ((iso ? new Date(iso).getTime() : now.getTime()) - start) / (end - start) * 100))
  return (
    <div className={cn("relative h-3 overflow-hidden rounded-sm bg-muted", className)}>
      {[25, 50, 75].map((left) => <span key={left} className="absolute inset-y-0 w-px bg-border" style={{ left: `${left}%` }} />)}
      {(blocks ?? []).map(([from, to], index) => (
        <span key={index} className={cn("absolute inset-y-0 rounded-[2px] bg-primary", !to && "motion-safe:animate-pulse")} style={{ left: `${at(from)}%`, width: `max(2px, ${at(to) - at(from)}%)` }} />
      ))}
    </div>
  )
}

function WeekBars({ day }: { day: (offset: number) => number }) {
  const values = Array.from({ length: 7 }, (_, index) => day(6 - index))
  const max = Math.max(...values, 3_600_000)
  return (
    <div className="flex h-6 items-end gap-0.5" aria-hidden>
      {values.map((value, index) => <span key={index} className={cn("w-1.5 rounded-t-[2px]", value ? "bg-primary/70" : "bg-muted")} style={{ height: `${Math.max(8, value / max * 100)}%` }} />)}
    </div>
  )
}

export function FriendsPage({ signedIn, onSignIn }: { signedIn: boolean; onSignIn: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [draft, setDraft] = useState({ name: "", status: "" })
  const [people, setPeople] = useState<Person[]>([])
  const [fetchedAt, setFetchedAt] = useState(0)
  const [code, setCode] = useState("")
  const [period, setPeriod] = useState<Period>("today")
  const [ranking, setRanking] = useState<Ranking>("time")
  const [cheers, setCheers] = useState<Cheer[]>([])
  const [cheersError, setCheersError] = useState(false)
  const [cheersLoaded, setCheersLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [liveOnly, setLiveOnly] = useState(false)
  const [refreshing, setRefreshing] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [profileError, setProfileError] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const actionInFlight = useRef(false)
  const loadSequence = useRef(0)
  const poll = useTickingNow(30_000)
  const now = useTickingNow(1_000)

  const loadCheers = useCallback(async () => {
    try {
      const { data, error } = await supabase!.rpc("friends_cheers")
      if (error) throw error
      setCheers((data ?? []) as Cheer[])
      setCheersError(false)
      setCheersLoaded(true)
    } catch {
      setCheersError(true)
    }
  }, [])

  const load = useCallback(async () => {
    if (!signedIn) return
    const sequence = ++loadSequence.current
    setRefreshing(true)
    try {
      const { data, error } = await supabase!.rpc("friends_list", { p_tz: TIME_ZONE })
      if (sequence !== loadSequence.current) return
      if (error) throw error
      setPeople((data ?? []) as Person[])
      setFetchedAt(Date.now())
      setLoadError(false)
    } catch {
      if (sequence === loadSequence.current) setLoadError(true)
    } finally {
      if (sequence === loadSequence.current) setRefreshing(false)
    }
  }, [signedIn])

  const loadProfile = useCallback(async () => {
    try {
      const { data, error } = await supabase!.rpc("friends_me").single<Profile>()
      if (error) throw error
      setProfileError(false)
      setProfile(data)
      setDraft({ name: data.display_name, status: data.status_message })
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
  useEffect(() => { void load(); if (signedIn) void loadCheers() }, [load, loadCheers, signedIn, poll])

  async function call(fn: string, args: Record<string, unknown>, failure: string) {
    if (actionInFlight.current) return false
    actionInFlight.current = true
    setPending(fn)
    try {
      const { error } = await supabase!.rpc(fn, args)
      if (error) { toast.error(error.message || failure); return false }
      await load()
      await loadCheers()
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
    const args = { p_display_name: next.display_name, p_status_message: next.status_message, p_share_exams: next.share_exams, p_share_subjects: next.share_subjects }
    if (await call("friends_update_profile", args, "Could not save your profile.")) {
      setProfile(next)
      toast.success("Profile updated")
    }
  }

  const board = useMemo(() => {
    const rows = people.filter((person) => person.status === "me" || person.status === "friend").map((person) => {
      const stats = activity(person, now, fetchedAt)
      return { person, stats, score: ranking === "time" ? Math.floor(stats.period[period] / 60_000) : stats.activeDays(PERIOD_DAYS[period]), rank: 0 }
    }).sort((a, b) => b.score - a.score || a.person.display_name.localeCompare(b.person.display_name) || a.person.user_id.localeCompare(b.person.user_id))
    for (let index = 0; index < rows.length; index++) {
      const previous = rows[index - 1]
      rows[index].rank = previous?.score === rows[index].score ? previous.rank : index + 1
    }
    return rows
  }, [people, now, fetchedAt, period, ranking])

  if (!signedIn) {
    return (
      <WorkspacePage>
        <PageHeader title="Friends" />
        <div><Button onClick={onSignIn}>Sign in to add friends</Button></div>
      </WorkspacePage>
    )
  }

  const incoming = people.filter((person) => person.status === "incoming")
  const outgoing = people.filter((person) => person.status === "outgoing")
  const studying = board.filter(({ person }) => person.studying_since)
  const leader = Math.max(board[0]?.score ?? 0, 1)
  const me = board.find(({ person }) => person.status === "me")
  const nextRival = me ? board.findLast((entry) => entry.score > me.score) : undefined
  const selected = board.find(({ person }) => person.user_id === selectedId)
  const visibleBoard = board.filter(({ person }) =>
    (!liveOnly || person.studying_since) && `${person.display_name} ${person.status === "me" ? "you" : ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const loading = !fetchedAt && !loadError
  const receivedCheers = cheers.filter((cheer) => cheer.recipient_id === me?.person.user_id && board.some(({ person }) => person.status === "friend" && person.user_id === cheer.sender_id))
  const cheered = (id: string) => cheers.some((cheer) => cheer.sender_id === me?.person.user_id && cheer.recipient_id === id && now.getTime() - new Date(cheer.created_at).getTime() < 86_400_000)
  const cheerFriend = async (person: Person) => {
    if (person.status !== "friend" || cheered(person.user_id)) return
    if (await call("friends_cheer", { p_user_id: person.user_id }, "Could not send your cheer. Try again.")) toast.success(`Cheer sent to ${person.display_name}`)
  }
  const gapLabel = (score: number) => ranking === "time" ? duration(score * 60_000) : `${score} active ${score === 1 ? "day" : "days"}`
  const copyCode = async () => {
    if (!profile) return
    try {
      await navigator.clipboard.writeText(profile.code)
      toast.success("Friend code copied")
    } catch {
      toast.error("Could not copy your code. Select it below and copy it manually.")
    }
  }

  return (
    <WorkspacePage>
      <PageHeader title="Friends">
        <Button variant="outline" onClick={() => { void load(); void loadCheers() }} disabled={refreshing}><RefreshCw className={cn(refreshing && "motion-safe:animate-spin")} />Refresh</Button>
        <Button variant="outline" onClick={() => void copyCode()} disabled={!profile}><Copy />Copy code <span className="font-mono tracking-wider">{profile?.code ?? "…"}</span></Button>
        <Button onClick={() => document.getElementById("friend-code")?.focus()}><UserPlus />Add friend</Button>
      </PageHeader>

      {loadError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4 text-sm">
        <p>{fetchedAt ? "Could not refresh friends. Showing the last available activity." : "Could not load friends. Check your connection and try again."}</p>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}>Try again</Button>
      </div> : null}

      {incoming.length || outgoing.length ? <section aria-label="Friend requests" className="grid gap-4 rounded-xl border p-4 sm:p-5">
        <h2 className="text-base font-medium">Friend requests <span className="text-muted-foreground">({incoming.length + outgoing.length})</span></h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {([incoming, outgoing] as const).map((requests, index) => requests.length ? <div key={index} className="grid content-start gap-3">
            <h3 className="text-sm text-muted-foreground">{index === 0 ? "Received" : "Sent"} · {requests.length}</h3>
            {requests.map((person) => <div key={person.user_id} className="flex flex-wrap items-center gap-3 text-sm">
              <PersonAvatar person={person} className="size-8 text-xs" />
              <span className="min-w-0 flex-1 truncate" title={person.display_name}>{person.display_name}</span>
              <div className="flex gap-2">
                {person.status === "incoming" ? <Button size="sm" disabled={!!pending} aria-label={`Accept ${person.display_name}'s friend request`} onClick={() => void call("friends_accept", { p_user_id: person.user_id }, "Could not accept the request.").then((ok) => { if (ok) toast.success("Friend request accepted") })}>Accept</Button> : null}
                <Button size="sm" variant="outline" disabled={!!pending} aria-label={`${person.status === "incoming" ? "Decline" : "Cancel"} ${person.display_name}'s friend request`} onClick={() => void call("friends_remove", { p_user_id: person.user_id }, "Could not update the request.").then((ok) => { if (ok) toast.success(person.status === "incoming" ? "Request declined" : "Request cancelled") })}>{person.status === "incoming" ? "Decline" : "Cancel"}</Button>
              </div>
            </div>)}
          </div> : null)}
        </div>
      </section> : null}

      <MetricGrid className="sm:grid-cols-4">
        <MetricCard label="Studying now" value={fetchedAt ? `${studying.length} / ${board.length}` : "—"} />
        <MetricCard label="Group today" value={fetchedAt ? duration(board.reduce((sum, { stats }) => sum + stats.period.today, 0)) : "—"} />
        <MetricCard label={`Your rank · ${ranking === "time" ? "time" : "active days"} · ${PERIOD_LABEL[period]}`} value={me ? `#${me.rank}` : "—"} />
        <MetricCard label="Your streak" value={fetchedAt ? `${board.find(({ person }) => person.status === "me")?.stats.streak ?? 0}d` : "—"} />
      </MetricGrid>

      {studying.length ? (
        <section aria-label="Studying now" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {studying.map(({ person, stats }) => (
            <Button key={person.user_id} variant="ghost" onClick={() => setSelectedId(person.user_id)} className="h-auto min-w-0 justify-start gap-3 rounded-xl border-primary/40 bg-primary/5 p-3 text-left font-normal whitespace-normal hover:bg-primary/10">
              <PersonAvatar person={person} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{person.display_name}{person.status === "me" ? " (you)" : ""}</span>
                <span className="block truncate text-xs text-muted-foreground">{person.studying_kind === "exam" ? "Exam" : person.studying_subject ? subjectName(person.studying_subject) : "Studying"} · {duration(stats.period.today)} today</span>
              </span>
              <span className="font-mono text-lg tabular-nums text-primary">{clock(stats.session)}</span>
            </Button>
          ))}
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div><CardTitle>Leaderboard</CardTitle><CardDescription>{ranking === "time" ? "Ranked by whole minutes. Equal times share a place." : "Ranked by days with at least a minute of study. Ties share a place."}</CardDescription></div>
              <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)}>
                <TabsList aria-label="Leaderboard period">
                  {(Object.keys(PERIOD_LABEL) as Period[]).map((key) => <TabsTrigger key={key} value={key}>{PERIOD_LABEL[key]}</TabsTrigger>)}
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="grid gap-1 px-2 sm:px-4" aria-busy={loading}>
              {me && board.length > 1 ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                <div className="flex min-w-0 items-start gap-2">
                  <Trophy className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p>{nextRival ? <><span className="font-medium">{gapLabel(nextRival.score - me.score)} to match the next place.</span> <span className="text-muted-foreground">Catch {nextRival.person.display_name} · #{nextRival.rank}</span></>
                    : board[0].score === 0 ? "Your group is at the starting line. Log a session to set the pace."
                    : board.filter((entry) => entry.rank === 1).length > 1 ? "You’re tied for the lead. Keep the momentum going."
                    : <><span className="font-medium">You lead the group.</span> <span className="text-muted-foreground">{gapLabel(me.score - board[1].score)} ahead of the next place.</span></>}</p>
                </div>
                {nextRival ? <Button variant="outline" size="sm" onClick={() => setSelectedId(nextRival.person.user_id)}>Compare</Button> : null}
              </div> : null}
              <div className="mb-3 flex flex-wrap items-center gap-3 px-2">
                <div className="relative min-w-40 flex-1 max-sm:basis-full">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" aria-label="Search friends by name" className="pl-9" type="search" />
                </div>
                <Select value={ranking} onValueChange={(value) => { if (value) setRanking(value as Ranking) }}>
                  <SelectTrigger aria-label="Rank friends by"><SelectValue>{ranking === "time" ? "Study time" : "Active days"}</SelectValue></SelectTrigger>
                  <SelectContent><SelectItem value="time">Study time</SelectItem><SelectItem value="days">Active days</SelectItem></SelectContent>
                </Select>
                <Button variant={liveOnly ? "secondary" : "outline"} aria-pressed={liveOnly} onClick={() => setLiveOnly(!liveOnly)}>Studying now</Button>
              </div>
              {loading ? <div role="status" className="grid gap-3 px-2"><span className="sr-only">Loading friends</span>{[0, 1, 2].map((index) => <Skeleton key={index} className="h-14 motion-reduce:animate-none" />)}</div> : null}
              {visibleBoard.map(({ person, stats, rank, score }) => (
                <div key={person.user_id} className="flex min-w-0 items-center gap-1">
                <Button variant="ghost" onClick={() => setSelectedId(person.user_id)} className={cn("grid h-auto min-w-0 flex-1 grid-cols-[1.5rem_auto_minmax(0,1fr)_auto] justify-items-stretch gap-2 rounded-lg px-2 py-2 text-left font-normal whitespace-normal hover:bg-muted/60 sm:grid-cols-[1.5rem_auto_minmax(0,1fr)_auto_6rem] sm:gap-3", person.status === "me" && "bg-muted/40")}>
                  <span className={cn("text-center text-sm tabular-nums", rank <= 3 ? "font-semibold text-primary" : "text-muted-foreground")}>{rank}</span>
                  <PersonAvatar person={person} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{person.display_name}{person.status === "me" ? <span className="text-muted-foreground"> (you)</span> : null}</span>
                      {stats.streak > 1 ? <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" title={`${stats.streak}-day streak`}><Flame className="size-3" />{stats.streak}</span> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{person.studying_since ? `Studying now${person.studying_subject ? ` · ${subjectName(person.studying_subject)}` : ""}` : person.status_message || "Not studying right now"}</span>
                    {me && person.status !== "me" ? <span className="block truncate text-xs text-muted-foreground">{score === me.score ? "Tied with you" : `${gapLabel(Math.abs(score - me.score))} ${score > me.score ? "ahead of" : "behind"} you`}</span> : null}
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${score / leader * 100}%` }} /></span>
                  </span>
                  <span className="hidden sm:block"><WeekBars day={stats.day} /></span>
                  <span className="text-right text-sm font-medium tabular-nums">{ranking === "time" ? duration(stats.period[period]) : `${score}/${PERIOD_DAYS[period]}d`}</span>
                </Button>
                {person.status === "friend" ? <Button variant="ghost" size="icon" disabled={!!pending || !cheersLoaded || cheersError || cheered(person.user_id)} title={cheered(person.user_id) ? "Cheered · one cheer per friend every 24 hours" : `Cheer ${person.display_name}`} aria-label={cheered(person.user_id) ? `Already cheered ${person.display_name}` : `Cheer ${person.display_name}`} onClick={() => void cheerFriend(person)}>{cheered(person.user_id) ? <Check /> : <HeartHandshake />}</Button> : <span className="w-9 shrink-0" />}
                </div>
              ))}
              {!loading && fetchedAt && !visibleBoard.length ? <div role="status" className="grid justify-items-start gap-2 px-2 py-5"><p className="text-sm text-muted-foreground">{search.trim() ? "No friends match your search." : "No one is studying right now."}</p><Button variant="outline" size="sm" onClick={() => { setSearch(""); setLiveOnly(false) }}>Show everyone</Button></div> : null}
              {fetchedAt && board.length < 2 ? <p className="px-2 pt-3 text-sm text-muted-foreground">Your study group starts here. Share your code or add a friend below.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Today</CardTitle><CardDescription>Study sessions today, midnight to midnight.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              {loading ? <Skeleton className="h-16 motion-reduce:animate-none" /> : null}
              {visibleBoard.map(({ person, stats }) => (
                <div key={person.user_id} className="grid grid-cols-[minmax(0,4rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] sm:gap-3">
                  <span className="truncate">{person.status === "me" ? "You" : person.display_name}</span>
                  <div role="img" aria-label={`${person.display_name}: ${duration(stats.period.today)} studied today`}><DayTrack blocks={person.today_blocks} now={now} /></div>
                  <span className="text-right tabular-nums text-muted-foreground">{duration(stats.period.today)}</span>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,4rem)_minmax(0,1fr)_3.5rem] gap-2 text-xs text-muted-foreground sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] sm:gap-3" aria-hidden>
                <span /><span className="flex justify-between"><span>12am</span><span className="hidden sm:inline">6am</span><span>12pm</span><span className="hidden sm:inline">6pm</span><span>12am</span></span><span />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Cheers</CardTitle><CardDescription>A little encouragement goes a long way. Cheer each friend once every 24 hours.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              {cheersError ? <div role="alert" className="grid justify-items-start gap-2 text-sm"><p>Cheers are unavailable. Try refreshing them.</p><Button variant="outline" size="sm" onClick={() => void loadCheers()}>Retry cheers</Button></div>
                : !cheersLoaded ? <Skeleton className="h-12 motion-reduce:animate-none" />
                : receivedCheers.length ? receivedCheers.map((cheer) => <div key={cheer.sender_id} className="flex min-w-0 items-center gap-3 text-sm">
                  <HeartHandshake className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1"><p><span className="font-medium break-words">{cheer.sender_name}</span> cheered you on</p><time className="text-xs text-muted-foreground" dateTime={cheer.created_at} title={format(new Date(cheer.created_at), "PPp")}>{formatDistanceToNow(new Date(cheer.created_at), { addSuffix: true })}</time></div>
                  <Button variant="outline" size="sm" disabled={!!pending || cheered(cheer.sender_id)} onClick={() => { const friend = people.find((person) => person.user_id === cheer.sender_id); if (friend) void cheerFriend(friend) }}>{cheered(cheer.sender_id) ? "Cheered" : "Cheer back"}</Button>
                </div>) : <p className="text-sm text-muted-foreground">No cheers in the last 7 days. Send one from the leaderboard to encourage a friend.</p>}
              {receivedCheers.length ? <p className="text-xs text-muted-foreground">Latest cheer from each friend in the last 7 days.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Add a friend</CardTitle><CardDescription>Exchange codes to connect. Your study activity is shared once the request is accepted.</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
                <span className="text-sm text-muted-foreground">Your friend code</span>
                <span className="select-all font-mono tracking-wider">{profile?.code ?? "—"}</span>
              </div>
              <form className="grid gap-2" onSubmit={(event) => {
                event.preventDefault()
                if (!/^[A-F0-9]{8}$/.test(code)) { toast.error("Enter the 8-character friend code."); return }
                if (code === profile?.code) { toast.error("That is your own friend code. Share it with a friend instead."); return }
                void call("friends_add", { p_code: code }, "Could not add that friend.").then((ok) => { if (ok) { setCode(""); toast.success("Friend code added") } })
              }}>
                <Label htmlFor="friend-code" className="text-sm font-medium">Their friend code</Label>
                <div className="flex gap-2">
                  <Input id="friend-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\s/g, "").toUpperCase())} placeholder="e.g. A1B2C3D4" aria-label="Their friend code" maxLength={32} minLength={8} pattern="[A-Fa-f0-9]{8}" autoCapitalize="characters" autoComplete="off" spellCheck={false} required disabled={!!pending} className="min-w-0 font-mono uppercase" />
                  <Button type="submit" disabled={!!pending || code.length !== 8}><UserPlus />{pending === "friends_add" ? "Adding…" : "Add"}</Button>
                </div>
                <p className="text-xs text-muted-foreground">Adding someone who already sent you a request accepts it.</p>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Your profile & sharing</CardTitle><CardDescription>Accepted friends see your name, status, live study, study time and consistency. Your email is never shown.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              {profileError ? <div role="alert" className="grid justify-items-start gap-2 text-sm"><p>Could not load your profile.</p><Button variant="outline" size="sm" onClick={() => void loadProfile()}>Try again</Button></div> : null}
              <fieldset disabled={!profile || !!pending} className="grid min-w-0 gap-3">
                <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); if (profile) void saveProfile({ ...profile, display_name: draft.name.trim(), status_message: draft.status.trim() }) }}>
                  <Label className="grid gap-2 text-sm font-medium">Display name<Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="How friends see you" maxLength={40} required /></Label>
                  <Label className="grid gap-2 text-sm font-medium">Status (optional)<Input value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} placeholder="e.g. Revising for Methods" maxLength={60} /></Label>
                  <Button type="submit" variant="outline" disabled={!profile || !draft.name.trim() || (draft.name.trim() === profile.display_name && draft.status.trim() === profile.status_message)}>{pending === "friends_update_profile" ? "Saving…" : "Save profile"}</Button>
                </form>
                <Label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={profile?.share_subjects ?? true} onCheckedChange={(checked) => { if (profile) void saveProfile({ ...profile, share_subjects: checked }) }} />
                  Share live subjects and subject study totals
                </Label>
                <Label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={profile?.share_exams ?? false} onCheckedChange={(checked) => { if (profile) void saveProfile({ ...profile, share_exams: checked }) }} />
                  Share recent exam scores and paper titles
                </Label>
              </fieldset>
              <p className="text-xs text-muted-foreground">Subject and exam comparisons only use data each friend has chosen to share. Friend requests cannot see your study activity.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {selected ? <FriendSheet person={selected.person} stats={selected.stats} me={me} period={period} onPeriodChange={setPeriod} now={now} cheered={cheered(selected.person.user_id)} cheerDisabled={!!pending || !cheersLoaded || cheersError} onCheer={() => void cheerFriend(selected.person)} onClose={() => { setSelectedId(null); setRemoving(false) }} onRemove={() => setRemoving(true)} /> : null}
      <Dialog open={removing && !!selected} onOpenChange={(open) => { if (!pending) setRemoving(open) }}>
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>Remove {selected?.person.display_name}?</DialogTitle>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspacePage>
  )
}

function FriendSheet({ person, stats, me, period, onPeriodChange, now, cheered, cheerDisabled, onCheer, onClose, onRemove }: {
  person: Person; stats: StudyStats; me: { person: Person; stats: StudyStats } | undefined; period: Period; now: Date
  onPeriodChange: (period: Period) => void; cheered: boolean; cheerDisabled: boolean; onCheer: () => void; onClose: () => void; onRemove: () => void
}) {
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

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <PersonAvatar person={person} className="size-11 text-base" />
            <div className="min-w-0">
              <SheetTitle>{isMe ? "You" : person.display_name}</SheetTitle>
              <SheetDescription>{person.studying_since ? `Studying now · ${clock(stats.session)}` : person.status_message || "Not studying right now"}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="grid gap-6 px-4 pb-6">
          {!isMe ? <div className="grid justify-items-start gap-2"><Button variant="outline" disabled={cheerDisabled || cheered} onClick={onCheer}>{cheered ? <Check /> : <HeartHandshake />}{cheered ? "Cheered" : "Send a cheer"}</Button><p className="text-xs text-muted-foreground">One cheer per friend every 24 hours.</p></div> : null}

          {comparison.length ? <section className="grid min-w-0 gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Head to head</h3>
              <Tabs value={period} onValueChange={(value) => onPeriodChange(value as Period)}><TabsList aria-label="Comparison period">{(Object.keys(PERIOD_LABEL) as Period[]).map((key) => <TabsTrigger key={key} value={key}>{PERIOD_LABEL[key]}</TabsTrigger>)}</TabsList></Tabs>
            </div>
            <Table className="[&_td]:px-2 [&_th]:px-2">
              <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead className="text-right">You</TableHead><TableHead className="max-w-32 truncate text-right" title={person.display_name}>{person.display_name}</TableHead></TableRow></TableHeader>
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
            {person.subjects == null ? <p className="text-sm text-muted-foreground">{person.display_name} keeps their subjects private.</p>
              : comparedSubjects.length ? <Table>
                <TableHeader><TableRow><TableHead>Subject</TableHead><TableHead className="text-right">You</TableHead><TableHead className="max-w-32 truncate text-right" title={person.display_name}>{person.display_name}</TableHead></TableRow></TableHeader>
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
            {!person.exams?.length ? <p className="text-sm text-muted-foreground">{person.exams || isMe ? "No exams logged yet." : `${person.display_name} doesn't share exam results.`}</p>
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
