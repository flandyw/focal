import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export function isSecureEndpoint(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" || (
      url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  } catch {
    return false
  }
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** Shared by the browser client and the desktop client; null when unset or insecure. */
export const supabaseConfig = isSecureEndpoint(url) && key ? { url: url!, key } : null

// Capture recovery intent before the SDK consumes the callback URL.
const authHash = new URLSearchParams(typeof window === "undefined" ? "" : window.location.hash.slice(1))
export const passwordRecoveryRequested = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).has("reset-password")
  || authHash.get("type") === "recovery" || authHash.has("error")

export let supabase = !import.meta.env.VITE_DESKTOP && supabaseConfig ? createClient(supabaseConfig.url, supabaseConfig.key) : null

/** The desktop host supplies its client with secure session storage. */
export function setSupabaseClient(client: SupabaseClient | null) {
  supabase = client
}

/** Both outboxes retain their owner and their writes while Auth reconnects. */
export async function withSupabaseSession<T extends { status: number; error: { code?: string } | null }>(
  accountId: string, request: () => PromiseLike<T>,
): Promise<T> {
  if (!supabase) throw new Error("Cloud sync is not configured.")
  const auth = supabase.auth
  const session = await auth.getSession()
  if (session.error) {
    window.dispatchEvent(new Event([400, 401, 422].includes(session.error.status ?? 0) ? "focal:auth-required" : "focal:auth-reconnecting"))
    throw Object.assign(new Error("Focal login is reconnecting."), { code: "28000", cause: session.error })
  }
  if (session.data.session?.user.id !== accountId) {
    // A different current account is not an expired login. The server also pins the RPC owner.
    if (!session.data.session) window.dispatchEvent(new Event("focal:auth-required"))
    throw Object.assign(new Error("Sign in to the account that owns these changes."), { code: "28000" })
  }
  const result = await request()
  if (result.status !== 401 && !["PGRST301", "PGRST303"].includes(result.error?.code ?? "")) return result
  // The SDK deduplicates exchanges. Reuse a token another lane has already refreshed.
  const current = await auth.getSession()
  const refreshed = current.data.session && current.data.session.access_token !== session.data.session.access_token && !current.error
    ? current : await auth.refreshSession()
  if (refreshed.error || !refreshed.data.session) {
    window.dispatchEvent(new Event(refreshed.error && refreshed.error.status !== 400 && refreshed.error.status !== 401 && refreshed.error.status !== 422
      ? "focal:auth-reconnecting" : "focal:auth-required"))
    throw Object.assign(new Error("Focal login needs attention."), { code: "28000", cause: refreshed.error })
  }
  if (refreshed.data.session.user.id !== accountId) throw Object.assign(new Error("The Focal account changed."), { code: "28000" })
  // A 401 did not apply the request. Keep its original mutation ID for the retry.
  return request()
}
