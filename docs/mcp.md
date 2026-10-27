# Focal MCP server

Lets an MCP client (Claude Code, Claude Desktop, ...) read and change a Focal account: exams,
mistakes and reviews, SACs, calendar, study timer and sessions, stoplight, goals, tasks, timetable,
settings, analytics, predictions, and the VCAA/VTAC reference data. Tools are grouped in
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
bun run mcp        # stdio, requires FOCAL_MCP_TOKEN
bun run mcp:http   # HTTP on 127.0.0.1:4174/mcp (HOST and PORT override)
bun run start      # the built app; also serves /api/mcp
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

## Topics and the Exam 1 vs Exam 2 matrix

`areaOfStudy` is free text (a student can have 80 different labels), so the matrix in `get_exam_analytics`
(with `subject`) groups by a canonical `topic` instead. `mistake.topic` and `questionResult.topic` come from a
per-subject list in `src/lib/topics.ts` (`TOPIC_CONFIGS`; Methods is defined, other subjects add an entry with
their topics and keyword rules, and until then keep free-text topics and the old per-label grouping). Methods:
Functions/domains/transformations; Inverse functions & intersections; Differentiation & applications;
Integration & area; Probability (discrete, conditional, binomial); Continuous distributions, normal, sampling & CIs;
Circular functions; Other. A card with no stored topic is filed by inference on the fly, so the matrix works
before any backfill.

- `get_exam_analytics { subject, groupBy?, paper? }`: `paperWeakness` rows have an Exam 1 and an Exam 2 cell with
  `mistakeCount`, `repeatMistakes`, `marksLost`, `cardsWithoutMarks`, `dominantCategory` and `lostByCategory`.
  Rows built from marked questions (`basis: "results"`) add mastery and trend; otherwise `basis: "mistakes"`.
  Diagnoses and their thresholds (`WEAKNESS_THRESHOLDS` in `performance-insights.ts`): `no evidence`,
  `mistake-only evidence` (under 3 cards, or under 2 marks lost on each paper), `exam-1-only gap`,
  `exam-2-only gap` (a paper alone loses 2+ marks, or both do and one loses 3x the rate per 100 paper marks),
  `shared weakness`; marked-question rows keep `tech-free fragile`, `tech-active fragile`, `general weakness`,
  `secure`, `stable`. `dataQuality` says what is missing (read `dataQuality.warnings` first).
  `groupBy: "areaOfStudy"` gives the old one-row-per-label matrix. `paper` limits to Exam 1 or Exam 2.
- `save_exam` checks `rawMax` against the paper (`src/lib/paper-types.ts`: Methods and Specialist Exam 1 = 40,
  Exam 2 = 80, combined = 120 or 160). A mismatch still saves and comes back in `warnings`. `paperType`
  (`exam1`/`exam2`/`combined`) is optional and stored; a combined paper counts in neither matrix column. With an
  `id`, every omitted field is kept, so `{ id, questionResults }` replaces just the question results.
- `list_mistakes` is compact by default (no `questionText`/`correction`/SVG), takes `fields`, `topic`
  (`"none"` = no stored topic) and a `cursor` (`nextCursor` from the previous page). Pass `compact: false` for full text.
- `update_mistakes { updates: [{ id, topic?, areaOfStudy?, category? }], dryRun?, revert? }` edits many cards.
  Always preview with `dryRun: true` first. Applying stores each card's previous values in `Mistake.previous`;
  `revert: true` with the ids restores them (one level).
- `backfill_topics { subject?, dryRun? }` is **dry-run by default**. It maps cards without a topic by keyword
  (`areaOfStudy` first, then the start of the question text), lists the cards it could not place in `unmatched`
  (they get `Other`), flags tied guesses as `ambiguous`, never overrides a topic already set, and is safe to
  re-run (cards left in `Other` are retried, so improving the rules and re-running picks them up). It does not
  touch `areaOfStudy`. Writes and reverts are logged as one JSON line each on stderr (journald under systemd).

Verify changes with `bun run check`, `bun run build`, and `bun run build:desktop`.

## Not covered

Live timed exam and SAC timers (real-time UI state), mistake attachments (stored files), PDF
worksheet export, merging study sessions, and the desktop-only ChatGPT features (insights and
alternative-question decks). The MCP client does that reasoning itself and writes the results back
with `add_mistakes`, `link_to_stoplight`, `add_stoplight_items` and friends.
