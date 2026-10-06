import { createClient } from "@supabase/supabase-js"
import { supabaseSessionStorage } from "./sessionStorage"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

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

export const isSupabaseConfigured = Boolean(isSecureEndpoint(supabaseUrl) && supabasePublishableKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: supabaseSessionStorage,
    },
  })
  : null
