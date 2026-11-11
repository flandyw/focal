import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, CalendarPlus, Clock3, DoorOpen, Plus, RefreshCw, UserPlus, Users } from "lucide-react"
import { format } from "date-fns"
import { toast } from "sonner"
import { supabase, withSupabaseSession } from "../lib/supabase"
import { canonicalNow } from "../lib/study-session-sync"
import { useTickingNow } from "../hooks/use-ticking-now"
import type { CanonicalStudySession } from "../lib/sync/sessionContract"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Checkbox } from "./ui/checkbox"
import { NativeSelect, NativeSelectOption } from "./ui/native-select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Avatar, AvatarFallback } from "./ui/avatar"
import { Skeleton } from "./ui/skeleton"

type Member = { user_id: string; name: string; status: "invited" | "going" | "joined" | "left" | "declined" }
type Room = {
  id: string; owner_id: string; host_name: string; title: string; note: string
  kind: "desk" | "round"; visibility: "friends" | "invite"
  starts_at: string; ends_at: string; ended_at: string | null
  focus_minutes: number; break_minutes: number; my_status: Member["status"] | null; members: Member[]
}
type Friend = { id: string; name: string; studying: boolean }
type Draft = { id: string; title: string; note: string; kind: Room["kind"]; visibility: Room["visibility"]; scheduled: boolean; start: string; focus: string; pause: string; members: string[] }

const ended = (room: Room, now: Date) => !!room.ended_at || Date.parse(room.ends_at) <= now.getTime()
const time = (date: string | number) => format(new Date(date), "h:mm aaa")
const when = (room: Room) => `${format(new Date(room.starts_at), "EEE d MMM")} · ${time(room.starts_at)}–${time(Date.parse(room.starts_at) + room.focus_minutes * 60_000)}`
const timer = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

function Initial({ name }: { name: string }) {
  return <Avatar className="size-9 shrink-0" aria-hidden><AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
}

