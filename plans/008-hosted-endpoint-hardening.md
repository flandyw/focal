# Plan 008: Rate-limit the PDF relay, add web security headers, pin push subscriptions to their owner

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If a STOP condition occurs, stop and report; do
> not improvise. Do NOT edit `plans/README.md`; the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 67a4c42..HEAD -- server/mistakes-pdf.ts server/push.ts server.ts vercel.json docs`
> If anything changed, compare the excerpts below with the live code; a mismatch is a STOP condition.

## Status

- **Priority**: P2 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: security
- **Planned at**: commit `67a4c42`, 2026-11-10

## Why this matters

1. `/api/mistakes-pdf` accepts any POST and forwards up to 100 kB of LaTeX to the public service `texlive.net`, with no limit per caller. Anyone can use Focal's hosting as a free relay (60-second functions), and texlive.net could block Focal for it. Students' mistake text leaves Focal for that third party and no doc says so.
2. The web deployment sends no anti-framing or content-sniffing headers, so the app (which holds the session in browser storage) can be framed by another site.
3. Saving a push subscription upserts on `endpoint` alone and overwrites `user_id`, so a signed-in user who knows another user's push endpoint URL can move that device's subscription to their own account.

## Current state

`server/mistakes-pdf.ts` (whole handler is 44 lines):

```ts
const COMPILER_URL = "https://texlive.net/cgi-bin/latexcgi"

