# Focal MCP server

Connect an MCP client (like Claude Code or Claude Desktop) to read and update a Focal account: exams, mistakes and reviews, SACs, calendar, study timer and sessions, skills, goals, tasks, timetable, settings, analytics, predictions, and VCAA/VTAC reference data. Tools are grouped in `server/mcp/records.ts`, `study.ts`, `insights.ts`, `app.ts`, `attachments.ts`, and `friends.ts`. A good way to start any conversation is with `get_overview`.

For recurring mistakes, `get_mistake_patterns` returns ranked patterns and their source card IDs (with optional `subject` and `limit`). `schedule_pattern_revision` previews follow-up tasks by default; pass `dryRun: false` to save them, with optional `subject` and `maxPatterns` (default 3); existing planned follow-ups are skipped. The `mistake_followup` prompt walks through evidence-based insights, alternative practice cards, and a follow-up preview, asking for confirmation before scheduling anything.

The server reuses the app's own domain logic in `src/lib` and writes through the same sync RPCs (`sync_apply_changes`, `study_session_mutate`), so changes show up in the web and desktop apps and pass the exact same validators. Reads and writes carry `expected_seq` / `expected_revision`, so if a record changes in an app mid-write, the server re-reads and reapplies the edit instead of overwriting it.

## Configuration

The server supports multiple users. Each student creates personal access tokens in **Settings → Account** (`mcp_tokens`, migration 0026; only SHA-256 hashes are stored). A request's bearer token resolves to its owner, and the server acts as that student: using the service role, it mints a magic-link token (no email is sent) and redeems it, so every RPC runs with the user's own JWT and RLS stays in charge (`server/mcp/store.ts`). Revoking a token blocks new requests right away.

| Variable | Notes |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Same values used by the app. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only: used for token lookup and minting user sessions. Never expose in the frontend. |
| `FOCAL_MCP_TOKEN` | Stdio only: a personal access token; the process acts as its owner. |
| `TZ` | Set to `Australia/Melbourne` so day plans, timetable cycles, and "today" match Melbourne time. |

## Running the server

```sh
bun run mcp        # stdio (needs FOCAL_MCP_TOKEN)
bun run mcp:http   # HTTP on 127.0.0.1:4174/mcp (override with HOST and PORT)
bun run start      # built app, which also serves /api/mcp
```

Run it on a VPS rather than Vercel. Vercel's Node runtime transpiles files one by one, and `src/lib` uses extensionless imports that native Node ESM can't resolve, whereas Bun runs it directly.

```ini
# /etc/systemd/system/focal-mcp.service
[Service]
WorkingDirectory=/opt/focal
EnvironmentFile=/opt/focal/.env.local
Environment=TZ=Australia/Melbourne
ExecStart=/root/.bun/bin/bun server/mcp/http.ts
Restart=always
```

Put TLS in front (for example Caddy: `mcp.example.com { reverse_proxy 127.0.0.1:4174 }`). Anyone with a token has full access to that account.

## Connecting a client

```sh
claude mcp add --transport http focal https://mcp.example.com/mcp --header "Authorization: Bearer <token>"
```

Claude Desktop stdio is only for your own machine as the server operator, since it requires `SUPABASE_SERVICE_ROLE_KEY`, which should never go into an end user's MCP client config. End users should connect to the hosted HTTP server with the `Authorization` bearer header above.

For connectors that don't support custom headers, `/mcp/<token>` works too. Keep in mind that tokens in the URL path can land in proxy and access logs, so prefer the `Authorization` header (or configure your reverse proxy not to log `/mcp/` paths).

The claude.ai web custom connector requires OAuth, which this server doesn't implement (a static bearer token isn't enough there).

## Topics and the Exam 1 vs Exam 2 matrix

Because `areaOfStudy` is free text (a student can easily end up with 80 slightly different labels), the matrix in `get_exam_analytics` (with `subject`) groups by a canonical `topic` instead. `mistake.topic` and `questionResult.topic` draw from a per-subject list in `src/lib/topics.ts` (`TOPIC_CONFIGS`; Methods is built in, and other subjects can add their own topic list and keyword rules, keeping free-text topics and per-label grouping until then). Methods covers: Functions/domains/transformations; Inverse functions & intersections; Differentiation & applications; Integration & area; Probability (discrete, conditional, binomial); Continuous distributions, normal, sampling & CIs; Circular functions; Other. Any card without a saved topic gets classified on the fly, so the matrix works even before a backfill.

