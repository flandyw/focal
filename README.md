# Focal

Focal uses one React frontend in `src` for the browser and desktop. Tauri packages that frontend locally and adds the ChatGPT sidecar, secure account storage, native export dialogs, and external-link handling. Desktop uses the same navigation, settings, calendar, exams, mistakes, and study timer as the web app.

The former desktop assessment/project workspace and academic inbox have been removed. Existing SQLite data and coursework files are not deleted. Synced study sessions remain available through the shared account. Desktop Progress also reads local-only study history from the existing SQLite database without rewriting it.

Progress is available in both apps under Analysis. It includes the transferred study-time trend, subject breakdown, completion, confidence, time-of-day, and consistency graphs, with date ranges, subject filters, period comparisons, and CSV export. Confidence graphs use recorded reflections rather than inferred confidence.

## Planned study across Focal and Folio

Plan study from the calendar or Study timer, with a subject, notes, topics and up
to 100 non-overlapping blocks (each up to 24 hours). The timer lists all, today,
overdue and upcoming plans, with search, edit, duplicate, delete and quick
rescheduling. Folio supports the same plan fields and management actions in its
Study screen and sessions panel; its editor timer can start those shared plans.

Starting from a calendar block now runs that session's ID, rather than creating
another session with a copied title. Scheduled intervals are replaced by measured
work intervals, while the original schedule stays in metadata as a duration goal.
Pauses never count. Finish explicitly when done; reaching the goal does not stop
the timer. Focal's timer can resume or finish sessions started in Folio too.

Plans and lifecycle actions work locally when signed out. Signed in, commands are
committed to the existing IndexedDB outbox before delivery, and queued lifecycle
changes immediately appear in the shared list. The last canonical account-specific
session list is cached in IndexedDB for offline reopening. Pending starts, pauses
and resumes retain order; account changes and edits based on an outdated revision
are rejected. Folio retains a refused plan draft for explicit review and resaving.
No new Supabase migration or notebook format is required.

Manual verification: create a multi-block plan, edit/duplicate/reschedule it, start
it from the calendar and timer, pause/resume, reload, and finish. Verify the ID,
subject, notes, topics and original schedule survive, and only measured time is
recorded. Repeat signed out and signed in offline; reconnect both clients and
verify one shared session. Edit the same plan on another device while its editor
is open and verify a stale save is refused. Test a phone-width timer and editor.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Shared frontend, study/timetable contracts, progress graphs, and desktop integration |
| `src-tauri/` | Native desktop shell and ChatGPT sidecar lifecycle |
| `server/`, `vendor/siwc/` | Local Sign in with ChatGPT service |
| `supabase/migrations/` | Shared account and data schema |

## Development

Run `bun install` from the repository root. Web and desktop share one root package and `bun.lock`.

