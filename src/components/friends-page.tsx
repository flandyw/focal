import { useCallback, useEffect, useMemo, useState } from "react"
import { Copy, Flame, UserPlus } from "lucide-react"
import { format, subDays } from "date-fns"
import { toast } from "sonner"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs"
import { PageHeader } from "./page-header"
import { MetricCard, MetricGrid, WorkspacePage } from "./workspace-layout"
import { useTickingNow } from "../hooks/use-ticking-now"
import { getHeatColor, getSubjectColor } from "../lib/progress-chart-theme"
import { getSubjectById } from "../lib/progress-utils"
import { supabase } from "../lib/supabase"
import { cn } from "../lib/utils"

type SharedExam = { subject: string | null; title: string | null; rawScore: number | null; rawMax: number | null; completedAt: string | null }
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

const PERIOD_LABEL: Record<Period, string> = { today: "Today", week: "7 days", month: "30 days" }
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
  const today = dayKey(now)
  const day = (offset: number) => {
    const key = dayKey(subDays(now, offset))
    return (person.daily?.[key] ?? 0) + (key === today ? live : 0)
  }
  const sum = (days: number) => Array.from({ length: days }, (_, offset) => day(offset)).reduce((a, b) => a + b, 0)
  let streak = day(0) >= 60_000 ? 1 : 0
  for (let offset = 1; offset < 84 && day(offset) >= 60_000; offset++) streak++
  return {
    day, streak,
    period: { today: day(0), week: sum(7), month: sum(30) } as Record<Period, number>,
    total: person.total_ms + live,
    session: person.studying_since ? Math.max(0, now.getTime() - new Date(person.studying_since).getTime()) : 0,
  }
}

