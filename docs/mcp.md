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

Single-user: the server signs in as one account (`server/mcp/store.ts`).

| Variable | |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | same as the app |
| `FOCAL_EMAIL`, `FOCAL_PASSWORD` | the account to act as |
| `FOCAL_MCP_TOKEN` | HTTP only: bearer token clients must send. The endpoint is closed while unset. |
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

Put TLS in front, e.g. Caddy: `mcp.example.com { reverse_proxy 127.0.0.1:4174 }`. Use a long random
`FOCAL_MCP_TOKEN` (`openssl rand -hex 32`); anyone holding it has full access to the account.

## Connect

```sh
claude mcp add --transport http focal https://mcp.example.com/mcp --header "Authorization: Bearer $FOCAL_MCP_TOKEN"
```

Claude Desktop (stdio):

```json
{ "mcpServers": { "focal": { "command": "bun", "args": ["server/mcp/stdio.ts"], "cwd": "/path/to/focal",
  "env": { "VITE_SUPABASE_URL": "...", "VITE_SUPABASE_PUBLISHABLE_KEY": "...", "FOCAL_EMAIL": "...", "FOCAL_PASSWORD": "...", "TZ": "Australia/Melbourne" } } } }
```

The claude.ai web "custom connector" needs OAuth, which this does not implement (a static bearer token is not enough there).

## Not covered

Live timed exam and SAC timers (real-time UI state), mistake attachments (stored files), PDF
worksheet export, merging study sessions, and the desktop-only ChatGPT features (insights and
alternative-question decks). The MCP client does that reasoning itself and writes the results back
with `add_mistakes`, `link_to_stoplight`, `add_stoplight_items` and friends.
