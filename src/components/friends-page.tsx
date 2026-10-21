import { useCallback, useEffect, useState } from "react"
import { Copy, UserPlus, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { PageHeader } from "./page-header"
import { WorkspacePage } from "./workspace-layout"
import { useTickingNow } from "../hooks/use-ticking-now"
import { supabase } from "../lib/supabase"

type SharedExam = { subject: string | null; title: string | null; rawScore: number | null; rawMax: number | null; completedAt: string | null }
type Person = {
  user_id: string
  display_name: string
  status: "me" | "friend" | "incoming" | "outgoing"
  studying_since: string | null
  studying_subject: string | null
  studying_kind: string | null
  total_ms: number
  week_ms: number
  exams: SharedExam[] | null
}
type Profile = { code: string; display_name: string; share_exams: boolean }

const hours = (ms: number) => `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms / 60_000) % 60}m`
const percent = (exam: SharedExam) => exam.rawScore != null && exam.rawMax ? `${Math.round(exam.rawScore / exam.rawMax * 100)}%` : "—"

export function FriendsPage({ signedIn, onSignIn }: { signedIn: boolean; onSignIn: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const now = useTickingNow(30_000)

  const load = useCallback(async () => {
    if (!signedIn) return
    const { data, error } = await supabase!.rpc("friends_list")
    if (error) toast.error("Could not load friends.")
    else setPeople(data as Person[])
  }, [signedIn])

  useEffect(() => {
    if (!signedIn) return
    void supabase!.rpc("friends_me").single<Profile>().then(({ data, error }) => {
      if (error) return toast.error("Could not load your friend profile.")
      setProfile(data)
      setName(data.display_name)
    })
  }, [signedIn])
  // shortcut: live status refreshes on a 30 s poll (and when the tab returns), not realtime; push via a broadcast channel if that lag matters.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load, now])

  async function call(fn: string, args: Record<string, unknown>, failure: string) {
    const { error } = await supabase!.rpc(fn, args)
    if (error) { toast.error(error.message || failure); return false }
    void load()
    return true
  }

  async function saveProfile(next: Profile) {
    if (await call("friends_update_profile", { p_display_name: next.display_name, p_share_exams: next.share_exams }, "Could not save your profile.")) setProfile(next)
  }

  if (!signedIn) {
    return (
      <WorkspacePage>
        <PageHeader title="Friends" description="See when friends are studying and compare study time. Friends need a Focal account." />
        <div><Button onClick={onSignIn}>Sign in to add friends</Button></div>
      </WorkspacePage>
    )
  }

  const board = people.filter((person) => person.status === "me" || person.status === "friend")
  const requests = people.filter((person) => person.status === "incoming" || person.status === "outgoing")
  const shared = board.filter((person) => person.exams?.length && (person.status === "friend" || profile?.share_exams))

  return (
    <WorkspacePage>
      <PageHeader title="Friends" description="See who is studying right now and how your study time compares. Exam results are shown only by people who choose to share them." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Your profile</CardTitle><CardDescription>Friends see your name, live study and study time. Your email is never shown.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (profile) void saveProfile({ ...profile, display_name: name.trim() }) }}>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Display name" aria-label="Display name" maxLength={40} />
              <Button type="submit" variant="outline" disabled={!profile || name.trim() === profile.display_name}>Save</Button>
            </form>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={profile?.share_exams ?? false} disabled={!profile} onChange={(event) => { if (profile) void saveProfile({ ...profile, share_exams: event.target.checked }) }} />
              Share my recent exam results with friends
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Your friend code</span>
              <code className="font-mono tracking-wider">{profile?.code ?? "…"}</code>
              {profile ? <Button variant="ghost" size="icon-sm" aria-label="Copy friend code" onClick={() => void navigator.clipboard.writeText(profile.code).then(() => toast.success("Friend code copied"))}><Copy /></Button> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Add a friend</CardTitle><CardDescription>Enter their friend code. You become friends once they add you back or accept.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void call("friends_add", { p_code: code }, "Could not add that friend.").then((ok) => { if (ok) { setCode(""); toast.success("Friend request sent") } }) }}>
              <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Friend code" aria-label="Friend code" maxLength={8} autoCapitalize="characters" spellCheck={false} required />
              <Button type="submit"><UserPlus />Add</Button>
            </form>
            {requests.map((person) => (
              <div key={person.user_id} className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
                <span className="min-w-0 truncate">{person.display_name} <span className="text-muted-foreground">· {person.status === "incoming" ? "wants to be friends" : "request sent"}</span></span>
                <div className="flex gap-2">
                  {person.status === "incoming" ? <Button size="sm" onClick={() => void call("friends_accept", { p_user_id: person.user_id }, "Could not accept the request.")}>Accept</Button> : null}
                  <Button size="sm" variant="outline" onClick={() => void call("friends_remove", { p_user_id: person.user_id }, "Could not update the request.")}>{person.status === "incoming" ? "Decline" : "Cancel"}</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Leaderboard</CardTitle><CardDescription>Ranked by study time in the last 7 days.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Name</TableHead><TableHead>Now</TableHead><TableHead className="text-right">7 days</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="w-10"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {board.map((person, index) => (
                <TableRow key={person.user_id}>
                  <TableCell className="tabular-nums text-muted-foreground">{index + 1}</TableCell>
                  <TableCell className="font-medium">{person.display_name}{person.status === "me" ? <span className="text-muted-foreground"> (you)</span> : null}</TableCell>
                  <TableCell>{person.studying_since
                    ? <Badge>Studying{person.studying_subject ? ` ${person.studying_subject}` : person.studying_kind === "exam" ? " an exam" : ""} · {hours(Math.max(0, now.getTime() - new Date(person.studying_since).getTime()))}</Badge>
                    : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{hours(person.week_ms)}</TableCell>
                  <TableCell className="text-right tabular-nums">{hours(person.total_ms)}</TableCell>
                  <TableCell>{person.status === "friend" ? <Button variant="ghost" size="icon-sm" aria-label={`Remove ${person.display_name}`} onClick={() => { if (window.confirm(`Remove ${person.display_name} from your friends?`)) void call("friends_remove", { p_user_id: person.user_id }, "Could not remove this friend.") }}><X /></Button> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {board.length < 2 ? <p className="pt-4 text-sm text-muted-foreground">Share your friend code to start a leaderboard.</p> : null}
        </CardContent>
      </Card>

      {shared.length ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {shared.map((person) => (
            <Card key={person.user_id}>
              <CardHeader><CardTitle>{person.status === "me" ? "Your" : `${person.display_name}'s`} recent exams</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {person.exams!.map((exam, index) => (
                  <div key={index} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{exam.subject} · {exam.title}</span>
                    <span className="shrink-0 tabular-nums">{percent(exam)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </WorkspacePage>
  )
}
