import { createContext } from "react"
import { z } from "zod"
import { CHAT_ENDPOINT, chatHeaders } from "./gateway-client"

export type OverviewArea = "today" | "mistakes" | "subject" | "progress" | "exams"

const actionSchema = z.object({
  label: z.string().min(1).max(40),
  kind: z.enum(["open", "review", "focus"]),
  view: z.enum(["today", "calendar", "exams", "library", "mistakes", "focus", "stoplight", "sacs", "goals", "progress", "predictor", "vcaa"]).optional(),
  subject: z.string().max(200).optional(),
  intent: z.string().max(80).optional(),
})
export type OverviewAction = z.infer<typeof actionSchema>
const overviewSchema = z.object({
  headline: z.string().max(160), body: z.string().max(600),
  // Drop malformed actions instead of the whole overview.
  actions: z.array(z.unknown()).transform((items) => items.flatMap((item) => {
    const action = actionSchema.safeParse(item)
    return action.success && (action.data.kind !== "open" || action.data.view) ? [action.data] : []
  })),
  model: z.string(), createdAt: z.number(),
})
export type Overview = z.infer<typeof overviewSchema>

/** App supplies the account and how each suggested action is carried out. */
export const AIOverviewContext = createContext<{ userId?: string; onAction: (action: OverviewAction) => void }>({ onAction: () => {} })

const SETTINGS_KEY = "focal:ai-overviews:v1"
export type OverviewSettings = { enabled: boolean; model: string }

export function loadOverviewSettings(): OverviewSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<OverviewSettings>
    return { enabled: saved.enabled !== false, model: typeof saved.model === "string" ? saved.model : "" }
  } catch { return { enabled: true, model: "" } }
}

export function saveOverviewSettings(settings: OverviewSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* Settings still apply for this session. */ }
  window.dispatchEvent(new Event("focal:ai-overviews"))
}

/** A cached overview, or a reason not to ask again today (no key, failure backoff). */
type Entry = { day: string; fingerprint: string; at: number; overview?: Overview; blockedUntil?: number; error?: string }
const cacheKey = (userId: string, area: OverviewArea, subject: string) => `focal:ai-overview:${userId}:${area}:${subject}`

export function readOverview(userId: string, area: OverviewArea, subject: string): Entry | null {
  try {
    const entry = JSON.parse(localStorage.getItem(cacheKey(userId, area, subject)) ?? "null") as Entry | null
    return entry && (!entry.overview || overviewSchema.safeParse(entry.overview).success) ? entry : null
  } catch { return null }
}

/** Forget every cached overview and failure backoff for this account; each page writes a fresh one next time it opens. */
export function clearOverviews(userId: string) {
  try {
    const prefix = `focal:ai-overview:${userId}:`
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key)
  } catch { /* Nothing cached to clear. */ }
}

function writeOverview(userId: string, area: OverviewArea, subject: string, entry: Entry) {
  try { localStorage.setItem(cacheKey(userId, area, subject), JSON.stringify(entry)) } catch { /* Overviews still show; they just regenerate sooner. */ }
}

const STALE_AFTER = 4 * 3_600_000
/** Regenerate once per local day, or sooner only when the page's data changed and the overview is a few hours old. */
export function needsRefresh(entry: Entry | null, day: string, fingerprint: string, now = Date.now()) {
  if (!entry) return true
  if (entry.blockedUntil && now < entry.blockedUntil) return false
  if (!entry.overview) return true
  return entry.day !== day || (entry.fingerprint !== fingerprint && now - entry.at > STALE_AFTER)
}

const inflight = new Map<string, Promise<Entry>>()

export function generateOverview(userId: string, area: OverviewArea, subject: string, model: string, day: string, fingerprint: string): Promise<Entry> {
  const key = cacheKey(userId, area, subject)
  const running = inflight.get(key)
  if (running) return running
  const previous = readOverview(userId, area, subject)
  const request = (async () => {
    let entry: Entry
    try {
      if (!CHAT_ENDPOINT) throw new Error("Overviews are not connected.")
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { ...await chatHeaders(userId), "content-type": "application/json" },
        body: JSON.stringify({ area, subject, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(model ? { model } : {}) }),
      })
      // A daily limit (429) won't lift soon and a missing key (409) needs Settings; other failures retry in a few minutes.
      if (!response.ok) {
        const text = await response.text().catch(() => "")
        entry = {
          day: "", fingerprint, at: 0, ...previous,
          blockedUntil: Date.now() + (response.status === 429 ? 12 * 3_600_000 : response.status === 409 ? 3_600_000 : 5 * 60_000),
          // A missing key stays silent: overviews are on by default for accounts that never set one up.
          error: response.status === 409 ? undefined : text && text.length < 200 ? text : "Could not write an overview right now.",
        }
      } else entry = { day, fingerprint, at: Date.now(), overview: overviewSchema.parse(await response.json()) }
    } catch {
      entry = { day: "", fingerprint, at: 0, ...previous, blockedUntil: Date.now() + 5 * 60_000, error: "Could not reach the overview service." }
    }
    writeOverview(userId, area, subject, entry)
    return entry
  })().finally(() => inflight.delete(key))
  inflight.set(key, request)
  return request
}