```sh
bun run dev                 # Browser frontend on port 5173
bun run dev:desktop         # Desktop frontend on port 1420
bun run tauri dev           # Desktop shell, local AI sidecar, and shared frontend
bun run build               # Typecheck and build the browser frontend
bun run build:desktop       # Typecheck and build the desktop frontend
bun run check               # Typecheck and lint shared frontend and scripts
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in root `.env.local` for either build. Never expose a service-role key to the frontend. Apply the existing Supabase migrations before running connected clients.

Friends comparisons and cheers require migration `0031_friends_competition.sql`. Study activity is visible only to accepted friends; subject details and exam results follow each person's sharing settings. Cheers are private between the sender and recipient, with one cheer per friend every 24 hours.

Friends usernames and private nicknames require `0037_friend_usernames.sql`. Apply it before deploying the updated frontend. Users can change their unique @username in Friends and set a nickname in a friend's details; nicknames are visible only to their owner. Existing friendships, sharing preferences and legacy friend codes are preserved.

The historical `examtrack` storage keys and protocol identifiers remain unchanged for compatibility with saved data and Folio. See [the sync protocol](docs/sync-protocol.md) and [the historical ExamTrack migration](docs/examtrack-merge.md).

## Mobile installation and Web Push

Open **Settings > Mobile app** for installation instructions and **Settings > Notifications**
for per-device reminder controls on web and desktop.
On iPhone/iPad, install Focal with **Share > Add to Home Screen**, launch its icon,
then enable reminders (iOS/iPadOS 16.4+). Android browsers offer **Install app** or
**Add to Home screen** in their menu. Installation requires HTTPS, except localhost
for development. The service worker handles notifications; it does not cache the
app for offline loading.

Signed-in users can opt into planned study, calendar deadlines and SACs, a daily
study nudge, friends starting study, and received cheers. Each type has its own
switch. Plans made in Folio are included once synced. Planned blocks support 0–60
minutes of notice; deadlines support same-day, 1-, 3-, or 7-day notice at the
chosen daily time (or the deadline's start if earlier on the same day). Started,
completed and cancelled study is skipped. Text is generic, without subject
names, study titles, or friend names. Subscriptions are per browser installation;
signing out or switching accounts revokes the previous account’s subscription.
Quiet hours use the saved device timezone and skip alerts rather than queueing
them; identical start and end times mute the whole day. New deadline and daily
reminders default off. Focus, break, exam reading, exam writing and SAC time-up
alerts have separate controls. Focus and break alerts also follow **Study timer >
Pomodoro settings > Alerts and flow > Notifications** and need the Study timer page
open. Timed-paper and SAC alerts work on any page. All timer alerts need the app
running and may be delayed by browser background suspension.

Desktop uses Tauri's notification plugin. Synced study and friend reminders are
checked every 30 seconds while Focal is running or minimized; they require sign-in,
internet access and migration `0036_notification_preferences.sql`. Timer alerts
work without an account. Closing the desktop app stops alerts. The test button
bypasses quiet hours. Native delivery still needs verification on packaged macOS,
Windows and Linux builds.

To activate closed-app push:

1. Apply the Supabase migrations in order, including `0033_web_push.sql`,
   `0034_web_push_wakeup.sql` and `0036_notification_preferences.sql`, before deploying
   the updated push server. Existing subscription choices are preserved.
2. Generate a persistent VAPID pair with `bunx web-push generate-vapid-keys --json`.
   Set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` on the
   server, together with the existing Supabase URL and service-role key.
   The subject must be a real `mailto:` address or public HTTPS contact URL.
   Keep the private key stable and server-only; changing keys requires devices to
   disable and re-enable reminders.
3. Set a private random `CRON_SECRET` on the server. Configure a scheduler to call
   `GET` or `POST /api/push?dispatch=1` once a minute over HTTPS, with an
   `Authorization: Bearer <CRON_SECRET>` header. Never put the secret in the URL.
   Vercel Pro can use a cron entry with path `/api/push?dispatch=1` and schedule
   `* * * * *`; Vercel sends `CRON_SECRET` automatically. Vercel Hobby only permits
   daily cron, so use an external scheduler or Supabase Cron instead.
4. Deploy and enable reminders from the installed app. Delivery begins with events
   after enabling that device. Allow notifications in the OS and browser settings.

For Supabase Cron, enable `pg_cron` and `pg_net` in the dashboard. Save the same
cron secret in Vault as `focal_push_cron_secret`, then schedule this SQL (replace
the example origin with the deployed Focal origin):

```sql
select cron.schedule('focal-web-push', '* * * * *', $$
  select net.http_post(
    url := 'https://your-focal.example/api/push?dispatch=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'focal_push_cron_secret'
    )),
    body := '{}'::jsonb
  );
$$);
```

Migration `0034_web_push_wakeup.sql` also calls the dispatcher straight from the
database when a friend starts studying or sends a cheer, so those alerts arrive in
seconds instead of on the next cron tick. Save the full dispatch URL in Vault to
turn it on (without it, the triggers do nothing and the cron still delivers):

```sql
select vault.create_secret('https://your-focal.example/api/push?dispatch=1', 'focal_push_dispatch_url');
```

