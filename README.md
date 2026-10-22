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

The historical `examtrack` storage keys and protocol identifiers remain unchanged for compatibility with saved data and Folio. See [the sync protocol](docs/sync-protocol.md) and [the historical ExamTrack migration](docs/examtrack-merge.md).

ChatGPT analysis features remain desktop-only. Their credentials stay in the local sidecar and secure native storage. Gateway chat is available in the shared UI on web and desktop.

## Study chat with Vercel AI Gateway

Open **Study > Chat**, sign in to your Focal account, and enter your own Vercel
AI Gateway API key under **Gateway API key**. The assistant can read
your synced exams, mistakes, timetable, goals, and study history, and use the same
validated tools as the MCP server to make requested changes. Tool activity and
results appear in the conversation. Stop cancels generation; in-flight writes
can still finish, so check your records before retrying a change. Local unsynced
edits and historical desktop-only sessions are not included. Chats stay in memory
and clear when you leave the page or switch accounts.

The key stays in page memory, is cleared when you leave Chat or switch accounts,
and is sent with each authenticated request so the server can call Gateway on
your behalf. Focal does not persist the key in browser storage, the database, or
server logs. Use HTTPS for the hosted endpoint; localhost HTTP is allowed during
development. No server-side Gateway key or OIDC token is required or used.

`AI_GATEWAY_MODEL` on the server selects a tool-capable model and defaults to
`openai/gpt-6-luna`. The server also needs `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`; chat verifies the user's Supabase session and
keeps row-level security in place without a service-role key. Never put a user's
Gateway key in an environment variable or a `VITE_` variable.

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