export function FriendStudySessions({ userId, friends = [], sessions = [], compact = false, onOpenTimer, onOpenFriends }: {
  userId: string
  friends?: Friend[]
  sessions?: CanonicalStudySession[]
  compact?: boolean
  onOpenTimer: (subject?: string, intent?: string, sessionId?: string) => void
  onOpenFriends?: () => void
}) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const loadSequence = useRef(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [inviting, setInviting] = useState<Room | null>(null)
  const [invitees, setInvitees] = useState<string[]>([])
  const [confirmEnd, setConfirmEnd] = useState<Room | null>(null)
  const [task, setTask] = useState("")
  const now = useTickingNow(1000)

  const load = useCallback(async () => {
    if (!supabase) return
    const sequence = ++loadSequence.current
    setRefreshing(true)
    try {
      const { data, error } = await withSupabaseSession(userId, () => supabase!.rpc("friend_study_list"))
      if (sequence !== loadSequence.current) return
      if (error) throw error
      setRooms((data ?? []) as Room[])
      setLoaded(true)
      setLoadError(false)
    } catch { if (sequence === loadSequence.current) setLoadError(true) }
    finally { if (sequence === loadSequence.current) setRefreshing(false) }
  }, [userId])

  useEffect(() => {
    let disposed = false
    let inFlight = false
    const refresh = async () => {
      if (disposed || document.hidden || inFlight) return
      inFlight = true
      await load()
      inFlight = false
    }
    void refresh()
    // shortcut: presence refreshes every 10 seconds while visible; use realtime if larger rooms need instant updates.
    const poll = window.setInterval(() => void refresh(), 10_000)
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    window.addEventListener("focal:friend-study-refresh", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      disposed = true
      clearInterval(poll)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("online", refresh)
      window.removeEventListener("focal:friend-study-refresh", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [load])

  async function mutate(fn: string, args: Record<string, unknown>, success: string) {
    if (!supabase || busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    try {
      const { error } = await withSupabaseSession(userId, () => supabase!.rpc(fn, args))
      if (error) throw error
      await load()
      window.dispatchEvent(new Event("focal:study-sessions-changed"))
      toast.success(success)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (error as { message?: string })?.message || "Could not update the session. Try again.")
      return false
    } finally { busyRef.current = false; setBusy(false) }
  }

  const active = rooms.find((room) => room.my_status === "joined" && !ended(room, now))
  const selected = selectedId === "browse" ? undefined : rooms.find((room) => room.id === selectedId) ?? active
  const invitations = rooms.filter((room) => room.my_status === "invited" && !ended(room, now))
  const upcoming = rooms.filter((room) => !ended(room, now) && Date.parse(room.starts_at) > now.getTime() && room.my_status !== "invited" && room.my_status !== "declined" && room.my_status !== "left")
  const live = rooms.filter((room) => !ended(room, now) && Date.parse(room.starts_at) <= now.getTime() && room.my_status !== "declined")
  const recent = rooms.filter((room) => ended(room, now) && ["invited", "going", "joined"].includes(room.my_status ?? ""))

  function newSession(scheduled: boolean, friendId?: string) {
    setDraft({ id: crypto.randomUUID(), title: "", note: "", kind: scheduled ? "round" : "desk", visibility: friendId || scheduled ? "invite" : "friends",
      scheduled, start: format(new Date(canonicalNow().getTime() + 3_600_000), "yyyy-MM-dd'T'HH:mm"), focus: "25", pause: "5", members: friendId ? [friendId] : [] })
  }

  async function save() {
    if (!draft) return
    const start = draft.scheduled ? new Date(draft.start) : null
    if (start && (!Number.isFinite(start.getTime()) || start.getTime() <= now.getTime() || start.getTime() > now.getTime() + 90 * 86_400_000)) {
      toast.error("Choose a future start time within 90 days."); return
    }
    if (!draft.title.trim() || !Number.isInteger(Number(draft.focus)) || Number(draft.focus) < 1 || Number(draft.focus) > 180
      || !Number.isInteger(Number(draft.pause)) || Number(draft.pause) < 0 || Number(draft.pause) > 30) {
      toast.error("Enter a title, 1–180 focus minutes and 0–30 break minutes."); return
    }
    if (await mutate("friend_study_create", { p_id: draft.id, p_title: draft.title.trim(), p_note: draft.note, p_kind: draft.kind,
      p_visibility: draft.visibility, p_starts_at: start?.toISOString() ?? null, p_focus_minutes: Number(draft.focus),
      p_break_minutes: draft.kind === "round" ? Number(draft.pause) : 0, p_members: draft.members }, draft.scheduled ? "Session planned and invitations sent" : "Your session is open")) {
      setSelectedId(draft.id); setDraft(null); setTask("")
    }
  }

  async function respond(room: Room, action: "accept" | "join" | "decline" | "leave") {
    if (await mutate("friend_study_respond", { p_id: room.id, p_action: action }, {
      accept: "Invitation accepted", join: "Joined the session. Your personal timer is unchanged.",
      decline: "Invitation declined", leave: "You left the session. Your study is kept.",
    }[action])) {
      setSelectedId(action === "decline" || action === "leave" ? "browse" : room.id)
      setTask("")
    }
  }

  function clock(room: Room) {
    const focusEnd = Date.parse(room.starts_at) + room.focus_minutes * 60_000
    if (ended(room, now)) return { label: room.ended_at ? "Session ended" : room.kind === "round" ? "Round complete" : "Session finished", value: "00:00" }
    if (Date.parse(room.starts_at) > now.getTime()) {
      const remaining = Date.parse(room.starts_at) - now.getTime()
      return { label: "Starts in", value: remaining >= 86_400_000 ? `${Math.floor(remaining / 86_400_000)}d ${Math.floor(remaining / 3_600_000) % 24}h` : timer(remaining) }
    }
    if (room.kind === "desk") return { label: "Studying together for", value: timer(now.getTime() - Date.parse(room.starts_at)) }
    return now.getTime() < focusEnd ? { label: `Focus ends at ${time(focusEnd)}`, value: timer(focusEnd - now.getTime()) }
      : { label: "Take a break · pause your personal timer", value: timer(Date.parse(room.ends_at) - now.getTime()) }
  }

  if (compact) {
    if (!active) return loadError ? <p role="status" className="mb-5 text-sm text-muted-foreground">Shared session status is unavailable. Your personal timer is unaffected. <Button variant="link" size="sm" onClick={onOpenFriends}>Open Friends</Button></p> : null
    const value = clock(active)
    return <section aria-label="Your shared study session" className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="min-w-0"><p className="flex items-center gap-2 text-sm font-medium"><Users className="size-4 shrink-0" aria-hidden />{active.title}</p><p className="text-sm text-muted-foreground">{loadError ? "Reconnecting · shared presence may be out of date" : `${active.members.filter((m) => m.status === "joined").length} in session · ${value.label}`}</p></div>
      <span className="font-mono text-2xl tabular-nums text-primary">{value.value}</span><Button variant="outline" onClick={onOpenFriends}>View session</Button>
    </section>
  }

  const memberPicker = (members: string[], onChange: (ids: string[]) => void, excluded: string[] = []) => <fieldset className="grid max-h-48 gap-3 overflow-y-auto">
    <legend className="mb-3 text-sm font-medium">Invite friends</legend>
    {friends.filter((friend) => !excluded.includes(friend.id)).map((friend) => <Label key={friend.id} className="flex min-h-8 items-center gap-2 text-sm"><Checkbox checked={members.includes(friend.id)} onCheckedChange={(checked) => onChange(checked ? [...members, friend.id] : members.filter((id) => id !== friend.id))} disabled={busy || (!members.includes(friend.id) && members.length >= 32)} />{friend.name}</Label>)}
    {!friends.filter((friend) => !excluded.includes(friend.id)).length ? <p className="text-sm text-muted-foreground">No more friends to invite. Add a friend from the page header.</p> : null}
  </fieldset>

  return <div className="grid min-w-0 gap-8">
    {loadError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>{loaded ? "Connection lost. Shared presence may be out of date; your personal timer keeps running." : "Could not load shared sessions. Check your connection and try again."}</p><Button variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw />Try again</Button></div> : null}
    {!loaded && !loadError ? <div role="status" className="grid gap-4"><span className="sr-only">Loading shared sessions</span><Skeleton className="h-32" /><Skeleton className="h-20" /></div> : null}
    {selected ? <>
      <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" onClick={() => setSelectedId("browse")}><ArrowLeft />All sessions</Button>{selected.owner_id === userId && !ended(selected, now) ? <Button variant="outline" onClick={() => { setInviting(selected); setInvitees([]) }}><UserPlus />Invite friends</Button> : null}</div>
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] xl:gap-12">
        <section className="grid min-w-0 content-start gap-6">
          <div><h2 className="focal-section-title break-words">{selected.title}</h2><p className="mt-2 text-sm text-muted-foreground">{selected.kind === "round" ? `${selected.focus_minutes} min focus · ${selected.break_minutes} min break` : "Your own subject, your own timer"} · {selected.visibility === "friends" ? "Open to the host’s friends" : "Invitation only"}</p></div>
          {selected.note ? <p className="max-w-prose whitespace-pre-wrap break-words text-sm">{selected.note}</p> : null}
          {Date.parse(selected.starts_at) > now.getTime() ? <p className="flex items-center gap-2 text-sm"><Clock3 className="size-4" />{when(selected)}</p> : null}
          <div className="grid justify-items-center gap-4 py-6 sm:py-10">
            <p className="text-center text-sm text-muted-foreground">{clock(selected).label}</p>
            <p className="font-mono text-5xl leading-none tabular-nums text-primary sm:text-6xl xl:text-8xl" aria-label={`${clock(selected).label}: ${clock(selected).value}`}>{clock(selected).value}</p>
            <p className="text-center text-sm text-muted-foreground">{selected.members.filter((m) => m.status === "joined").length} in session. Personal study time is saved separately.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {ended(selected, now) ? <Button onClick={() => onOpenTimer()}>Study solo</Button>
              : selected.my_status === "joined" ? <Button variant="outline" disabled={busy} onClick={() => void respond(selected, "leave")}><DoorOpen />Leave session</Button>
              : Date.parse(selected.starts_at) <= now.getTime() ? <Button disabled={busy || !!active} onClick={() => void respond(selected, "join")}>Join session</Button>
              : selected.my_status === "going" ? <span className="text-sm text-primary">You’re going. Join here when the session starts.</span>
              : <Button disabled={busy} onClick={() => void respond(selected, "accept")}>Accept invitation</Button>}
            {selected.my_status === "invited" && !ended(selected, now) ? <Button variant="outline" disabled={busy} onClick={() => void respond(selected, "decline")}>Decline</Button> : null}
            {selected.my_status === "going" && selected.owner_id !== userId && !ended(selected, now) ? <Button variant="outline" disabled={busy} onClick={() => void respond(selected, "leave")}>Can’t make it</Button> : null}
          </div>
          {selected.my_status === "joined" && !ended(selected, now) ? <section className="grid gap-3 border-t pt-6">
            <h3 className="font-heading text-xl">Your focus</h3><Label htmlFor="shared-study-task">What are you working on?</Label>
            <Input id="shared-study-task" value={task} onChange={(event) => setTask(event.target.value)} maxLength={200} placeholder="e.g. Finish questions 8–12 on differentiation" />
            <p className="text-sm text-muted-foreground">Only you see this task; it’s used for a new personal timer. Existing timers and plans stay unchanged. Shared breaks do not pause your timer.</p>
            <Button className="justify-self-start" onClick={() => {
              const plan = sessions.find((session) => session.id === `friend-study:${selected.id}` && !session.cancelled_at && !session.completed)
              onOpenTimer(undefined, task.trim() || selected.title, plan?.id)
            }}>Open personal timer</Button>
          </section> : null}
        </section>
        <aside className="grid min-w-0 content-start gap-6 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <section><h3 className="font-heading text-xl">People</h3><ul className="mt-4 divide-y">{selected.members.filter((m) => ["joined", "going"].includes(m.status)).map((member) => <li key={member.user_id} className="flex items-center gap-3 py-3"><Initial name={member.name} /><div className="min-w-0"><p className="truncate text-sm font-medium">{member.user_id === userId ? "You" : member.name}{member.user_id === selected.owner_id ? " · host" : ""}</p><p className="text-sm text-muted-foreground">{ended(selected, now) ? "Session ended" : member.status === "joined" ? "In session" : "Going"}</p></div></li>)}</ul></section>
          {selected.owner_id === userId ? <section><h3 className="font-heading text-xl">Invitations</h3><ul className="mt-3 grid gap-3">{selected.members.filter((m) => m.status === "invited" || m.status === "declined").map((member) => <li key={member.user_id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate">{member.name}</span><span className="shrink-0 text-muted-foreground">{member.status === "invited" ? "Waiting" : "Declined"}</span>{member.status === "invited" && !ended(selected, now) ? <Button variant="ghost" size="sm" disabled={busy} aria-label={`Cancel invitation for ${member.name}`} onClick={() => void mutate("friend_study_withdraw", { p_id: selected.id, p_user_id: member.user_id }, "Invitation cancelled")}>Cancel</Button> : null}</li>)}</ul>{!selected.members.some((m) => m.status === "invited" || m.status === "declined") ? <p className="mt-3 text-sm text-muted-foreground">No invitations waiting.</p> : null}</section> : null}
          <p className="text-sm text-muted-foreground">Each person controls their own timer. Leaving this session keeps your study history and lets you continue solo.</p>
          {selected.owner_id === userId && !ended(selected, now) ? <Button variant="outline" disabled={busy} onClick={() => setConfirmEnd(selected)}>{Date.parse(selected.starts_at) > now.getTime() ? "Cancel session" : "End shared session"}</Button> : null}
        </aside>
      </div>
    </> : <>
      <section className="grid gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="focal-section-title">Study together</h2><p className="mt-2 text-sm text-muted-foreground">A little company for your next study block.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!loaded || busy} onClick={() => newSession(true)}><CalendarPlus />Plan a session</Button><Button disabled={!loaded || busy || !!active} onClick={() => newSession(false)}><Plus />Start a session</Button></div></div>
        {active ? <Button variant="outline" className="h-auto justify-between gap-3 py-3 text-left whitespace-normal" onClick={() => setSelectedId(active.id)}><span className="min-w-0 truncate">Return to {active.title}</span><span className="font-mono tabular-nums">{clock(active).value}</span></Button> : null}
        {invitations.length ? <section><h3 className="font-heading text-xl">Your invitations</h3><ul className="mt-3 divide-y">{invitations.map((room) => <li key={room.id} className="flex flex-wrap items-center gap-3 py-4"><Initial name={room.host_name} /><div className="min-w-0 flex-1"><p className="break-words font-medium">{room.title}</p><p className="text-sm text-muted-foreground">{room.host_name} invited you · {Date.parse(room.starts_at) > now.getTime() ? when(room) : "Happening now"}</p></div><Button variant="outline" onClick={() => setSelectedId(room.id)}>View invitation</Button></li>)}</ul></section> : null}
        <section><h3 className="font-heading text-xl">Open sessions</h3><ul className="mt-3 divide-y">{live.map((room) => <li key={room.id} className="flex flex-wrap items-center gap-3 py-5"><Initial name={room.host_name} /><div className="min-w-0 flex-1"><p className="break-words font-medium">{room.title}</p><p className="mt-1 text-sm text-muted-foreground">{room.kind === "round" ? "Focus round" : "Open desk"} · {room.members.filter((m) => m.status === "joined").length} in session · {room.visibility === "friends" ? "Open to friends" : "Invitation only"}</p></div><span className="font-mono text-lg tabular-nums text-primary">{clock(room).value}</span><Button variant="outline" onClick={() => setSelectedId(room.id)}>View session</Button></li>)}</ul>{loaded && !live.length ? <div className="py-5"><p className="text-sm">No open sessions right now.</p><p className="mt-1 text-sm text-muted-foreground">Start a quiet desk or a timed round, then invite a friend.</p></div> : null}</section>
      </section>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
        <section><h3 className="focal-section-title">Coming up</h3><ul className="mt-3 divide-y">{upcoming.map((room) => <li key={room.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="break-words font-medium">{room.title}</p><p className="mt-1 text-sm text-muted-foreground">{when(room)}</p><p className="text-sm text-primary">{room.my_status === "going" ? "You’re going" : `Hosted by ${room.host_name}`}</p></div><Button variant="outline" onClick={() => setSelectedId(room.id)}>View</Button></li>)}</ul>{loaded && !upcoming.length ? <p className="py-5 text-sm text-muted-foreground">Nothing planned yet. Pick a time that works for you and your friends.</p> : null}<p className="text-sm text-muted-foreground">Times use your local timezone · {Intl.DateTimeFormat().resolvedOptions().timeZone}. Accepted plans appear in Calendar; reminders follow your settings.</p></section>
        <section><h3 className="focal-section-title">Your friends</h3><ul className="mt-3 divide-y">{friends.map((friend) => <li key={friend.id} className="flex items-center gap-3 py-3"><Initial name={friend.name} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{friend.name}</p><p className="text-sm text-muted-foreground">{friend.studying ? "Studying now" : "Not studying right now"}</p></div><Button size="sm" variant="outline" disabled={!loaded || busy || (active?.owner_id === userId && active.members.some((m) => m.user_id === friend.id))} onClick={() => {
          if (active?.owner_id === userId) { setInviting(active); setInvitees([friend.id]) }
          else newSession(false, friend.id)
        }}>{active?.owner_id === userId && active.members.some((m) => m.user_id === friend.id) ? "Included" : "Invite"}</Button></li>)}</ul>{!friends.length ? <p className="py-5 text-sm text-muted-foreground">Add a friend to invite them to study.</p> : null}</section>
      </div>
      {recent.length ? <section><h3 className="font-heading text-xl">Recently ended</h3><ul className="mt-3 divide-y">{recent.map((room) => <li key={room.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="truncate">{room.title} · {room.ended_at ? "Ended by host" : "Session finished"}</span><Button variant="ghost" size="sm" onClick={() => setSelectedId(room.id)}>View</Button></li>)}</ul></section> : null}
    </>}
    <Dialog open={!!draft} onOpenChange={(open) => { if (!open && !busy) setDraft(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{draft?.scheduled ? "Plan a session" : "Start a session"}</DialogTitle><DialogDescription>Choose a quiet desk with independent timers, or a shared focus round.</DialogDescription></DialogHeader>
      {draft ? <form id="shared-study-form" className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save() }}><fieldset disabled={busy} className="grid min-w-0 gap-4">
        <Label className="grid gap-2">Session name<Input autoFocus required maxLength={80} placeholder="e.g. Methods revision" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Label>
        <Label className="grid gap-2">Session type<NativeSelect className="w-full" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Room["kind"] })}><NativeSelectOption value="desk">Open desk · independent timers</NativeSelectOption><NativeSelectOption value="round">Focus round · shared countdown</NativeSelectOption></NativeSelect></Label>
        <div className="grid grid-cols-2 gap-3"><Label className="grid gap-2">{draft.kind === "desk" ? "Planned minutes" : "Focus minutes"}<Input type="number" required min={1} max={180} step={1} value={draft.focus} onChange={(e) => setDraft({ ...draft, focus: e.target.value })} /></Label>{draft.kind === "round" ? <Label className="grid gap-2">Break minutes<Input type="number" required min={0} max={30} step={1} value={draft.pause} onChange={(e) => setDraft({ ...draft, pause: e.target.value })} /></Label> : null}</div>
        {draft.scheduled ? <Label className="grid gap-2">Start time (your local time)<Input type="datetime-local" required min={format(now, "yyyy-MM-dd'T'HH:mm")} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></Label> : null}
        <Label className="grid gap-2">Who can join?<NativeSelect className="w-full" value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as Room["visibility"] })}><NativeSelectOption value="friends">My accepted friends</NativeSelectOption><NativeSelectOption value="invite">Only invited friends</NativeSelectOption></NativeSelect></Label>
        <Label className="grid gap-2">Note for friends (optional)<Input maxLength={500} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="e.g. Bring a question you’re stuck on" /></Label>
        {memberPicker(draft.members, (members) => setDraft({ ...draft, members }))}
        <p className="text-sm text-muted-foreground">{draft.kind === "desk" ? "Desks close after 12 hours, or when you end them. " : "The shared round starts at the set time, even if someone arrives late. "}Only selected friends receive invitations. Your subjects, tasks and exam results keep their existing privacy settings.</p>
      </fieldset></form> : null}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button><Button type="submit" form="shared-study-form" disabled={busy || !draft?.title.trim()}>{busy ? "Saving…" : draft?.scheduled ? "Plan and invite" : "Start session"}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!inviting} onOpenChange={(open) => { if (!open && !busy) setInviting(null) }}><DialogContent showCloseButton={!busy}><DialogHeader><DialogTitle>Invite to your session</DialogTitle><DialogDescription>Only selected friends receive an invitation. They choose whether to join.</DialogDescription></DialogHeader>
      {memberPicker(invitees, setInvitees, inviting?.members.map((m) => m.user_id) ?? [])}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setInviting(null)}>Cancel</Button><Button disabled={busy || !invitees.length} onClick={() => {
        if (inviting) void mutate("friend_study_invite", { p_id: inviting.id, p_members: invitees }, "Invitations sent").then((ok) => { if (ok) setInviting(null) })
      }}>{busy ? "Sending…" : "Send invitation"}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!confirmEnd} onOpenChange={(open) => { if (!open && !busy) setConfirmEnd(null) }}><DialogContent showCloseButton={!busy}><DialogHeader><DialogTitle>End {confirmEnd?.title}?</DialogTitle><DialogDescription>This ends the shared session for everyone and cancels untouched calendar plans. Recorded study and running personal timers are kept.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmEnd(null)}>Keep session</Button><Button variant="destructive" disabled={busy} onClick={() => {
      if (confirmEnd) void mutate("friend_study_end", { p_id: confirmEnd.id }, "Shared session ended").then((ok) => { if (ok) setConfirmEnd(null) })
    }}>{busy ? "Ending…" : "End session"}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
