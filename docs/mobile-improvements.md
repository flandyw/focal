# Mobile improvements

Focal's phone app is the installable web app. This pass covers speed, notifications and polish, using no new dependencies. Each item below is one shipped behaviour change.

First-load JavaScript went from 316 KB to 297 KB gzipped (entry chunk 863 KB to 772 KB raw), and a 558 KB dataset no longer downloads ahead of the first paint.

## Speed

1. Stop preloading the 558 KB grade dataset on every launch.
2. Load reference data in idle time on pages that don't use it (Calendar, Timer, Mistakes, Friends, Settings, Timetable); pages that need it still load it at once.
3. Take zod out of the entry chunk with a small validator of the same rules.
4. Warm only the daily pages and form sheets, not every page and its chart library.
5. Warm chunks one at a time in idle gaps rather than all at once.
6. Skip warming on 2G and 3G as well as Data Saver.
7. Preconnect to the database before the first sync.
8. Paint the saved background colour immediately, so a dark launch never flashes light.
9. Match the status bar to that colour before JavaScript runs.
10. Show a static Focal wordmark while the app loads instead of a blank screen.
11. Highlight the tapped tab instantly, before the page has rendered.
12. Keep the current page up while the next one loads, instead of flashing a spinner.
13. Delay the page spinner, so fast loads never show it.
14. Delay the first update check past launch, so it doesn't compete with first paint.
15. Check for updates at most every five minutes when switching back to the app.
16. Re-verify the push subscription every six hours, not on every app focus.
17. Cache fonts at the CDN for 30 days.
18. Cache reference datasets at the CDN with stale-while-revalidate.
19. Downsize photos added to mistakes, so camera shots pass the 5 MB limit and sync faster.
20. Downsize photos sent for AI import the same way.
21. Decode saved question images lazily and off the main thread.

## Notifications

22. Deliver focus and break endings to a locked phone through server push.
23. Deliver exam reading and writing endings the same way.
24. Deliver SAC endings the same way.
25. Retract a queued alert when the timer is paused, stopped or replaced.
26. Remove the queued push when the open page has already alerted.
27. Skip a local alert if the push for it is already showing.
28. Drop alerts from a page that wakes more than two minutes late.
29. Never cancel a timer alert queued by another device.
30. Send pushes as high urgency, so Android's Doze doesn't hold them.
31. Expire timer pushes after three minutes; a stale "time's up" is noise.
32. Use a meaningful title on timer notifications instead of "Focal".
33. Use a monochrome Android badge; the full-colour icon rendered as a blob.
34. Vibrate on arrival.
35. Stamp notifications with their real time.
36. Re-register immediately when the browser rotates the push subscription.
37. Move quiet hours and daily reminders to the phone's new time zone automatically.
38. Show mistakes and planned tasks due on the Home Screen icon.
39. Add an App icon badge switch in Notifications.
40. Clear delivered notifications when the app opens.
41. Skip the daily study nudge once a session has started that day.
42. Ask for alert permission when a timer first starts, the moment it makes sense.
43. Open the Timer tab from a SAC alert, including when the app is already open.
44. Stop test notifications jumping to the Study timer when tapped.
45. Fall back to a fresh launch if iOS refuses to focus a suspended window.
46. Correct the settings copy that said timers need Focal open.
47. Correct the timer help text the same way.

## Navigation and app shell

48. Give every page a history entry, so Android's back button stops quitting the app.
49. Back closes dialogs before leaving the page.
50. Back closes side sheets, including More.
51. Back closes confirmation dialogs.
52. Back closes full-screen search.
53. Back closes the exam editor.
54. Back respects unsaved-changes prompts instead of discarding work.
55. Skip dead history entries left by closed dialogs, so Back never appears to do nothing.
56. Open each new page at its top rather than part-way down.
57. Restore a page's scroll position when returning to it.
58. Tapping the current tab scrolls to the top.
59. Clear launch links from the URL, so a reload returns to the saved page.
60. Let `?view=` deep-link to any page.
61. Add a Review mistakes Home Screen shortcut.
62. Add a Log a mistake Home Screen shortcut, which opens the form.
63. Give shortcuts icons.
64. Add maskable icons, so Android launchers don't letterbox the app icon.
65. Declare language and app categories in the manifest.
66. Allow any screen orientation in the manifest.
67. Declare the standard `mobile-web-app-capable` tag.
68. Stop phones turning dates and numbers into tappable links.
69. Follow the app's colour scheme in native date and time pickers.
70. Lock the text scale when rotating, so iOS doesn't resize the page.
71. Add an Install button to Settings on supported browsers.
72. Suggest installing once, from the second launch, and never again after dismissal.
73. Show an Offline chip in the phone header.
74. Replace the browser's error page with a friendly one on a first launch with no connection.
75. Precache notification icons, so alerts render on a poor connection.
76. Correct the Settings text that said an internet connection is needed to load Focal.

