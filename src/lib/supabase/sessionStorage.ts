import { isTauri } from "@tauri-apps/api/core"
import type { SupportedStorage } from "@supabase/supabase-js"
import { CHATGPT_ENDPOINT } from "../host"
import {
  hydratePreferences,
  persistPreference,
  removePreference,
} from "../storage/preferences"

const ENCRYPTED_PREFIX = "encrypted:v1:"

async function protectSession(operation: "encrypt" | "decrypt", value: string): Promise<string> {
  const response = await fetch(`${CHATGPT_ENDPOINT}/supabase-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, value }),
  })
  if (!response.ok) throw new Error("Account session storage is unavailable. Unlock your OS credential store and try again.")
  const result: unknown = await response.json()
  if (!result || typeof result !== "object" || !("value" in result) || typeof result.value !== "string") throw new Error("Invalid account session storage response.")
  return result.value
}

function createSessionStorage(credentialKey: string): SupportedStorage {
  const cachedValues = new Map<string, string | null>()
  // Keep the historical session row; auth-code verifiers and user records need separate rows.
  const preferenceKey = (key: string) => key.endsWith("-auth-token") ? credentialKey : `${credentialKey}:${key}`
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
        if (cachedValues.has(key)) return cachedValues.get(key)!
        const storedKey = preferenceKey(key)
        const legacy = localStorage.getItem(key)
        const stored = await hydratePreferences([{
          key: storedKey,
          legacyValue: null,
          syncable: false,
        }])
        const value = stored.get(storedKey) ?? legacy
        let cachedValue: string | null
        if (value?.startsWith(ENCRYPTED_PREFIX)) {
          cachedValue = await protectSession("decrypt", value.slice(ENCRYPTED_PREFIX.length))
        } else if (value !== null) {
          await persistPreference(storedKey, ENCRYPTED_PREFIX + await protectSession("encrypt", value), false)
          cachedValue = value
        } else cachedValue = null
        localStorage.removeItem(key)
        cachedValues.set(key, cachedValue)
        return cachedValue
      })
    },

    async setItem(key, value) {
      return enqueue(async () => {
        if (!isTauri()) {
          localStorage.setItem(key, value)
          return
        }
        if (cachedValues.get(key) === value) return
        await persistPreference(preferenceKey(key), ENCRYPTED_PREFIX + await protectSession("encrypt", value), false)
        cachedValues.set(key, value)
      })
    },

    async removeItem(key) {
      return enqueue(async () => {
        if (!isTauri()) {
          localStorage.removeItem(key)
          return
        }
        if (cachedValues.get(key) !== null) {
          await removePreference(preferenceKey(key))
          cachedValues.set(key, null)
        }
        localStorage.removeItem(key)
      })
    },
  }
}

export const supabaseSessionStorage = createSessionStorage("focal-supabase-auth-session")
