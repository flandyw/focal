import { createClient } from "@supabase/supabase-js"
import webpush from "web-push"
import { timingSafeEqual } from "node:crypto"
import { readRequestText } from "./request.js"

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } })
type PushJob = { subscription_id: string; endpoint: string; p256dh: string; auth: string; event_key: string; body: string; path: string }

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false
  try {
    const url = new URL(value)
    // Subscription endpoints are untrusted: never let the sender reach private hosts or arbitrary URLs.
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "notify.windows.com"]
        .some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch { return false }
}

export async function handlePush(request: Request): Promise<Response> {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY
  const subject = process.env.WEB_PUSH_SUBJECT
  const configured = !!(url && key && publicKey && privateKey && subject && process.env.CRON_SECRET)
  const dispatch = new URL(request.url).searchParams.get("dispatch") === "1"
  if (request.method === "GET" && !dispatch) return json({ configured, publicKey: configured ? publicKey : null })
  if (!configured) return json({ error: "Push reminders aren’t available on this server yet." }, 503)
  const db = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    if (dispatch) {
      if (request.method !== "GET" && request.method !== "POST") return json({ error: "Method not allowed" }, 405)
      const supplied = Buffer.from(request.headers.get("authorization") ?? "")
      const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET}`)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json({ error: "Unauthorized" }, 401)
      const { data, error } = await db.rpc("push_claim")
      if (error) throw error
      const jobs = data as PushJob[]
      let sent = 0, failed = 0
      // Batches cap outbound work; leases let another run recover an interrupted invocation.
      for (let offset = 0; offset < jobs.length; offset += 10) {
        await Promise.all(jobs.slice(offset, offset + 10).map(async (job) => {
          if (!validEndpoint(job.endpoint)) {
            await db.from("push_subscriptions").delete().eq("id", job.subscription_id).throwOnError()
            return
          }
          try {
            await webpush.sendNotification({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } },
              JSON.stringify({ title: "Focal", body: job.body, tag: job.event_key, path: job.path }), {
                vapidDetails: { subject: subject!, publicKey: publicKey!, privateKey: privateKey! }, TTL: 900, timeout: 8_000,
              })
          } catch (error) {
            if ([404, 410].includes((error as { statusCode?: number }).statusCode ?? 0)) {
              await db.from("push_subscriptions").delete().eq("id", job.subscription_id).throwOnError()
            } else {
              // Without this a misconfigured VAPID key/subject just looks like a silent 503 from the scheduler.
              const { statusCode, body } = error as { statusCode?: number; body?: string }
              console.error("push send failed", new URL(job.endpoint).hostname, statusCode, body ?? String(error))
              failed++
            }
            return
          }
          await db.from("push_deliveries").update({ delivered_at: new Date().toISOString() })
            .eq("subscription_id", job.subscription_id).eq("event_key", job.event_key).throwOnError()
          sent++
        }))
      }
      return json({ sent, failed }, failed ? 503 : 200)
    }

    if (!["POST", "PUT", "DELETE"].includes(request.method)) return json({ error: "Method not allowed" }, 405)
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "")
    if (!token) return json({ error: "Sign in to enable push reminders." }, 401)
    const { data: { user }, error: authError } = await db.auth.getUser(token)
    if (authError || !user) return json({ error: "Sign in again to manage push reminders." }, 401)
    const text = await readRequestText(request, 8192)
    if (text === null) return json({ error: "Request too large" }, 413)
    let input: Record<string, unknown>
    try { input = JSON.parse(text) } catch { return json({ error: "Invalid JSON" }, 400) }
    if (!input || typeof input !== "object" || !validEndpoint(input.endpoint)) return json({ error: "Invalid push subscription" }, 400)
    if (request.method === "POST") {
      const { data, error } = await db.from("push_subscriptions").select("planned,friends")
        .eq("user_id", user.id).eq("endpoint", input.endpoint).maybeSingle()
      if (error) throw error
      return json(data)
    }
    if (request.method === "DELETE") {
      await db.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", input.endpoint).throwOnError()
      return json({ ok: true })
    }
    const keys = input.keys as Record<string, unknown> | undefined
    if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string" ||
        !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth) ||
        typeof input.planned !== "boolean" || typeof input.friends !== "boolean") return json({ error: "Invalid push subscription" }, 400)
    const { count, error: countError } = await db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", user.id)
    if (countError) throw countError
    if ((count ?? 0) >= 20) {
      const { data } = await db.from("push_subscriptions").select("id").eq("user_id", user.id).eq("endpoint", input.endpoint).maybeSingle()
      if (!data) return json({ error: "Too many devices. Disable reminders on an old device first." }, 409)
    }
    await db.from("push_subscriptions").upsert({ user_id: user.id, endpoint: input.endpoint,
      p256dh: keys.p256dh, auth: keys.auth, planned: input.planned, friends: input.friends,
      enabled_at: new Date().toISOString() }, { onConflict: "endpoint" }).throwOnError()
    return json({ ok: true })
  } catch {
    return json({ error: "Push reminders are temporarily unavailable. Try again later." }, 503)
  }
}
