import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export let supabase = !import.meta.env.VITE_EMBEDDED_EXAMS && url && key ? createClient(url, key) : null

/** The desktop host supplies its existing client and secure session storage. */
export function setSupabaseClient(client: SupabaseClient | null) {
  supabase = client
}
