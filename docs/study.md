# Planning and tracking study

## Practice paper generator

On **Practice**, pick **Generate practice paper**, choose a subject, Exam or SAC, a paper label, and the writing time (plus an area of study if it's a SAC). Copy the prompt into a chatbot that can compile XeLaTeX. It bundles the VCAA-style template, links to official exams, specifications, and examiner reports, and your weak areas. Once you finish the PDF, upload your work in the same chat, then paste the marking JSON back into Focal to save the paper, per-question marks, and any mistakes. Keep in mind that AI marking isn't official, so double-check its rubric and feedback against VCAA examiner reports.

## Study plans and the timer

You can plan study from **Calendar** or **Study timer** with a subject, notes, topics, and up to 100 non-overlapping blocks (each up to 24 hours). The timer groups plans into all, today, overdue, and upcoming, with search, editing, duplicating, deleting, and quick rescheduling. Folio supports the same fields and actions in its Study screen and sessions panel, and its editor timer can start those shared plans too.

Starting a session from a calendar block runs that exact session ID instead of creating a duplicate with a copied title. Your scheduled blocks are replaced by real measured work intervals, while the original schedule stays in metadata as a duration goal. Paused time never counts. Hit finish when you're done; reaching your goal time won't cut the timer off. Focal's timer can also pick up or finish sessions you started in Folio.

Everything works locally even if you're signed out. When you're signed in, commands are saved to the IndexedDB outbox before going over the network, so queued changes show up in your shared list right away. The last canonical session list for your account is cached in IndexedDB so it's still there if you reopen offline. Pending starts, pauses, and resumes stay in order, and edits based on an older revision are rejected instead of overwriting newer work (Folio keeps a refused plan draft so you can review and save again). No new Supabase migration or notebook format is needed.

## Faster marking

The question breakdown in both exam entry and timed-paper marking lets you paste spreadsheet tables (TSV or CSV). Use `item, earned, out of, topic, feedback` (the last two columns are optional), or just `earned, out of`. You can preview the row count and total before adding them. Press `Enter` and `Shift+Enter` to jump between earned marks, and click **Use as overall mark** to copy the breakdown total straight into your result.

**Use previous layout** copies the question labels, max marks, and topic links from the most recently logged copy of the same subject, provider, year, and paper, leaving earned marks blank so you can fill them in fresh. Layouts come from papers you've logged yourself rather than an official question-mark dataset. After you save, any questions where you lost marks (and don't already have a mistake card) can be turned into editable revision cards. Just add what went wrong and how to fix it before saving.

## Adaptive planning

**Auto-plan** on **Calendar** (along with **Plan this week** on a Skills subject, or the `plan_revision` MCP tool) maps out the next 14 days for you:

- Schedules three prep sessions before each upcoming SAC, assessed calendar event, or tracked VCAA exam, highlighting that subject's red skills.
- Fits in red, amber, and due-for-recheck skills (starting with the ones showing the strongest signs of weakness) before that subject's next assessment.
- Calculates each day's budget from your daily study minutes on study days plus any Free, Study, or Spare periods in your class timetable, minus work already on that day (tasks, sessions, SACs, and events).
- Places tasks on the lightest day that has room, while spreading out the same subject across different days.

You can run it again whenever things shift: unstarted planner tasks (including overdue ones) move to match the new picture, tasks whose skill turned green or whose assessment has passed are archived, and anything that won't fit is flagged for you.

## Weekly review

**Progress** opens with a Monday–Sunday review, defaulting to the last full week. It pulls together your calendar records, study sessions, exam results, and mistake reviews to show what you got done, completed tasks, recurring mistake patterns, topics that improved (with evidence counts), and subjects that didn't get any completed work. Historical desktop-only sessions still appear in the analytics charts below.

**Plan from this review** suggests a handful of follow-up tasks. Pick the ones you want and tweak their title, date, and duration before adding them to your calendar. Adding again skips any tasks already created from that review. Because weekly totals read your live records, moving or deleting an old plan updates that week's review too.

## Backups and recovery

**Settings → Backup and recovery** keeps recently deleted items and dated backups in a separate IndexedDB database on this device, scoped to your account. Focal saves the first backup of each active day (up to 14 backups) and keeps up to 100 deletion groups for 30 days. **Back up now** saves an extra snapshot whenever you like. Local deletions store a recovery copy before committing, and synced deletions are captured as soon as this device sees them.

Restore previews show exactly what will come back. By default, restoring brings back missing records without touching your current edits. Dated backups also let you replace your app data and preferences completely, showing before-and-after counts, and both options save a safety backup first. Exams, mistakes, SACs, events, tasks, skills, goals, and ATAR estimates keep their original IDs. Existing study sessions stay put, while missing sessions come back as regular study sessions with new IDs (since cancelled sessions can't be reopened). Live timers are never restarted from a backup, and any open intervals are frozen at capture time.

Dated backup exports bundle your app data and saved study sessions. Importing one adds it to **Dated backups** so you can preview it first; importing an older app-data JSON file offers to replace your data after saving a safety copy. Because recovery history only lives on this device, export a backup now and then if you want a copy outside browser storage. Remote changes made while this device was closed can only be recovered if an earlier backup captured them.

Manual check: create a multi-block plan, edit, duplicate, and reschedule it, start it from the calendar and timer, pause, resume, reload, and finish. Check that the ID, subject, notes, topics, and original schedule stay intact and only measured time is recorded. Try it both signed out and signed in offline, reconnect both clients, and confirm there's one shared session. Edit the same plan on a second device while the editor is open and check that the stale save is rejected. Also test the timer and editor at phone width.
