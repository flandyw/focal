import { createClient } from "@supabase/supabase-js"
import { supabaseConfig } from "../supabase"
import { supabaseSessionStorage } from "./sessionStorage"

export const supabase = supabaseConfig
  ? createClient(supabaseConfig.url, supabaseConfig.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: supabaseSessionStorage,
    },
  })
  : null
