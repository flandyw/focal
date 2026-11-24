# Studying with friends

The **Study together** section at the top of **Friends** brings three ways to study with people into the shared web and desktop interface:

- **Open desk:** open a room for all accepted friends or invite specific people, and study side by side with your own independent timers. Desks close automatically after 12 hours or whenever the host ends them.
- **Focus round:** run a shared server-timed focus countdown followed by a break. Friends who join late see the exact time left, and the shared clock never starts, pauses, or stops your personal timer.
- **Scheduled session:** plan a session up to 90 days ahead and invite friends. Accepting before it starts creates a personal canonical study plan that shows up in Calendar, Focus, and Folio, with reminders following your normal notification settings.

Inside a session, you can see who's there, check pending invitations, jot down a private task to launch a new personal timer, and join, leave, or end the room. **Focus** keeps a compact shared clock handy with a link back to Friends. If you already have a timer running, it always takes priority over starting a planned session. Below Study together, the rest of Friends stays on one page (requests, the study-time leaderboard, cheers, groups, and upcoming exams), with adding a friend and profile & sharing tucked into dialogs.

Invitations can be declined or withdrawn at any time. Leaving a room cancels an untouched personal plan, and if the host cancels the session, untouched plans are cancelled for everyone. Running and completed study sessions are never touched. Cancellations publish normal canonical-session feed events so existing sync identifiers keep working.

Access is handled by authenticated RPCs in `0043_friend_study_sessions.sql`, with RLS enabled and no direct client table grants. Only the host can invite people or end a room, and invitees must still be accepted friends of the host. Joining a room shares names and attendance, never your personal subjects, tasks, or exam data. Invitation alerts follow your existing Friends notification switch and quiet hours.

The UI reuses Instrument Sans, Newsreader, semantic theme variables, and the existing buttons, tabs, dialogs, inputs, and avatars, with no theme overrides or extra dependencies. Desktop uses a side-by-side split for session details and participants, while narrow screens stack participants underneath. Status always includes a text label, controls keep keyboard focus, and the countdown stays out of live regions.

Limits: up to 20 active or upcoming hosted sessions, 32 invited friends per session, a 100-session visible window, and presence refreshes every 10 seconds while the app is open. Session clocks tick locally using Focal's server-clock estimate, and your personal timer controls and alerts stay independent, even when a shared break starts. After deploying, double-check real-device delivery and visual layout in a browser; local builds don't modify the production database.