function Avatar({ person, className }: { person: Person; className?: string }) {
  return (
    <span className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium", className)} aria-hidden>
      {person.display_name.slice(0, 1).toUpperCase()}
      {person.studying_since ? <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card bg-primary" /> : null}
    </span>
  )
}

/** One 24-hour track; blocks are today's study, the open one runs to now. */
function DayTrack({ blocks, now, className }: { blocks: Person["today_blocks"]; now: Date; className?: string }) {
  const start = new Date(now).setHours(0, 0, 0, 0)
  const at = (iso: string | null) => Math.min(100, Math.max(0, ((iso ? new Date(iso).getTime() : now.getTime()) - start) / 864_000))
  return (
    <div className={cn("relative h-3 overflow-hidden rounded-sm bg-muted", className)}>
      {[25, 50, 75].map((left) => <span key={left} className="absolute inset-y-0 w-px bg-border" style={{ left: `${left}%` }} />)}
      {(blocks ?? []).map(([from, to], index) => (
        <span key={index} className={cn("absolute inset-y-0 rounded-[2px] bg-primary", !to && "animate-pulse")} style={{ left: `${at(from)}%`, width: `max(2px, ${at(to) - at(from)}%)` }} />
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const poll = useTickingNow(30_000)
  const now = useTickingNow(1_000)

  const load = useCallback(async () => {
    if (!signedIn) return
    const { data, error } = await supabase!.rpc("friends_list", { p_tz: TIME_ZONE })
    if (error) return toast.error("Could not load friends.")
    setPeople(data as Person[])
    setFetchedAt(Date.now())
  }, [signedIn])

  useEffect(() => {
    if (!signedIn) return
    void supabase!.rpc("friends_me").single<Profile>().then(({ data, error }) => {
      if (error) return toast.error("Could not load your friend profile.")
      setProfile(data)
      setDraft({ name: data.display_name, status: data.status_message })
    })
  }, [signedIn])
  // shortcut: data refreshes on a 30 s poll (and when the tab returns), not realtime; timers tick locally in between.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load, poll])

  async function call(fn: string, args: Record<string, unknown>, failure: string) {
    const { error } = await supabase!.rpc(fn, args)
    if (error) { toast.error(error.message || failure); return false }
    void load()
    return true
  }

  async function saveProfile(next: Profile) {
    const args = { p_display_name: next.display_name, p_status_message: next.status_message, p_share_exams: next.share_exams, p_share_subjects: next.share_subjects }
    if (await call("friends_update_profile", args, "Could not save your profile.")) setProfile(next)
  }

  const board = useMemo(() => people
    .filter((person) => person.status === "me" || person.status === "friend")
    .map((person) => ({ person, stats: activity(person, now, fetchedAt) }))
    .sort((a, b) => b.stats.period[period] - a.stats.period[period]), [people, now, fetchedAt, period])

  if (!signedIn) {
    return (
      <WorkspacePage>
        <PageHeader title="Friends" description="Study together: see who is studying right now, compare daily time and keep each other on track. Friends need a Focal account." />
        <div><Button onClick={onSignIn}>Sign in to add friends</Button></div>
      </WorkspacePage>
    )
  }

  const requests = people.filter((person) => person.status === "incoming" || person.status === "outgoing")
  const studying = board.filter(({ person }) => person.studying_since)
  const leader = Math.max(board[0]?.stats.period[period] ?? 0, 1)
  const myRank = board.findIndex(({ person }) => person.status === "me") + 1
  const selected = board.find(({ person }) => person.user_id === selectedId)
  const copyCode = () => { if (profile) void navigator.clipboard.writeText(profile.code).then(() => toast.success("Friend code copied")) }

  return (
    <WorkspacePage>
      <PageHeader title="Friends" description="Study together. See who is studying right now, compare time and streaks, and open a friend to see their day.">
        <Button variant="outline" onClick={copyCode} disabled={!profile}><Copy />Code <span className="font-mono tracking-wider">{profile?.code ?? "…"}</span></Button>
      </PageHeader>

      <MetricGrid className="sm:grid-cols-4">
        <MetricCard label="Studying now" value={`${studying.length} / ${board.length}`} />
        <MetricCard label="Group today" value={duration(board.reduce((sum, { stats }) => sum + stats.period.today, 0))} />
        <MetricCard label={`Your rank · ${PERIOD_LABEL[period]}`} value={myRank ? `#${myRank}` : "—"} />
        <MetricCard label="Your streak" value={`${board.find(({ person }) => person.status === "me")?.stats.streak ?? 0}d`} />
      </MetricGrid>

      {studying.length ? (
        <section aria-label="Studying now" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {studying.map(({ person, stats }) => (
            <button key={person.user_id} type="button" onClick={() => setSelectedId(person.user_id)} className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10">
              <Avatar person={person} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{person.display_name}{person.status === "me" ? " (you)" : ""}</span>
                <span className="block truncate text-xs text-muted-foreground">{person.studying_kind === "exam" ? "Exam" : person.studying_subject ? subjectName(person.studying_subject) : "Studying"} · {duration(stats.period.today)} today</span>
              </span>
              <span className="font-mono text-lg tabular-nums text-primary">{clock(stats.session)}</span>
            </button>
          ))}
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div><CardTitle>Leaderboard</CardTitle><CardDescription>Study time, ranked. Bars show the last 7 days.</CardDescription></div>
              <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)}>
                <TabsList aria-label="Leaderboard period">
                  {(Object.keys(PERIOD_LABEL) as Period[]).map((key) => <TabsTrigger key={key} value={key}>{PERIOD_LABEL[key]}</TabsTrigger>)}
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="grid gap-1 px-2 sm:px-4">
              {board.map(({ person, stats }, index) => (
                <button key={person.user_id} type="button" onClick={() => setSelectedId(person.user_id)} className={cn("grid grid-cols-[1.5rem_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60 sm:grid-cols-[1.5rem_auto_minmax(0,1fr)_auto_6rem]", person.status === "me" && "bg-muted/40")}>
                  <span className={cn("text-center text-sm tabular-nums", index < 3 ? "font-semibold text-primary" : "text-muted-foreground")}>{index + 1}</span>
                  <Avatar person={person} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{person.display_name}{person.status === "me" ? <span className="text-muted-foreground"> (you)</span> : null}</span>
                      {stats.streak > 1 ? <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" title={`${stats.streak}-day streak`}><Flame className="size-3" />{stats.streak}</span> : null}
                    </span>
                    {person.status_message ? <span className="block truncate text-xs text-muted-foreground">{person.status_message}</span> : null}
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${stats.period[period] / leader * 100}%` }} /></span>
                  </span>
                  <span className="hidden sm:block"><WeekBars day={stats.day} /></span>
                  <span className="text-right text-sm font-medium tabular-nums">{duration(stats.period[period])}</span>
                </button>
              ))}
              {board.length < 2 ? <p className="px-2 pt-3 text-sm text-muted-foreground">Share your friend code to start a leaderboard.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Today</CardTitle><CardDescription>When everyone studied today, midnight to midnight.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              {board.map(({ person, stats }) => (
                <div key={person.user_id} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
                  <span className="truncate">{person.status === "me" ? "You" : person.display_name}</span>
                  <DayTrack blocks={person.today_blocks} now={now} />
                  <span className="text-right tabular-nums text-muted-foreground">{duration(stats.period.today)}</span>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] gap-3 text-xs text-muted-foreground" aria-hidden>
                <span /><span className="flex justify-between"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></span><span />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Your profile</CardTitle><CardDescription>Friends see your name, status, live study and study time. Your email is never shown.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); if (profile) void saveProfile({ ...profile, display_name: draft.name.trim(), status_message: draft.status.trim() }) }}>
                <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Display name" aria-label="Display name" maxLength={40} />
                <Input value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} placeholder="Status, e.g. Methods exam in 2 weeks" aria-label="Status" maxLength={60} />
                <Button type="submit" variant="outline" disabled={!profile || (draft.name.trim() === profile.display_name && draft.status.trim() === profile.status_message)}>Save</Button>
              </form>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={profile?.share_subjects ?? true} disabled={!profile} onChange={(event) => { if (profile) void saveProfile({ ...profile, share_subjects: event.target.checked }) }} />
                Show which subjects I study
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={profile?.share_exams ?? false} disabled={!profile} onChange={(event) => { if (profile) void saveProfile({ ...profile, share_exams: event.target.checked }) }} />
                Share my recent exam results
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Add a friend</CardTitle><CardDescription>Enter their code. You become friends once they add you back or accept.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void call("friends_add", { p_code: code }, "Could not add that friend.").then((ok) => { if (ok) { setCode(""); toast.success("Friend request sent") } }) }}>
                <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Friend code" aria-label="Friend code" maxLength={8} autoCapitalize="characters" spellCheck={false} required className="min-w-0 font-mono uppercase" />
                <Button type="submit"><UserPlus />Add</Button>
              </form>
              {requests.map((person) => (
                <div key={person.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-sm">
                  <Avatar person={person} className="size-7 text-xs" />
                  <span className="min-w-32 flex-1 truncate">{person.display_name} <span className="text-muted-foreground">· {person.status === "incoming" ? "wants to be friends" : "request sent"}</span></span>
                  <span className="ml-auto flex gap-2">
                    {person.status === "incoming" ? <Button size="sm" onClick={() => void call("friends_accept", { p_user_id: person.user_id }, "Could not accept the request.")}>Accept</Button> : null}
                    <Button size="sm" variant="outline" onClick={() => void call("friends_remove", { p_user_id: person.user_id }, "Could not update the request.")}>{person.status === "incoming" ? "Decline" : "Cancel"}</Button>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {selected ? <FriendSheet person={selected.person} stats={selected.stats} now={now} onClose={() => setSelectedId(null)} onRemove={() => {
        if (!window.confirm(`Remove ${selected.person.display_name} from your friends?`)) return
        setSelectedId(null)
        void call("friends_remove", { p_user_id: selected.person.user_id }, "Could not remove this friend.")
      }} /> : null}
    </WorkspacePage>
  )
}

function FriendSheet({ person, stats, now, onClose, onRemove }: { person: Person; stats: ReturnType<typeof activity>; now: Date; onClose: () => void; onRemove: () => void }) {
  const isMe = person.status === "me"
  // 12 Monday-first columns ending with this week; cells hold "days ago" (negative = later this week).
  const weekday = (now.getDay() + 6) % 7
  const weeks = Array.from({ length: 12 }, (_, week) => Array.from({ length: 7 }, (_, day) => (11 - week) * 7 + weekday - day))
  const best = Math.max(...Array.from({ length: 84 }, (_, offset) => stats.day(offset)))
  const subjects = Object.entries(person.subjects ?? {}).sort((a, b) => b[1] - a[1])
  const subjectTotal = subjects.reduce((sum, [, ms]) => sum + ms, 0) || 1

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <Avatar person={person} className="size-11 text-base" />
            <div className="min-w-0">
              <SheetTitle>{isMe ? "You" : person.display_name}</SheetTitle>
              <SheetDescription>{person.studying_since ? `Studying now · ${clock(stats.session)}` : person.status_message || "Not studying right now"}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="grid gap-6 px-4 pb-6">
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
                return (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_5rem_2.5rem] items-center gap-3 text-sm">
                    <span className="min-w-0 truncate">{exam.subject} · {exam.title}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${score ?? 0}%` }} /></span>
                    <span className="text-right tabular-nums">{score == null ? "—" : `${score}%`}</span>
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
