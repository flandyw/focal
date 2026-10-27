# AI chat

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

ChatGPT analysis features are desktop-only and use the local sidecar. Gateway chat is available on web and desktop.
