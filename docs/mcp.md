# Focal MCP server

Lets an MCP client (Claude Code, Claude Desktop, ...) read and change a Focal account: exams,
mistakes and reviews, SACs, calendar, study timer and sessions, stoplight, goals, tasks, timetable,
settings, analytics, predictions, and the VCAA/VTAC reference data. Tools are grouped in
`server/mcp/records.ts`, `study.ts`, `insights.ts`, `app.ts`, `attachments.ts` and `friends.ts`. Start a conversation with `get_overview`.

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

Claude Desktop stdio is for the operator's own machine only. The stdio transport needs
`SUPABASE_SERVICE_ROLE_KEY`, which belongs only on the server that runs the MCP service,
never in an end user's MCP client config. End users should connect to the hosted HTTP service
with the Authorization bearer header shown above.

For connectors that cannot send headers, `/mcp/<token>` is also supported. A token in the URL
path is written to proxy and access logs; prefer the Authorization header, and configure the
reverse proxy not to log request paths for `/mcp/` if the path form is used.

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

## Coverage

`get_capabilities` lists the registered tools and their access hints. The shared registry now has
105 tools, used by HTTP MCP, stdio MCP and in-app AI chat. No new database migration is needed.

| App area | Access |
| --- | --- |
| Today, subjects, progress | Overview, full subject workspace, day plan, weekly review, analytics |
| Practice papers and mistakes | Existing logging, marking, reviews, insights and alternative-card tools; full records through advanced row access |
| School assessments and calendar | Existing SAC/event CRUD, class timetable import/read/clear |
| Subject lifecycle | Read completion years in settings; finish or resume with `set_subject_completion` |
| Skills, tasks and goals | Existing creation/rating/planning/archive tools; `update_stoplight_item`, `edit_task` (including restore) |
| Exam progression | Read the full plan, import additions, or replace/reorder/remove papers |
| Predictions and ATAR | Existing prediction/scaling/estimate tools plus editing saved scenarios |
| Study sessions and timers | Full canonical session reads, planning/logging/editing/deletion, focus and assessment timers, revision-checked metadata edits, atomic merges |
| Mistake images | Private signed URLs, base64 uploads with the app's image limits, removal from cards |
| Worksheets | LaTeX text or compiled PDF as base64 bytes |
| Friends | Profile/privacy, requests, blocks, nicknames, shared activity/countdowns, cheers, groups and shared study sessions/invitations |
| Review settings | Spacing, practice days/time/target, snooze, effects, sound and finish |
| Every synced app row | `list_app_records` and `edit_app_record`, including historical and archived records |

### Advanced record access

Prefer the named tools for routine work. `export_app_data` returns the complete projected AppData
backup and canonical sessions; `list_app_records` returns raw app rows with their sequence numbers.
To edit a field without a convenience tool, copy its row payload, update its values and timestamps,
and call `edit_app_record` with its entity, rowId, expectedSeq and JSON payload. It previews by default.
Inspect that preview, then pass `dryRun: false` to apply. Use expectedSeq 0 for a new row. A put
must round-trip through the app's canonical row validators; unknown settings and malformed payloads
are rejected. A concurrent edit rejects the write instead of overwriting it.

This advanced tool writes exactly one row at a time. A collection-valued setting (for example
`learning`, `sacRecords` or `atarEstimates`) replaces that collection. Multi-row workflows are not
atomic; use the named tools for cascading exam deletion and transactional session merging.

### Files and external effects

Attachment download URLs are private bearer URLs valid for an hour. Removing an attachment unlinks
it from the card but retains its stored bytes, avoiding file loss for concurrent readers. An upload
whose subsequent sync write fails can leave an unlinked stored object; it is deliberately retained
because a write may have reached the server even if its response was lost.

`export_mistake_worksheet` defaults to LaTeX. PDF compilation sends the selected question text to
texlive.net, just like the app's export, and returns base64 PDF bytes for the MCP client to save.
Friend requests, cheers and shared-session invitations should be sent only at the user's request.
All Friends tools call the same user-scoped RPCs as the UI; database sharing and membership rules
remain authoritative.

### Device boundary

This covers synced account records, not literally every device operation. The hosted server cannot
read a device's IndexedDB chat history, local appearance/layout/AI preferences, unsynced guest data,
or historical desktop-only SQLite sessions. It cannot open native dialogs, grant notification
permissions, navigate an open app, install updates or drive a desktop ChatGPT login. Account
sign-in and MCP-token creation/revocation stay in the app. Full device control would require a
separate authenticated device bridge; these tools do not pretend to provide one.

Validation: `bun run check`, `bun test`, `bun run build`, `bun run build:desktop`. Live Supabase,
storage, Friends and third-party PDF requests require an authenticated deployment to verify end to end.
