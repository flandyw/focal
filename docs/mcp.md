# Focal MCP server

Lets an MCP client (Claude Code, Claude Desktop, ...) read and change a Focal account: exams,
mistakes and reviews, SACs, calendar, study timer and sessions, stoplight, goals, tasks, timetable,
settings, analytics, predictions, and the VCAA/VTAC reference data. 54 tools, grouped in
`server/mcp/records.ts`, `study.ts` and `insights.ts`. Start a conversation with `get_overview`.

It reuses the app's own logic from `src/lib` and writes through the same sync RPCs
(`sync_apply_changes`, `study_session_mutate`), so edits show up in the web and desktop apps and
every row passes the apps' own validators first. Reads and writes use `expected_seq` / `expected_revision`;
a row changed in an app mid-write is re-read and the edit re-applied, never overwritten.

## Configuration

Multi-user. Each user creates personal access tokens in Settings > MCP access (`mcp_tokens`, migration 0026;
only SHA-256 hashes are stored). A request's bearer token resolves to its owner, and the server acts as that
user: with the service role it mints a magic-link token (no email is sent) and redeems it, so every RPC runs
with the user's own JWT and RLS stays the authority (`server/mcp/store.ts`). Revoking a token stops new requests
at once.

| Variable | |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | same as the app |
| `SUPABASE_SERVICE_ROLE_KEY` | server only: token lookup and minting user sessions. Keep it out of the frontend. |
| `FOCAL_MCP_TOKEN` | stdio only: an access token; the process acts as its owner |
| `TZ` | set to `Australia/Melbourne`: day plans, timetable cycles and "today" use the server's local time |

## Run

```sh
bun run mcp        # stdio, for Claude Desktop (no token needed)
bun run mcp:http   # HTTP on 127.0.0.1:4174/mcp (HOST and PORT override)
bun start          # the built app; also serves /api/mcp
```

Hosting: run it on a VPS, not on Vercel. The Vercel Node runtime transpiles files one by one, and
`src/lib` uses extensionless imports that native Node ESM cannot resolve. Bun runs it as is.

```ini
# /etc/systemd/system/focal-mcp.service
[Service]
WorkingDirectory=/opt/focal
EnvironmentFile=/opt/focal/.env.local
Environment=TZ=Australia/Melbourne
ExecStart=/root/.bun/bin/bun server/mcp/http.ts
Restart=always
```

Put TLS in front, e.g. Caddy: `mcp.example.com { reverse_proxy 127.0.0.1:4174 }`. Anyone holding a token has full access to its account.

## Connect

```sh
claude mcp add --transport http focal https://mcp.example.com/mcp --header "Authorization: Bearer <token>"
```

Claude Desktop (stdio):

```json
{ "mcpServers": { "focal": { "command": "bun", "args": ["server/mcp/stdio.ts"], "cwd": "/path/to/focal",
  "env": { "VITE_SUPABASE_URL": "...", "VITE_SUPABASE_PUBLISHABLE_KEY": "...", "SUPABASE_SERVICE_ROLE_KEY": "...", "FOCAL_MCP_TOKEN": "...", "TZ": "Australia/Melbourne" } } } }
```

The claude.ai web "custom connector" needs OAuth, which this does not implement (a static bearer token is not enough there).

## Not covered

Live timed exam and SAC timers (real-time UI state), mistake attachments (stored files), PDF
worksheet export, merging study sessions, and the desktop-only ChatGPT features (insights and
alternative-question decks). The MCP client does that reasoning itself and writes the results back
with `add_mistakes`, `link_to_stoplight`, `add_stoplight_items` and friends.
