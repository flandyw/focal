# Deployment

## Supabase

Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the frontend. Apply the migrations in `supabase/migrations/` in order to the intended project. Never expose `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_` variable or commit credentials. The service-role key is needed only by server-side features such as AI chat and MCP.

For password recovery, set Supabase Authentication's Site URL to the hosted frontend and allow each deployment's `/?reset-password=1` redirect, including `http://localhost:5173/?reset-password=1` for local development. Retain the Supabase confirmation link in the reset email template.

Friends features require the relevant migrations, including `0031_friends_competition.sql` and `0037_friend_usernames.sql`. Existing friendships and sharing preferences are preserved. See [sync protocol](sync-protocol.md) before changing shared records or lifecycle behavior.

## Web

Deploy from the repository root. `vercel.json` builds with `bun run build`, serves `dist/`, and configures the API functions and cache headers. Set frontend and any needed server environment variables in the hosting project. See [AI chat](ai-chat.md) and [notifications](notifications.md) for their additional configuration; neither is required for the basic frontend.

For a Bun host, build first and run `bun run start`. Use HTTPS for public deployments. Review the API and secrets configuration before exposing the server.

## Desktop

`bun run tauri build` packages the shared frontend with the native shell and sidecar. Set the frontend Supabase variables at build time. Packaged desktop Gateway chat also needs `VITE_CHAT_API_URL` pointing to the hosted `/api/chat` endpoint. The release workflow in `.github/workflows/release.yml` builds platform artifacts and publishes them to GitHub Releases.

Desktop Supabase sessions are encrypted in SQLite with a key protected by the OS credential store. The sidecar and an accessible credential store are needed to save or restore a login. Old database copies or backups may still contain plaintext sessions from before migration; protect them accordingly.