- `get_exam_analytics { subject, groupBy?, paper? }`: `paperWeakness` rows include Exam 1 and Exam 2 cells with `mistakeCount`, `repeatMistakes`, `marksLost`, `cardsWithoutMarks`, `dominantCategory`, and `lostByCategory`. Rows built from marked questions (`basis: "results"`) add mastery and trend; otherwise `basis: "mistakes"`. `weakPrerequisites` lists transitive prerequisite topics whose diagnosis isn't `secure`, `stable`, `no evidence`, or `mistake-only evidence` (nearest first) on weak rows (empty outside topic grouping or without a prerequisite map). Diagnoses and thresholds live in `WEAKNESS_THRESHOLDS` (`performance-insights.ts`): `no evidence`, `mistake-only evidence` (under 3 cards, or under 2 marks lost on each paper), `exam-1-only gap`, `exam-2-only gap` (one paper alone loses 2+ marks, or both do and one loses 3× the rate per 100 paper marks), `shared weakness`; marked-question rows also keep `tech-free fragile`, `tech-active fragile`, `general weakness`, `secure`, and `stable`. Check `dataQuality.warnings` first to see what's missing. Pass `groupBy: "areaOfStudy"` for the older one-row-per-label matrix, or `paper` to filter to Exam 1 or Exam 2.
- `save_exam` checks `rawMax` against the paper (`src/lib/paper-types.ts`: Methods and Specialist Exam 1 = 40, Exam 2 = 80, combined = 120 or 160). Mismatches still save and come back in `warnings`. `paperType` (`exam1`/`exam2`/`combined`) is optional and stored; combined papers don't count in either matrix column. When you pass an `id`, any omitted field stays untouched, so `{ id, questionResults }` updates only the question breakdown.
- `list_mistakes` is compact by default (omitting `questionText`, `correction`, and SVG), and accepts `fields`, `topic` (`"none"` finds cards without a saved topic), and `cursor` (`nextCursor` from the previous page). Pass `compact: false` for the full text.
- `update_mistakes { updates: [{ id, topic?, areaOfStudy?, category? }], dryRun?, revert? }` updates cards in bulk. Preview with `dryRun: true` first. Applying saves each card's old values in `Mistake.previous`, and `revert: true` with those IDs rolls them back one level.
- `backfill_topics { subject?, dryRun? }` runs as a **dry run by default**. It classifies cards without a topic by keyword (`areaOfStudy` first, then the start of the question text), puts anything it couldn't place in `unmatched` (filed under `Other`), flags ties as `ambiguous`, never overwrites an existing topic, and is safe to re-run (cards in `Other` are retried after you improve the rules). It never changes `areaOfStudy`. Writes and reverts log one JSON line each to stderr (`journald` under systemd).

Check changes with `bun run check`, `bun run build`, and `bun run build:desktop`.

## What the tools cover

`get_capabilities` lists all registered tools and their access hints. The shared registry currently has 105 tools used across HTTP MCP, stdio MCP, and in-app AI chat, with no extra database migration required.

| App area | What's supported |
| --- | --- |
| Today, subjects, progress | Overview, full subject workspace, day plan, weekly review, analytics |
| Practice papers and mistakes | Logging, marking, reviews, insights, and alternative-card tools; full records via advanced row access |
| School assessments and calendar | SAC and event CRUD, class timetable import, read, and clear |
| Subject lifecycle | Read completion years in settings; finish or resume a subject with `set_subject_completion` |
| Skills, tasks, and goals | Creating, rating, planning, and archiving tools; `update_stoplight_item`, `edit_task` (including restore) |
| Exam progression | Read the full plan, import additions, or replace, reorder, and remove papers |
| Predictions and ATAR | Prediction, scaling, and estimate tools plus editing saved scenarios |
| Study sessions and timers | Full canonical session reads, planning, logging, editing, deletion, focus and assessment timers, revision-checked metadata edits, and atomic merges |
| Mistake images | Private signed URLs, base64 uploads following the app's image limits, and removing attachments |
| Worksheets | LaTeX source or compiled PDF as base64 bytes |
| Friends | Profile and privacy, requests, blocks, nicknames, shared activity and countdowns, cheers, groups, and shared study sessions/invitations |
| Review settings | Spacing, practice days/time/target, snooze, effects, sound, and finish |
| Every synced app row | `list_app_records` and `edit_app_record`, including historical and archived records |

### Advanced record access

Stick to the named tools for everyday tasks. `export_app_data` returns a full projected `AppData` backup plus canonical sessions, and `list_app_records` returns raw app rows with their sequence numbers. If you need to edit a field that doesn't have a dedicated tool, copy its row payload, update the values and timestamps, and call `edit_app_record` with its `entity`, `rowId`, `expectedSeq`, and JSON payload. It previews by default: check the preview, then pass `dryRun: false` to apply (use `expectedSeq: 0` for a new row). Writes must pass the app's canonical row validators; unknown settings and malformed payloads are rejected, and concurrent edits are rejected instead of overwritten.

This tool writes one row at a time. Collection-valued settings (like `learning`, `sacRecords`, or `atarEstimates`) replace the whole collection. Multi-row workflows aren't atomic, so use the named tools for cascading exam deletions and transactional session merges.

### Files and external effects

Attachment download URLs are private bearer links valid for one hour. Removing an attachment unlinks it from the card while leaving the stored bytes in place so concurrent readers don't lose a file. If an upload succeeds but the follow-up sync write fails, the stored object stays behind intentionally in case the write actually reached the server before the response dropped.

`export_mistake_worksheet` returns LaTeX by default. Requesting a PDF sends the selected question text to `texlive.net` (just like the app's export) and returns base64 PDF bytes for the MCP client to save. Only send friend requests, cheers, or shared-session invites when the student explicitly asks. All Friends tools call the same user-scoped RPCs as the UI, so database sharing and membership rules stay authoritative.

### What stays on the device

The MCP server covers synced account data, not local device operations. It can't read a device's IndexedDB chat history, local appearance/layout/AI preferences, unsynced guest data, or historical desktop-only SQLite sessions. It also can't open native dialogs, grant notification permissions, navigate an open app, install updates, or drive a desktop ChatGPT login. Signing in and creating or revoking MCP tokens stay in the app. Full device control would need a separate authenticated device bridge, which these tools don't try to fake.

Verify changes with `bun run check`, `bun run test`, `bun run build`, and `bun run build:desktop`. Live Supabase, storage, Friends, and third-party PDF calls need an authenticated deployment to test end to end.
