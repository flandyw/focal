// Plumbing shared by the two durable outboxes: app rows (app-sync.ts) and study-session
// commands (study-session-sync.ts). Storage and conflict rules differ; delivery rules do not.

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Local outbox request failed"))
  })
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("Local outbox transaction failed"))
  })
}

/**
 * What a failed RPC means for the queued write behind it.
 *  - retry:  the network or server is unwell. Keep the write, back off.
 *  - hold:   the account is not usable right now (expired token, wrong identity). Keep the
 *            write and try again when the session is back; never count it against the write.
 *  - reject: the server read the write and refused it for good. Retrying cannot change that.
 * Only a plain 400/409/413/422 is a reject. A 404 (migration not applied yet) or any other
 * surprise is a deployment problem, and the user's data must outlive it.
 */
export type Failure = "retry" | "hold" | "reject"

export function classifyFailure(status: number | undefined, error: { code?: string }): Failure {
  if (status === 401 || error.code === "28000" || error.code === "42501" || error.code === "PGRST301") return "hold"
  return status === 400 || status === 409 || status === 413 || status === 422 ? "reject" : "retry"
}

/** Exponential backoff with jitter, capped at a minute. */
export const backoffMs = (attempts: number) =>
  Math.round(Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)) * (0.75 + Math.random() / 2))

const chains = new Map<string, Promise<unknown>>()

/**
 * One flusher per name across every tab and window. It waits its turn instead of skipping, so a
 * tab that queued something while another was draining still gets it sent.
 * ponytail: without Web Locks the lock is per tab only; the server's receipts keep two tabs
 * from double-applying, so the cost is a duplicate request, not a duplicate write.
 */
export function withFlushLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(name, run)
  const next = (chains.get(name) ?? Promise.resolve()).catch(() => {}).then(run)
  chains.set(name, next)
  return next
}

/** Runs one pass at a time per tab. A trigger that lands mid-pass earns one more pass, so no wakeup is lost. */
export function coalesced(run: () => Promise<void>): () => Promise<void> {
  let current: Promise<void> | null = null
  let again = false
  return () => {
    if (current) { again = true; return current }
    current = (async () => {
      do { again = false; await run() } while (again)
    })().finally(() => { current = null })
    return current
  }
}

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("focal-outbox")

/** Tell the other tabs that the outbox changed. A channel never echoes to its own sender. */
export const announce = () => channel?.postMessage("changed")

export function onAnnounce(listener: () => void): () => void {
  channel?.addEventListener("message", listener)
  return () => channel?.removeEventListener("message", listener)
}
