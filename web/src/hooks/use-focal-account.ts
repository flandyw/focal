import { useEffect, useMemo, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { focalSupabase } from "@/lib/focal-supabase"

export function useFocalAccount() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(focalSupabase))

  useEffect(() => {
    if (!focalSupabase) return
    let cancelled = false
    void focalSupabase.auth.getUser().then(({ data }) => {
      if (!cancelled) {
        setUser(data.user)
        setLoading(false)
      }
    })
    const { data: { subscription } } = focalSupabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return useMemo(() => ({
    configured: Boolean(focalSupabase),
    user,
    loading,
    signIn: async (email: string, password: string) => {
      if (!focalSupabase) throw new Error("Focal integration is not configured.")
      setLoading(true)
      try {
        const { error } = await focalSupabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } finally {
        setLoading(false)
      }
    },
    signOut: async () => {
      if (!focalSupabase) return
      setLoading(true)
      try {
        const { error } = await focalSupabase.auth.signOut()
        if (error) throw error
      } finally {
        setLoading(false)
      }
    },
  }), [loading, user])
}
