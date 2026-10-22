What this repo does: Focal is a VCE study app for exams, mistake revision, calendars, study timers and progress tracking. One React frontend serves the web and Tauri desktop builds, with Supabase account sync and a local ChatGPT sidecar. This audit assumes individual students using several tabs/devices and many accounts sharing a hosted backend.

Audit date: 22 October 2026. All numbered findings below have code fixes in this working tree. They describe the original failure and the change made; they are not claims that every possible bug has been found.

**Must fix — fixed**

1. **Conflicting edits could loop forever** (`src/lib/app-sync.ts:318`, `src/lib/app-sync.ts:433`).
   - **What this is:** The offline queue retries edits when another device changed the same record first.
   - **Problem:** With two queued edits to one record, recursive conflict handling kept deleting and recreating each other's entries. A sender could also resurrect an unsent entry that had already been replaced.
   - **Fix:** Send one entry per record at a time, claim entries inside the storage transaction, and combine later unsent edits into one conflict retry in that same transaction.
   - **If we skip it:** Sync can keep writing locally without finishing, and old edits can return to the queue.

2. **Late acknowledgements could replace newer data** (`src/lib/app-sync.ts:397`).
   - **What this is:** Acknowledgements record the server's accepted version in IndexedDB.
   - **Problem:** If a newer feed update arrived before an older acknowledgement, the acknowledgement overwrote it. The feed cursor could already be past the newer version.
   - **Fix:** Compare server sequence numbers before storing acknowledgement or conflict-response rows.
   - **If we skip it:** A client can display an older record until some later change repairs it.

3. **Desktop account tokens were readable in SQLite** (`src/lib/supabase/sessionStorage.ts:12`, `server/chatgpt.ts:61`).
   - **What this is:** Desktop remembers Supabase account sessions between launches.
   - **Problem:** The supposedly secure preference row contained the complete session as plain JSON. Copying the database also copied its refresh token.
   - **Fix:** Encrypt saved values through the existing OS credential provider. Migrate old values only after encryption and persistence succeed; identify Supabase ciphertext separately from ChatGPT credentials.
   - **If we skip it:** A database copy continues to expose reusable account credentials. Older copies and SQLite remnants are not erased by this migration.

