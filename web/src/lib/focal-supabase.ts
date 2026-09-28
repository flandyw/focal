import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_FOCAL_SUPABASE_URL
const key = import.meta.env.VITE_FOCAL_SUPABASE_PUBLISHABLE_KEY

function isSecureEndpoint(value: string | undefined): boolean {
  if (!value) return false
  try {
    const endpoint = new URL(value)
    return endpoint.protocol === "https:" || (
      endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
    )
  } catch {
    return false
  }
}

export const focalSupabase = isSecureEndpoint(url) && key
  ? createClient(url, key, {
      auth: {
        storageKey: "examtrack-focal-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null
