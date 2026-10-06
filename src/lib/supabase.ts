import { createClient, type SupabaseClient } from "@supabase/supabase-js"

function isSecureEndpoint(value: string | undefined): boolean {
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

export let supabase = !import.meta.env.VITE_DESKTOP && supabaseConfig ? createClient(supabaseConfig.url, supabaseConfig.key) : null

/** The desktop host supplies its client with secure session storage. */
export function setSupabaseClient(client: SupabaseClient | null) {
  supabase = client
}
