# Mobile installation and notifications

## Installing Focal and turning on reminders

Open **Settings → Phone app** for install steps and **Settings → Notifications** to pick which alerts you want on this device (web or desktop).

On iPhone or iPad, add Focal via **Share → Add to Home Screen**, open it from your Home Screen icon, and then switch on reminders (requires iOS/iPadOS 16.4+). On Android, look for **Install app** or **Add to Home screen** in your browser menu. Installing needs HTTPS (except on localhost during development). Once opened, the service worker caches the app and handles notifications, so Focal still launches when you're offline. Android and desktop Chrome also show an **Install** button in Settings and a one-time install prompt on your second visit.

When you're signed in, you can opt into reminders for planned study, calendar deadlines and SACs, a daily study nudge, friends starting a session, and cheers, each with its own toggle. Shared-session invites follow the Friends toggle (migration `0043_friend_study_sessions.sql`), and accepted scheduled sessions use your normal planned-study reminders. Plans created in Folio are included once synced. Planned blocks let you choose 0–60 minutes of notice; deadlines let you pick same-day, 1-, 3-, or 7-day notice at your chosen time (or the deadline's start if that's earlier on the day). Already-started, finished, or cancelled sessions are skipped. Notification text stays generic so subject names, study titles, and friend names don't show up on your lock screen. Subscriptions belong to each browser installation; signing out or switching accounts revokes the previous account's subscription.

Quiet hours follow your device's saved time zone and skip alerts instead of queueing them up (setting the same start and end time mutes all day). Deadline and daily reminders start turned off. Focus, break, exam reading, exam writing, and SAC time-up alerts each have their own toggle; focus and break alerts also respect **Study timer → Pomodoro settings → Alerts and flow → Notifications**.

With reminders turned on, your timer's next finish time is queued in `push_timer_alerts` and sent as a regular push notification, so it still reaches a locked phone within the one-minute dispatch tick. Pausing or stopping clears the queued alert. If the page is open, it shows the alert directly and removes the queued row. Both share the tag `timer:<key>` so you'll never get duplicate pings. Without reminders enabled, timer alerts only fire while Focal is open and may be delayed by the browser.

The daily nudge skips itself once you've started a study session that day. Your Home Screen icon can also show a badge count for due mistakes and planned tasks (**App icon badge** in Notifications), and opening the app clears delivered notifications.

## Desktop notifications

The desktop app uses Tauri's native notification plugin. Synced study and friend reminders are checked every 30 seconds while Focal is open or minimised (this needs sign-in, an internet connection, and migration `0036_notification_preferences.sql`). Timer alerts work even without an account, and closing the desktop app stops alerts. The test notification button ignores quiet hours. Native delivery should still be verified on packaged macOS, Windows, and Linux builds.

## Setting up Web Push

To turn on closed-app push notifications:

1. Apply the Supabase migrations in order (including `0033_web_push.sql`, `0034_web_push_wakeup.sql`, `0036_notification_preferences.sql`, and `0042_timer_push_alerts.sql`) before deploying the updated push server. Existing subscription choices stay intact.
2. Generate a persistent VAPID key pair with `bunx web-push generate-vapid-keys --json`. Set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` on the server alongside your Supabase URL and service-role key. `WEB_PUSH_SUBJECT` must be a real `mailto:` address or public HTTPS contact URL. Keep the private key stable and server-only; rotating it means devices have to turn reminders off and back on.
3. Set a private random `CRON_SECRET` on the server and schedule a job to hit `GET` or `POST /api/push?dispatch=1` every minute over HTTPS with an `Authorization: Bearer <CRON_SECRET>` header (never put the secret in the URL). On Vercel Pro, a cron job for `/api/push?dispatch=1` with schedule `* * * * *` sends `CRON_SECRET` automatically. Vercel Hobby only supports daily cron, so use an external scheduler or Supabase Cron there.
4. Deploy and switch on reminders from the installed app. Alerts begin for events scheduled after that device opts in. Make sure notifications are allowed in your OS and browser settings.

For Supabase Cron, turn on `pg_cron` and `pg_net` in your dashboard, save the same cron secret in Vault as `focal_push_cron_secret`, and run this SQL (swap in your deployed Focal origin):

```sql
select cron.schedule('focal-web-push', '* * * * *', $$
  select net.http_post(
    url := 'https://your-focal.example/api/push?dispatch=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'focal_push_cron_secret'
    )),
    body := '{}'::jsonb
  );
$$);
```

Migration `0034_web_push_wakeup.sql` also pings the dispatcher straight from the database when a friend starts studying or sends a cheer, so those alerts arrive in seconds instead of waiting for the next minute tick. Save the full dispatch URL in Vault to enable it (without it, the triggers are no-ops and the cron still handles delivery):

```sql
select vault.create_secret('https://your-focal.example/api/push?dispatch=1', 'focal_push_dispatch_url');
```

Keep the cron running too, since planned-study, deadline, daily reminders, and retries all rely on it.

Each tick claims up to 50 deliveries, retries transient failures after five minutes, and cleans up expired browser endpoints. Events older than 15 minutes are skipped so a scheduler hiccup won't flood anyone with stale alerts. Delivery can still be delayed or held by the OS, Focus modes, or patchy networks. Watch for non-200 scheduler responses and raise the batch size if 50 deliveries per tick starts filling up. Subscriptions and delivery receipts live server-side only, outside the sync feed and exported study data. After deploying, test delivery on a real iPhone and Android device.
