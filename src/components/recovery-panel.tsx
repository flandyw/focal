import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { AppData } from "../lib/exam-data"
import { deleteRecovery, downloadRecovery, listRecovery, recoveryCounts, recoverySessionCandidates, restoreMissing, validateRecovery, type RecoveryEntry } from "../lib/recovery"
import type { CanonicalStudySession } from "../lib/sync/sessionContract"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { FieldError } from "./ui/field"
import { Label } from "./ui/label"
import { NativeSelect, NativeSelectOption } from "./ui/native-select"

export function RecoveryPanel({ owner, data, sessions, error, onBackup, onRestore }: { owner: string | null; data: AppData; sessions: CanonicalStudySession[]; error: string | null; onBackup: () => Promise<void>; onRestore: (entry: RecoveryEntry, replace: boolean) => Promise<void> }) {
  const [entries, setEntries] = useState<RecoveryEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<RecoveryEntry | null>(null)
  const [replace, setReplace] = useState(false)
  const [forgetting, setForgetting] = useState<RecoveryEntry | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1)
    window.addEventListener("focal:recovery-changed", refresh)
    return () => window.removeEventListener("focal:recovery-changed", refresh)
  }, [])
  useEffect(() => {
    if (!owner) return
    let active = true
    void listRecovery(owner).then((entries) => { if (active) { setEntries(entries); setLoadError(null); setLoading(false) } }).catch((error: unknown) => { if (active) { setLoadError(error instanceof Error ? error.message : "Could not load recovery history."); setLoading(false) } })
    return () => { active = false }
  }, [owner, revision])
  async function run(action: () => Promise<void>) {
    setBusy(true); setActionError(null)
    try { await action(); setRevision((value) => value + 1) }
    catch (error) { setActionError(error instanceof Error ? error.message : "Could not complete that action.") }
    finally { setBusy(false) }
  }
  const current = recoveryCounts(data)
  const restored = selected ? recoveryCounts(replace ? selected.data : restoreMissing(data, selected.data)) : null
  const changes = restored && Object.entries(restored).filter(([key, value]) => value > current[key as keyof typeof current])
  const sessionCount = selected ? recoverySessionCandidates(selected, sessions).length : 0
  return <div className="grid gap-4 border-t py-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">Recovery history</h3><p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">Stored on this device for this account. Keeps 14 dated backups and up to 100 deletion groups for 30 days. Export backups to keep a separate copy.</p></div><Button variant="outline" disabled={!owner || busy} onClick={() => void run(async () => { await onBackup(); toast.success("Dated backup saved") })}>Back up now</Button></div>
    <FieldError>{error ?? loadError ?? actionError}</FieldError>
    {!owner ? <p className="text-sm text-muted-foreground">Sign in to view recovery history for your account.</p> : loading ? <p role="status" className="text-sm text-muted-foreground">Loading recovery history…</p> : <>
      {(["deleted", "backup"] as const).map((kind) => <section key={kind} className="grid gap-2" aria-label={kind === "deleted" ? "Recently deleted" : "Dated backups"}>
        <h4 className="text-sm font-medium">{kind === "deleted" ? "Recently deleted" : "Dated backups"}</h4>
        {!entries.some((entry) => entry.kind === kind) ? <p className="text-sm text-muted-foreground">{kind === "deleted" ? "Deleted records will appear here." : "Your first backup will appear here."}</p> : <ul className="divide-y">
          {entries.filter((entry) => entry.kind === kind).map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-2 py-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{entry.label}</p><p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("en-AU")}</p>{kind === "deleted" ? <p className="mt-1 text-xs text-muted-foreground">{[entry.data.attempts[0]?.title, entry.data.mistakes[0]?.question, entry.data.sacRecords[0]?.title, entry.data.events[0]?.title, entry.data.learning.tasks[0]?.title, entry.data.learning.curriculumAreas[0]?.name, entry.data.learning.goals[0] && "Score goal", entry.sessions[0]?.title].filter(Boolean).join(" · ")}</p> : null}</div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { try { setSelected(validateRecovery(entry)); setReplace(false); setActionError(null) } catch (error) { setActionError(error instanceof Error ? error.message : "Could not read this copy.") } }}>Preview restore</Button>
            {kind === "backup" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await downloadRecovery(validateRecovery(entry)); toast.success("Backup exported") })}>Export</Button> : null}
            <Button size="sm" variant="ghost" disabled={busy} aria-label={`Permanently remove ${entry.label} from ${new Date(entry.createdAt).toLocaleString("en-AU")}`} onClick={() => setForgetting(entry)}>Remove copy</Button>
          </li>)}
        </ul>}
      </section>)}
    </>}
    <Dialog open={!!selected} onOpenChange={(open) => { if (!open && !busy) setSelected(null) }}>
      <DialogContent><DialogHeader><DialogTitle>{replace ? "Restore this backup?" : "Restore missing records?"}</DialogTitle><DialogDescription>{replace ? "This replaces app records, results, subjects and preferences with this backup. Existing study sessions are kept." : "Existing records and settings stay as they are."} A safety backup is saved first. Timers are not restarted; saved time blocks are recovered as regular study sessions with new IDs.</DialogDescription></DialogHeader>
        {selected?.kind === "backup" ? <div className="grid gap-2"><Label htmlFor="recovery-mode">Restore mode</Label><NativeSelect id="recovery-mode" disabled={busy} value={replace ? "replace" : "missing"} onChange={(event) => setReplace(event.target.value === "replace")}><NativeSelectOption value="missing">Restore missing records</NativeSelectOption><NativeSelectOption value="replace">Replace app data with this backup</NativeSelectOption></NativeSelect></div> : null}
        {replace && restored ? <table className="w-full text-left text-sm tabular-nums"><thead><tr><th className="py-1 font-medium">Records</th><th className="py-1 font-medium">Now</th><th className="py-1 font-medium">After restore</th></tr></thead><tbody>{Object.entries(restored).map(([key, value]) => <tr key={key}><th className="py-1 font-normal">{key}</th><td>{current[key as keyof typeof current]}</td><td>{value}</td></tr>)}</tbody></table> : <ul className="grid gap-2 text-sm">{changes?.map(([key, value]) => <li key={key}>{value - current[key as keyof typeof current]} {value - current[key as keyof typeof current] === 1 ? key.replace(/s$/, "") : key}</li>)}</ul>}
        {sessionCount ? <p className="text-sm">{sessionCount} study session{sessionCount === 1 ? "" : "s"} to recover</p> : null}
        {!replace && !changes?.length && !sessionCount ? <p className="text-sm text-muted-foreground">All records in this copy are already present.</p> : null}
        <FieldError>{actionError}</FieldError>
        <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button><Button disabled={busy || !selected || (!replace && !changes?.length && !sessionCount)} onClick={() => void run(async () => { await onRestore(selected!, replace); setSelected(null); toast.success(replace ? "Backup restored" : "Missing records restored") })}>{busy ? "Restoring…" : replace ? "Back up and replace" : "Restore missing records"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!forgetting} onOpenChange={(open) => { if (!open && !busy) setForgetting(null) }}><DialogContent><DialogHeader><DialogTitle>Permanently remove this recovery copy?</DialogTitle><DialogDescription>Your current data stays as it is. This copy will no longer be available for recovery.</DialogDescription></DialogHeader><FieldError>{actionError}</FieldError><DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setForgetting(null)}>Keep copy</Button><Button variant="destructive" disabled={busy} onClick={() => void run(async () => { await deleteRecovery(owner!, forgetting!.id); setForgetting(null) })}>Remove copy</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