export async function handleMistakesPdf(request: Request) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })
  let tex: unknown
  try {
    const text = await readRequestText(request, 1024 * 1024)
    ...
```

It is called from four hosts: `api/mistakes-pdf.ts` (Vercel), `server.ts:35` (Bun server),
`server/local.ts` (desktop sidecar, already origin-checked, single local user) and a dev plugin in
`vite.config.ts` (which builds a synthetic `Request` for `http://localhost/api/mistakes-pdf`).
Signed-out users export worksheets too, so sign-in cannot be required.

The house pattern for a limiter is in `server/chat.ts` (~:112 and ~:186):

```ts
// shortcut: limits are per server instance; use a shared rate limiter when running multiple instances.
const requests = new Map<string, { since: number; count: number }>()
...
  const now = Date.now()
  for (const [id, value] of requests) if (now - value.since >= 60_000) requests.delete(id)
  const usage = requests.get(userId) ?? { since: now, count: 0 }
  if (usage.count >= 10) { headers.set("retry-after", "60"); return fail("Too many chat requests. Try again in a minute.", 429) }
  usage.count++
  requests.set(userId, usage)
```

`vercel.json` `headers` holds only `Cache-Control` rules, e.g.:

```json
    { "source": "/", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
```

`server.ts` `serveFile` builds `new Headers({ "Cache-Control": cacheControl(pathname), "Content-Type": file.type, Vary: "Accept-Encoding" })`; its comment says "Same lifetimes as vercel.json, so the two deployments behave alike."

`index.html:25` has an inline `<script>`, so a `script-src 'self'` policy would break the web app; a full CSP is deliberately not part of this plan.

`server/push.ts` (~:118-131), the save path after auth:

```ts
    const { data: existing, error: existingError } = await db.from("push_subscriptions").select("preferences,enabled_at")
      .eq("user_id", user.id).eq("endpoint", input.endpoint).maybeSingle()
    ...
    await db.from("push_subscriptions").upsert({ user_id: user.id, endpoint: input.endpoint,
      p256dh: keys.p256dh, auth: keys.auth, planned: input.planned, friends: input.friends,
      preferences, enabled_at: existing?.enabled_at ?? new Date().toISOString() }, { onConflict: "endpoint" }).throwOnError()
```

`db` is a service-role client; `endpoint` is unique across all users (`supabase/migrations/0033_web_push.sql:6`).
A legitimate case exists: two accounts used one after another in the same browser share one endpoint;
the client then calls `clearPushForOtherAccount` (see `src/lib/pwa.ts`). Read it before step 3.

Repo rules: minimal code, no new dependencies, no new tests.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install (fresh worktree) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck + lint | `bun run check` | exit 0 (2 known warnings in `toggle.tsx`, `friends-page.tsx`) |
| Tests | `bun test` | 48 pass, 0 fail |
| Web build | `bun run build` | exit 0 |

## Scope

**In scope**: `server/mistakes-pdf.ts`, `server/push.ts`, `server.ts`, `vercel.json`, `docs/deployment.md` (one paragraph).

**Out of scope**: `server/local.ts`, `vite.config.ts`, `api/*.ts`, `server/chat.ts`, `index.html`, Supabase migrations, `src/lib/pwa.ts` (read only).

## Git workflow

Commit in your worktree, one commit per step; plain imperative sentence messages. Do not push.

## Steps

### Step 1: per-caller limit on the PDF relay

In `handleMistakesPdf`, after the method check, limit by client address using the same Map pattern
as `server/chat.ts`: key = first entry of the `x-forwarded-for` header, else `"local"`; allow 10
requests per 60 s per key; over the limit return `429` with `retry-after: 60` and the text
"Too many worksheet exports. Try again in a minute." Add the same `// shortcut:` comment as chat's
limiter. The sidecar and Vite callers have no `x-forwarded-for` and share the `"local"` bucket,
which is fine for one local user.

**Verify**: `bun run check` → exit 0. Then run this from the repo root and expect `ok`:

```sh
bun -e "import('./server/mistakes-pdf.ts').then(async (m) => { let last; for (let i = 0; i < 12; i++) last = await m.handleMistakesPdf(new Request('http://x/api/mistakes-pdf', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body: '{}' })); console.log(last.status === 429 ? 'ok' : 'fail ' + last.status) })"
```

(`body: '{}'` is rejected as an invalid worksheet with 400 before any network call, so this makes no outbound request; the limiter must count rejected requests too.)

### Step 2: anti-framing and sniffing headers

- `vercel.json`: add one `headers` entry with `"source": "/(.*)"` setting `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Keep the existing entries.
- `server.ts`: add the same four headers in `serveFile`'s `Headers` so the Bun deployment matches.
- First confirm nothing embeds the web app in a frame: `grep -rn "iframe" src docs README.md | head`. If Focal is meant to be framed (for example by Folio), STOP on this step and report.

**Verify**: `bun -e "const v=require('./vercel.json'); if(!JSON.stringify(v.headers).includes('frame-ancestors')) process.exit(1)"` → exit 0; `bun run check` → exit 0.

### Step 3: a push endpoint stays with its owner unless that owner's session moves it

Before the upsert, look up the row by `endpoint` alone. If it exists with a different `user_id`,
the caller must prove possession of the device's subscription rather than just knowing the URL:
accept the move only when the supplied `keys.p256dh` and `keys.auth` equal the stored ones (the
browser that owns the subscription always sends the same keys); otherwise return
`409` with `{ error: "This device is registered to another account. Disable reminders there first." }`.
Why this is safe (already checked by the advisor, no need to re-prove): an endpoint and its
`p256dh`/`auth` keys belong to one browser subscription and never change independently. On an
account switch `src/lib/pwa.ts` unsubscribes and subscribes again, which yields a new endpoint, so
no cross-user row exists and the check is not reached. The check is reached only when a browser
still holds the old subscription (for example its localStorage was cleared) and a second account
enables reminders; that browser sends the stored keys, so the move is allowed. A caller who only
knows the endpoint URL does not have the keys and gets the 409. Reuse the
existing lookup style (`.maybeSingle()`, `throw` on error).

**Verify**: `bun run check` → exit 0; `bun test` → 48 pass; `bun run build` → exit 0.

### Step 4: disclose the compiler

`docs/deployment.md`, Web section: one paragraph stating that worksheet PDF export sends the
worksheet's LaTeX (mistake text) to the public compiler at texlive.net through `/api/mistakes-pdf`,
that the endpoint is rate-limited per address, and that operators who need to keep content in-house
must point `COMPILER_URL` in `server/mistakes-pdf.ts` at their own compiler.

**Verify**: `grep -n "texlive" docs/deployment.md` → at least one match.

## Test plan

No new tests (repo rule). Step 1's one-liner is the behavioural check.

## Done criteria

- [ ] `bun run check`, `bun test`, `bun run build` exit 0
- [ ] Step 1 one-liner prints `ok`
- [ ] `vercel.json` parses and contains `frame-ancestors`
- [ ] `git status` shows only in-scope files

## STOP conditions

- Excerpts do not match the live code.
- The web app is designed to be embedded in a frame.
- `server/push.ts` does not have both the stored keys and the supplied keys available at the upsert (then the comparison cannot be written as described).

## Maintenance notes

- The limiter is per server instance; on Vercel each cold instance has its own counter, so it bounds abuse rather than preventing it. A shared limiter is the upgrade path.
- A full CSP for the web app needs the inline script in `index.html:25` moved or hashed and a browser to verify KaTeX, fonts and Supabase; deferred.