## Keyboard and forms

77. Track the software keyboard for layout on iOS and Android.
78. Hide the tab bar while typing.
79. Lift bottom-sheet dialogs above the keyboard.
80. Shrink side sheets to the visible area, keeping Save reachable.
81. Keep full-screen search results above the keyboard.
82. Keep the exam editor scrollable above the keyboard.
83. Keep the chat composer above the keyboard.
84. Lift toasts above the keyboard.
85. Centre the focused field when the keyboard opens.
86. Keep fields reached by Tab or Next clear of the fixed bars.
87. Stop text fields opening the keyboard by themselves on phones, covering the form.
88. Do the same for text areas, including chat.
89. Show the decimal pad on all number fields; 50 of 52 had the full keyboard.
90. Select a number field's contents on focus, so a pre-filled 0 is replaced by typing.
91. Stop capitalising email and URL fields.
92. Label the keyboard's action key Search in search fields.
93. Label it Send in chat.
94. Stop iOS date and time fields overflowing the form.
95. Left-align their values.
96. Remove the unusable text-area resize handle on touch.
97. Remove iOS's rounded default styling from search fields.

## Touch

98. Give every button a 44px minimum width; duration chips were as narrow as 32px.
99. Give disclosure rows a 44px height; they were 20px.
100. Give standalone links a 44px height; some were 16px.
101. Give checkboxes, switches and radios a 44px touch area without resizing them.
102. Stop a long press selecting a button's label.
103. Hide keyboard-shortcut hints on touch screens.
104. Show the chat row menu on touch tablets, where it only appeared on hover.
105. Show Friends day-track details on tap.
106. Show Friends chart details on tap.
107. Show consistency heatmap details on tap.
108. Let swipes across a chart scroll the page.
109. Remove the focus box from tapped charts.
110. Export through the share sheet on phones; `<a download>` fails in installed iPhone apps.
111. Share friend invites through the share sheet.
112. Swipe left and right to change the day in Calendar.
113. Drag a bottom-sheet dialog down to close it, with a visible handle.
114. Give the tab bar a press animation.
115. Add a light haptic on tab changes (Android).
116. Add one on review ratings.
117. Add one when a timer ends with the app open.
118. Stop the tab count covering the active tab's label.
119. Expose tab counts to screen readers properly.
120. Open the timetable on today's column.
121. Snap timetable columns when scrolling.

## Layout

122. Keep the review rating panel above the tab bar; Good and Easy were hidden behind it.
123. Tighten rating buttons, so more of the card stays visible.
124. Put form-sheet actions in one row, giving back about 75px.
125. Compact sheet headers on phones.
126. Keep long sheet descriptions for screen readers only on phones.
127. Keep sheet close buttons clear of the status bar.
128. Keep sheet headers clear of the status bar.
129. Keep tall dialogs clear of the status bar.
130. Keep the exam editor inside the safe areas.
131. Use the dynamic viewport in the SAC marking dialog.
132. Use it in the paper performance dialog.
133. Use it for the More sheet's width.
134. Keep content clear of the notch in landscape; the old rule could never apply.
135. Shrink the tab bar in landscape and move it aside.
136. Remove the large page top gap in landscape.
137. Stop sideways scrolling triggering browser back.
138. Hide scrollbars on scrolling tab rows.

## Reliability

139. Keep the timer accurate through phone sleep; the old clock stopped while locked.
140. Save when the app is hidden; iOS can kill it without any later warning.
141. Keep the screen on during timed papers and SACs.
142. Keep it on during focus timers.
143. Add a Keep screen on switch to timer settings.

## Clarity

144. Fix "1 marks lost" in mistake rows.
145. Fix plurals in review results.
146. Fix plurals in Stoplight revise.
147. Fix plurals in bulk edit and re-import previews.
148. Fix plurals in the VCAA library count.
149. Fix plurals in timeline merges and exam mapping messages.
150. Fix the plural in the reduce-reviews preview.
151. Remove "Difficulty unrated" from mistake rows.
152. Remove the "Difficulty unrated" badge from review cards.
153. Explain Friends before asking a signed-out person to sign in.

## Validation

- `bun run check`, `bun run build`, `bun run build:desktop`, and the 48 existing tests.
- A headless Chromium phone viewport against a production build with the service worker: deep links, Back through pages and overlays, the unsaved-changes guard, scroll memory, tab re-tap, offline cold start, and tap-target and overflow audits at 320, 390 and 768 px.
- Migration `0042_timer_push_alerts.sql` executed in Postgres against stub tables: delivery, single claim, per-type preferences, quiet hours, daily suppression, row-level security and path validation.
- The new preference validator compared with the zod rules it replaced over 22 valid and invalid inputs.

Not exercised: a physical iPhone or Android device, real push delivery, a real software keyboard (its layout rules were checked with a simulated inset), haptics, the install prompt, the share sheet, the wake lock, and a signed-in account against live Supabase.
