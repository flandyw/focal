# Studying with friends

Friends → Together combines three flows in the shared web/desktop interface:

- **Open desk:** start a session, allow accepted friends or invite specific friends, and study with independent personal timers. Desks close after 12 hours or when the host ends them.
- **Focus round:** share a server-timed focus countdown followed by a break. Late joiners see the time remaining. The shared clock never starts, pauses or stops a personal timer.
- **Scheduled session:** plan up to 90 days ahead and invite friends. Accepting before the start creates one personal canonical study plan, visible in Calendar, Focus and Folio. Existing notification preferences govern reminders.

The session view shows participants, outstanding invitations, a private task field for opening a new personal timer, and controls to join, leave or end the shared session. Focus keeps a compact shared clock with a link back to Friends. An existing timer always takes precedence over starting a planned session. Activity & sharing retains the existing leaderboard, comparisons, cheers, groups and profile controls.

Invitations can be declined or withdrawn. Leaving cancels an untouched personal plan; host cancellation does the same for all members. Running and completed study remains intact. Cancellation publishes normal canonical-session feed events, preserving existing sync identifiers.

Access is enforced by authenticated RPCs in `0043_friend_study_sessions.sql`. Tables have RLS enabled and no client table grants. Only the host can invite or end a room; recipients must still be accepted friends of the host. Room membership shares names and attendance, not personal subjects, tasks or exam data. Invitation alerts follow the existing Friends notification switch and quiet hours.

The interface reuses Instrument Sans, Newsreader, semantic theme variables, existing buttons, tabs, dialogs, inputs and avatars. It adds no theme overrides or dependencies. Desktop uses a content-and-participants split; narrow screens stack participants beneath the session. Status always has a text label, controls retain keyboard focus, and the countdown is not a live region.

Limits: 20 active/upcoming hosted sessions, 32 invited friends per session, a 100-session visible window, and presence refresh every 10 seconds while the app is visible. Session clocks tick locally from Focal’s server-clock estimate. Personal timer controls and alerts remain independent, including at shared break boundaries. Delivery on physical devices and visual browser verification still need checking after deployment; the production database is not changed by the local build.
