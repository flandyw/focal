# Planning and tracking study


Plan study from the calendar or Study timer, with a subject, notes, topics and up
to 100 non-overlapping blocks (each up to 24 hours). The timer lists all, today,
overdue and upcoming plans, with search, edit, duplicate, delete and quick
rescheduling. Folio supports the same plan fields and management actions in its
Study screen and sessions panel; its editor timer can start those shared plans.

Starting from a calendar block now runs that session's ID, rather than creating
another session with a copied title. Scheduled intervals are replaced by measured
work intervals, while the original schedule stays in metadata as a duration goal.
Pauses never count. Finish explicitly when done; reaching the goal does not stop
the timer. Focal's timer can resume or finish sessions started in Folio too.

Plans and lifecycle actions work locally when signed out. Signed in, commands are
committed to the existing IndexedDB outbox before delivery, and queued lifecycle
changes immediately appear in the shared list. The last canonical account-specific
session list is cached in IndexedDB for offline reopening. Pending starts, pauses
and resumes retain order; account changes and edits based on an outdated revision
are rejected. Folio retains a refused plan draft for explicit review and resaving.
No new Supabase migration or notebook format is required.

Manual verification: create a multi-block plan, edit/duplicate/reschedule it, start
it from the calendar and timer, pause/resume, reload, and finish. Verify the ID,
subject, notes, topics and original schedule survive, and only measured time is
recorded. Repeat signed out and signed in offline; reconnect both clients and
verify one shared session. Edit the same plan on another device while its editor
is open and verify a stale save is refused. Test a phone-width timer and editor.

