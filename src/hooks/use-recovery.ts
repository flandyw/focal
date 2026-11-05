import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { AppData } from "../lib/exam-data"
import { localDate } from "../lib/learning-workspace"
import { deletedSince, recoveryCounts, saveRecovery } from "../lib/recovery"
import type { CanonicalStudySession } from "../lib/sync/sessionContract"

export function useRecovery(data: AppData, sessions: CanonicalStudySession[], owner: string | null) {
  const previous = useRef<{ data: AppData; sessions: CanonicalStudySession[]; owner: string } | null>(null)
  const latest = useRef({ data, sessions, owner })
  const queue = useRef<Promise<void>>(Promise.resolve())
  const daySaved = useRef("")
  const warned = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { latest.current = { data, sessions, owner } }, [data, sessions, owner])
  useEffect(() => {
    if (!owner) { previous.current = null; return }
    const before = previous.current?.owner === owner ? previous.current : null
    previous.current = { data, sessions, owner }
    const removed = before && deletedSince(before.data, data, before.sessions, sessions)
    const dailyKey = `${owner}:${localDate(new Date())}`
    if (!Object.values(recoveryCounts(data)).some(Boolean) && !sessions.length && !data.subjects.length && !removed) return
    if (!removed && daySaved.current === dailyKey) return
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (daySaved.current !== dailyKey) {
        const hasBefore = before && (Object.values(recoveryCounts(before.data)).some(Boolean) || before.sessions.length || before.data.subjects.length)
        await saveRecovery(owner, "backup", "Daily backup", hasBefore ? before.data : data, hasBefore ? before.sessions : sessions, true)
        daySaved.current = dailyKey
      }
      if (removed) await saveRecovery(owner, "deleted", `${removed.count} deleted record${removed.count === 1 ? "" : "s"}`, removed.data, removed.sessions)
      setError(null)
      warned.current = false
      window.dispatchEvent(new Event("focal:recovery-changed"))
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Recovery history could not be saved."
      setError(message)
      if (!warned.current) toast.error("Recovery history could not be saved", { description: "Export a backup from Settings. Your normal save and sync still work." })
      warned.current = true
    })
  }, [data, sessions, owner])

  async function backup(label = "Manual backup") {
    const snapshot = latest.current
    if (!snapshot.owner) throw new Error("Sign in to access this account’s recovery history.")
    // Chain manual backups too, so automatic pruning cannot race a restore's safety copy.
    const task = queue.current.catch(() => {}).then(() => saveRecovery(snapshot.owner!, "backup", label, snapshot.data, snapshot.sessions))
    queue.current = task
    await task
    if (latest.current.owner !== snapshot.owner) throw new Error("The account changed. Reopen recovery before continuing.")
    window.dispatchEvent(new Event("focal:recovery-changed"))
  }
  async function preserve(data: AppData, sessions: CanonicalStudySession[], count: number) {
    const owner = latest.current.owner
    if (!owner) throw new Error("Sign in before deleting so a recovery copy can be saved for this account.")
    const task = queue.current.catch(() => {}).then(() => saveRecovery(owner, "deleted", `${count} deleted record${count === 1 ? "" : "s"}`, data, sessions))
    queue.current = task
    await task
    if (latest.current.owner !== owner) throw new Error("The account changed. Reopen the record before deleting.")
    window.dispatchEvent(new Event("focal:recovery-changed"))
  }
  return { backup, preserve, error }
}
