import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { setSyncSession, subscribeSyncStatus } from "@/lib/sync/engine"
import { EMPTY_METRICS, type SyncStatusSnapshot } from "@/lib/sync/types"

const INITIAL_STATUS: SyncStatusSnapshot = {
  status: "signed-out",
  pendingCount: 0,
  error: null,
  lastSuccessfulSyncAt: null,
  details: null,
  tableStats: null,
  failedItems: null,
  conflicts: null,
  isOnline: true,
  metrics: EMPTY_METRICS,
}

export function useSupabaseSync(session: Session | null) {
  const [status, setStatus] = useState<SyncStatusSnapshot>(INITIAL_STATUS)

  useEffect(() => {
    return subscribeSyncStatus(setStatus)
  }, [])

  useEffect(() => {
    void setSyncSession(session)
  }, [session])

  return status
}

