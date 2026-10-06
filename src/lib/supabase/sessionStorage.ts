import { isTauri } from "@tauri-apps/api/core"
import type { SupportedStorage } from "@supabase/supabase-js"
import {
  hydratePreferences,
  persistPreference,
  removePreference,
} from "../storage/preferences"

function createSessionStorage(credentialKey: string): SupportedStorage {
  let cachedValue: string | null | undefined
  let operationQueue = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    async getItem(key) {
      return enqueue(async () => {
        if (!isTauri()) return localStorage.getItem(key)
        if (cachedValue !== undefined) return cachedValue
        const legacy = localStorage.getItem(key)
        const stored = await hydratePreferences([{
          key: credentialKey,
          legacyValue: legacy,
          syncable: false,
        }])
        localStorage.removeItem(key)
        cachedValue = stored.get(credentialKey) ?? null
        return cachedValue
      })
    },

    async setItem(key, value) {
      return enqueue(async () => {
        if (!isTauri()) {
          localStorage.setItem(key, value)
          return
        }
        if (cachedValue === value) return
        await persistPreference(credentialKey, value, false)
        cachedValue = value
      })
    },

    async removeItem(key) {
      return enqueue(async () => {
        if (!isTauri()) {
          localStorage.removeItem(key)
          return
        }
        if (cachedValue !== null) {
          await removePreference(credentialKey)
          cachedValue = null
        }
        localStorage.removeItem(key)
      })
    },
  }
}

export const supabaseSessionStorage = createSessionStorage("focal-supabase-auth-session")