Keep the cron: planned-study, deadline and daily reminders, plus retries, still depend on it.

The sender claims up to 50 deliveries per tick, retries interrupted/transient
failures after five minutes, and deletes expired browser endpoints. Events older
than 15 minutes are skipped, so a scheduler outage does not flood devices with
old alerts. Delivery may be delayed or suppressed by the OS, Focus modes, or
network conditions. Monitor non-200 scheduler responses and increase capacity if
the 50-delivery batch regularly fills. Subscriptions and delivery receipts are
server-only, outside the sync feed and exported study data. Revalidate delivery
on a physical iPhone and Android after deployment.

ChatGPT analysis features remain desktop-only. Their credentials stay in the local sidecar and secure native storage. Gateway chat is available in the shared UI on web and desktop.

Desktop account sessions are encrypted in SQLite using the sidecar's OS credential
store (Keychain on macOS, Secret Service with `secret-tool` on Linux, DPAPI on
Windows). The sidecar and an unlocked credential store are required to restore or
save a desktop login. Existing plaintext sessions migrate after encryption succeeds;
failed migrations keep the original value. Older database copies and backups may
still contain the previous plaintext session.

## Study chat with Vercel AI Gateway

Sign in and save your Vercel AI Gateway API key in **Settings > AI**. Then open
**Study > Chat** and choose a model with the searchable model selector. The assistant can read
your synced exams, mistakes, timetable, goals, and study history, and use the same
validated tools as the MCP server to make requested changes. Tool activity and
results appear in the conversation. Stop cancels generation; in-flight writes
can still finish, so check your records before retrying a change. Local unsynced
edits and historical desktop-only sessions are not included. Chats stay in memory
and clear when you leave the page or switch accounts.

Apply `supabase/migrations/0032_ai_gateway_vault.sql` before using saved keys.
Keys are encrypted in [Supabase Vault](https://supabase.com/docs/guides/database/vault), outside the sync feed and exported app data.
Authenticated users can check saved-key status, save/replace their own key, and
remove it; they cannot read plaintext keys. Only the chat server's service role
can retrieve a key, after verifying the caller's Supabase session. Account
deletion also removes its Vault secret. Settings clears the input after saving,
and never displays the saved key. Keys are not stored in browser storage or logged
by the chat handler. Use HTTPS for the hosted endpoint; localhost HTTP is allowed
during development. Chat no longer accepts keys in request headers.

The model selector loads Vercel's public catalog and shows only language models
tagged for tool use. The server validates each selection against that catalog.
`AI_GATEWAY_MODEL` sets the initial selection (default `openai/gpt-6-luna`);
the user's selection applies for the current chat page. The server needs
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` for Vault retrieval. Study-data tools still run with
the user's session and row-level security. Keep the service-role key server-side;
never put it or a user's Gateway key in a `VITE_` variable. No hosting Gateway
key or OIDC fallback is used.

`bun run dev` and `bun run dev:desktop` serve `/api/chat` locally. Production web
uses the Vercel function in `api/chat.ts`, or the same handler through
`bun run start`. Packaged desktop builds need
`VITE_CHAT_API_URL=https://your-focal-host/api/chat` at build time. The hosted
endpoint allows the Tauri origins and authenticates every request. Deploy from
the repository root so the function includes `public` reference datasets.

Each request accepts up to 60 messages / 256 KiB, runs at most six model steps,
and times out after 55 seconds. Requests are limited to ten per user per minute
per server instance; use a shared limiter for a strict deployment-wide cap.
Gateway billing and access follow the user's key and Vercel team configuration.
See [Gateway setup](https://vercel.com/docs/ai-gateway/getting-started) and the
[shadcn chat components](https://ui.shadcn.com/docs/ai-elements/base/chat).

Local SQLite migrations are immutable after release. Add a new version and register it in `src-tauri/src/lib.rs` when changing the native schema. This repository has no test suite; verify changes with builds, typechecking, linting, and the app.