4. **Credential-store errors could destroy the encryption key** (`server/keystore.ts:25`).
   - **What this is:** The sidecar retrieves or creates the key used for encrypted credentials.
   - **Problem:** Windows treated a failed decryption like a missing file and overwrote the key file. macOS used an update operation after a failed lookup, and Linux also treated lookup failures as permission to replace a key.
   - **Fix:** Preserve existing files on read/decryption errors, avoid replacing existing Keychain entries, distinguish Linux lookup errors from missing entries, and serialize key creation with the installed file-lock library. Handle subprocess input failures too. Linux exit handling was checked against [libsecret's implementation](https://gnome.pages.gitlab.gnome.org/libsecret/coverage/tool/secret-tool.c.gcov.html).
   - **If we skip it:** A temporary OS-store failure can make existing saved credentials unreadable permanently.

5. **The loopback service trusted hostile hostnames** (`server/chatgpt.ts:48`).
   - **What this is:** Browser-origin checks protect the local sidecar.
   - **Problem:** A request with matching hostile Host and Origin values passed the same-origin comparison. DNS rebinding can send a hostile website's requests to a loopback service while retaining those values.
   - **Fix:** Require a localhost or loopback hostname as well as the existing origin checks.
   - **If we skip it:** The sidecar's privileged routes remain reachable through this origin-check bypass.

6. **Body limits applied after allocating the body** (`server/request.ts:2`, `server/mistakes-pdf.ts:10`, `vite.config.ts:20`).
   - **What this is:** PDF generation and sidecar inference accept JSON requests.
   - **Problem:** PDF JSON was unbounded before parsing; sidecar requests were fully read before their size check. Vite buffered the entire PDF body too, and constructing a GET request with a body failed before the handler could return 405.
   - **Fix:** Share byte-counted streaming reads across chat, PDF and inference handlers, stream Vite PDF input, and pass bodies only for POST. Forward PDF cancellation to the compiler request.
   - **If we skip it:** Large requests can allocate far beyond the intended limits, and development GET requests to the PDF endpoint fail incorrectly.

7. **Hosted chat could save events in the server's time zone** (`server/mcp/util.ts:21`, `server/mcp/records.ts:394`, `server/chat.ts`).
   - **What this is:** Event tools accept a date and local clock time.
   - **Problem:** A 09:00 Melbourne event on a UTC host became 09:00 UTC. Moving an existing event's start also failed to check whether its retained end now came before the start.
   - **Fix:** Pass chat's validated user time zone into the event tool, resolve it with Intl, reject skipped or repeated local times without an explicit offset, and validate retained end times. MCP's existing configured-server-time-zone behavior remains the default when no zone is supplied.
   - **If we skip it:** Students can get events shifted by hours or events whose end precedes their start.

8. **Development cleanup disabled focus-session sync** (`src/lib/focus-session.ts:242`, `src/lib/focus-session.ts:267`).
   - **What this is:** The focus timer keeps its local state aligned with its saved study session.
   - **Problem:** React Strict Mode replays effect setup after cleanup, but cleanup permanently disposed the retained helper. Its optional local-only path also treated a missing sink as a closed session, and a refusal carrying no canonical session was ignored.
   - **Fix:** Reconnect on effect setup, retain local state without a sink, accept an explicitly closed canonical state, and drain work queued as a prior pass finishes.
   - **If we skip it:** A timer can appear to run while session updates are silently ignored or repeatedly recreated.

9. **Exam deletion could stop halfway through a conflict retry** (`server/mcp/records.ts:108`).
   - **What this is:** Deleting an exam also deletes its linked mistake cards.
   - **Problem:** The sync API can accept the exam deletion while refusing a conflicting mistake deletion. Retrying then failed because the exam had already gone.
   - **Fix:** Check that the exam exists before starting, then make the retried removal safe when the exam is already absent.
   - **If we skip it:** A reported failed deletion can leave orphaned mistake cards.

10. **Desktop auth storage mixed different SDK keys** (`src/lib/supabase/sessionStorage.ts:24`).
    - **What this is:** Supabase stores sessions, auth-code verifiers and sometimes a separate user record under different keys.
    - **Problem:** The adapter ignored those keys and returned one cached value for all of them. Reading or deleting a verifier could return or remove the main session instead.
    - **Fix:** Cache and persist values by key while keeping the historical primary-session preference row.
    - **If we skip it:** Redirect sign-in and separate user storage can read the wrong value or erase the saved login.

11. **Spreadsheet exports preserved executable-looking formulas** (`src/lib/csv.ts:2`, `src/lib/mistake-export.ts:37`).
    - **What this is:** Mistake and analytics exports put user-controlled text into CSV files.
    - **Problem:** A subject or question beginning with `=HYPERLINK(...)` could be interpreted as a formula by a spreadsheet. Empty mistake CSV exports also read keys from an absent first row.
    - **Fix:** Share quoted CSV escaping, prefix formula-looking text with a tab, and handle an empty collection. This follows [OWASP's spreadsheet-export mitigation](https://community.owasp.org/attacks/CSV_Injection); the protective tab is part of the exported text and spreadsheet behavior varies.
    - **If we skip it:** Opening an imported card's CSV can execute a spreadsheet formula, and exporting an empty list can throw.

**Should fix — fixed**

12. **Progress stopped advancing after opening the page** (`src/components/analytics/AnalyticsView.tsx:186`).
    - **What this is:** Progress filters study history against the end of its selected period.
    - **Problem:** The live period's end was calculated only when the selected period changed. A session started after opening Progress stayed outside that window even after completion.
    - **Fix:** Use the existing ticking-clock hook for the live period. Route CSV downloads through the existing host handler so desktop exports use the native save dialog too.
    - **If we skip it:** New study can stay invisible until the page is reopened, and desktop CSV export bypasses its normal file flow.

13. **Server caches retained every account indefinitely** (`server/mcp/store.ts:70`, `server/mcp/store.ts:121`).
    - **What this is:** MCP and chat share short-lived account snapshots; MCP also caches authenticated connections.
    - **Problem:** Snapshot expiry only controlled reuse, never eviction. Connections also had no retention limit, so distinct accounts accumulated for the life of a busy server.
    - **Fix:** Evict expired snapshots and connections when those caches are accessed. Old promise failures cannot delete a newer replacement connection.
    - **If we skip it:** Memory use grows with all accounts ever served, including their retained snapshots.

14. **Subject-filtered tools hid standalone mistakes** (`server/mcp/records.ts:152`).
    - **What this is:** The assistant lists mistake cards by subject.
    - **Problem:** Filtering only used the linked exam's subject. A standalone card with its own subject disappeared from the filtered list and its returned subject was missing.
    - **Fix:** Fall back to the card's own subject. Build attempt and schedule maps once, removing a repeated exam scan per card and repeated schedule work while sorting.
    - **If we skip it:** The assistant misses valid cards and does avoidable work on large libraries.

15. **Plan finish times counted the wrong breaks** (`src/lib/study-plan.ts:78`).
    - **What this is:** The planner previews when a focus-block plan will finish.
    - **Problem:** Four 25-minute blocks with 5-minute breaks and a 15-minute long break every four blocks were previewed as 130 minutes. The work ends after 115 minutes: three short breaks and no break after the final block.
    - **Fix:** Count only breaks between blocks and replace a short break with a long one when due.
    - **If we skip it:** Finish estimates overstate the time needed and can mislead planning.

16. **A failed database open prevented later recovery** (`src/lib/storage/database.ts:28`).
    - **What this is:** Desktop shares one promise for opening its historical SQLite database.
    - **Problem:** If that promise rejected once, every later attempt reused the same rejected promise.
    - **Fix:** Clear the cached promise on failure while passing the error to the caller.
    - **If we skip it:** Historical study data remains unavailable for that app run after a temporary open failure.

17. **Routine checks skipped server entry points** (`package.json`, `tsconfig.node.json`).
    - **What this is:** `bun run check` is the repository's prescribed verification command.
    - **Problem:** Lint covered only frontend and scripts, and the Node configuration did not directly include all server entry points. Expanding lint exposed a server authentication function whose `use...` name incorrectly triggered React hook rules.
    - **Fix:** Include server, API and Vite files in lint, include the Bun server entry points in typechecking, and rename that plain authentication function and its sole caller.
    - **If we skip it:** Future backend changes can bypass the normal check command.

**Nice to have — fixed**

18. **Deep equality sorted keys unnecessarily** (`src/lib/app-rows.ts:50`).
    - **What this is:** Sync compares nested app data to detect changes.
    - **Problem:** Every compared object sorted both key lists even though property order is irrelevant.
    - **Fix:** Compare key counts and own-property membership directly. Shared request parsing and CSV escaping also replace duplicated implementations without new dependencies.
    - **If we skip it:** Repeated comparisons keep doing avoidable sorting and duplicate boundary handling keeps separate maintenance paths.

Verification: `bun run check`, `bun run build`, `bun run build:desktop`, and `bun run build:chatgpt-sidecar` passed during this audit. Local HTTP checks returned 405 for a PDF GET, 400 for invalid PDF/session JSON, 413 for an oversized PDF request, and 403 for a matching hostile Host/Origin pair sent to the sidecar. No tests or self-check scripts were added. The existing Toggle fast-refresh lint warning remains; the web build also warns about its main chunk exceeding 600 kB. No measured browser performance claim is made.

Scope: read the README, build/deploy/release configuration, native entry points, local storage and account restoration paths, both sync queues, timer lifecycle logic, server/MCP handlers, key storage, imports/exports, and selected exam, timetable, analytics and validation code. Reviewed the relevant sync/auth/friends migration definitions statically. Preserved concurrent chat/settings/Gateway changes made elsewhere in this workspace; those changes are not audit fixes listed here.

Verdict: The concrete findings above are fixed; native credential migration and real multi-device sync still need live-environment verification before a release can be called fully validated.

Lean: The equality helper is one line shorter. No package dependencies were added; duplicate request reading, CSV escaping and download code now use shared implementations. The total change grows to add validation and safe credential migration.

Not checked: browser interaction (preview blocked by host AppArmor), live Supabase/RLS and multi-device conflict execution, macOS Keychain, Windows DPAPI, Linux keyring migration (`secret-tool` is absent here), native Tauri packaging, production load, official accuracy of public reference datasets, every UI component, all historical migration bodies, and the full vendored runtime. No new tests were written or run, as requested. Desktop login now requires the sidecar and an accessible OS credential store; old database copies may retain plaintext tokens.
