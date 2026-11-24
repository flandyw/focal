# Deployment

## Supabase

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the frontend, and apply the migrations in `supabase/migrations/` in order to your project. Never put `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_` variable or commit credentials. The service-role key is strictly for server-side features like AI chat and MCP.

For password resets to work, point Supabase Authentication's Site URL at your hosted frontend and allow each deployment's `/?reset-password=1` redirect (including `http://localhost:5173/?reset-password=1` for local dev). Keep Supabase's confirmation link in the reset email template.

Friends features rely on their migrations, including `0031_friends_competition.sql`, `0037_friend_usernames.sql`, and `0043_friend_study_sessions.sql` for open desks, focus rounds, and scheduled sessions. `0044_friend_blocks.sql` adds blocking and turns on friend requests by default for new profiles while keeping existing friendships and sharing settings intact. Read [sync protocol](sync-protocol.md) before changing shared records or session lifecycles.

## Web

Deploy from the repository root. `vercel.json` builds with `bun run build`, serves `dist/`, and sets up the API functions and cache headers. Add your frontend and server environment variables in your hosting project. [AI chat](ai-chat.md) and [notifications](notifications.md) have extra setup if you want them, though the core app works fine without either.

On a Bun server, build first and run `bun run start`. Always put public deployments behind HTTPS and double-check your API and secret settings before opening the server up.

Worksheet PDF exports send the worksheet's LaTeX (including mistake text) to the public compiler at texlive.net via `/api/mistakes-pdf`, which is rate-limited per IP. If you need worksheet content to stay in-house, point `COMPILER_URL` in `server/mistakes-pdf.ts` at your own LaTeX compiler.

## Desktop

`bun run tauri build` bundles the shared frontend together with the native shell and sidecar. Make sure your frontend Supabase variables are set at build time. Packaged desktop builds that use Gateway chat also need `VITE_CHAT_API_URL` pointing to your hosted `/api/chat` endpoint. The release workflow in `.github/workflows/release.yml` builds installers for each platform and uploads them to GitHub Releases.

Desktop Supabase sessions are encrypted in SQLite with a key stored in the OS credential store, so both the sidecar and an accessible credential store are needed to save or restore a login. Older database copies or backups from before migration may still hold plaintext sessions, so handle them with care.
