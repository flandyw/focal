# Mobile installation and notifications

## Install and enable reminders

Open **Settings > Mobile app** for installation instructions and **Settings > Notifications**
for per-device reminder controls on web and desktop.
On iPhone/iPad, install Focal with **Share > Add to Home Screen**, launch its icon,
then enable reminders (iOS/iPadOS 16.4+). Android browsers offer **Install app** or
**Add to Home screen** in their menu. Installation requires HTTPS, except localhost
for development. The service worker handles notifications; it does not cache the
app for offline loading.

Signed-in users can opt into planned study, calendar deadlines and SACs, a daily
study nudge, friends starting study, and received cheers. Each type has its own
switch. Plans made in Folio are included once synced. Planned blocks support 0–60
minutes of notice; deadlines support same-day, 1-, 3-, or 7-day notice at the
chosen daily time (or the deadline's start if earlier on the same day). Started,
completed and cancelled study is skipped. Text is generic, without subject
names, study titles, or friend names. Subscriptions are per browser installation;
signing out or switching accounts revokes the previous account’s subscription.
Quiet hours use the saved device timezone and skip alerts rather than queueing
them; identical start and end times mute the whole day. New deadline and daily
reminders default off. Focus, break, exam reading, exam writing and SAC time-up
alerts have separate controls. Focus and break alerts also follow **Study timer >
Pomodoro settings > Alerts and flow > Notifications** and need the Study timer page
open. Timed-paper and SAC alerts work on any page. All timer alerts need the app
running and may be delayed by browser background suspension.

## Desktop notifications

Desktop uses Tauri's notification plugin. Synced study and friend reminders are
checked every 30 seconds while Focal is running or minimized; they require sign-in,
internet access and migration `0036_notification_preferences.sql`. Timer alerts
work without an account. Closing the desktop app stops alerts. The test button
bypasses quiet hours. Native delivery still needs verification on packaged macOS,
Windows and Linux builds.

## Configure Web Push

To activate closed-app push:

1. Apply the Supabase migrations in order, including `0033_web_push.sql`,
   `0034_web_push_wakeup.sql` and `0036_notification_preferences.sql`, before deploying
   the updated push server. Existing subscription choices are preserved.
2. Generate a persistent VAPID pair with `bunx web-push generate-vapid-keys --json`.
   Set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` on the
   server, together with the existing Supabase URL and service-role key.
   The subject must be a real `mailto:` address or public HTTPS contact URL.
   Keep the private key stable and server-only; changing keys requires devices to
   disable and re-enable reminders.
3. Set a private random `CRON_SECRET` on the server. Configure a scheduler to call
   `GET` or `POST /api/push?dispatch=1` once a minute over HTTPS, with an
   `Authorization: Bearer <CRON_SECRET>` header. Never put the secret in the URL.
   Vercel Pro can use a cron entry with path `/api/push?dispatch=1` and schedule
   `* * * * *`; Vercel sends `CRON_SECRET` automatically. Vercel Hobby only permits
   daily cron, so use an external scheduler or Supabase Cron instead.
4. Deploy and enable reminders from the installed app. Delivery begins with events
   after enabling that device. Allow notifications in the OS and browser settings.

For Supabase Cron, enable `pg_cron` and `pg_net` in the dashboard. Save the same
cron secret in Vault as `focal_push_cron_secret`, then schedule this SQL (replace
the example origin with the deployed Focal origin):

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

Migration `0034_web_push_wakeup.sql` also calls the dispatcher straight from the
database when a friend starts studying or sends a cheer, so those alerts arrive in
seconds instead of on the next cron tick. Save the full dispatch URL in Vault to
turn it on (without it, the triggers do nothing and the cron still delivers):

```sql
select vault.create_secret('https://your-focal.example/api/push?dispatch=1', 'focal_push_dispatch_url');
```

Keep the cron: planned-study, deadline and daily reminders, plus retries, still depend on it.

The sender claims up to 50 deliveries per tick, retries interrupted/transient
failures after five minutes, and deletes expired browser endpoints. Events older
than 15 minutes are skipped, so a scheduler outage does not flood devices with
old alerts. Delivery may be delayed or suppressed by the OS, Focus modes, or
network conditions. Monitor non-200 scheduler responses and increase capacity if
the 50-delivery batch regularly fills. Subscriptions and delivery receipts are
server-only, outside the sync feed and exported study data. Revalidate delivery
on a physical iPhone and Android after deployment.

