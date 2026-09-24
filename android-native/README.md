# Focal for Android

Native Kotlin and Jetpack Compose app for Focal's calendar and study timer. It uses Android SQLite, Android Keystore, Material 3, dynamic color, a themed launcher icon, a wall-clock timer with alarm recovery, and local audio playback controls. It does not load the desktop UI in a WebView.

## Build

Install JDK 17 and Android SDK 35. Open this directory in Android Studio, or run `./gradlew :app:assembleDebug` (`gradlew.bat` on Windows). The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

Set `sdk.dir` in an untracked `local.properties` file if Android Studio has not configured the SDK. The build reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the parent repo's untracked `.env`. You can override them with `FOCAL_SUPABASE_URL` and `FOCAL_SUPABASE_PUBLISHABLE_KEY` as environment variables, Gradle properties, or entries in this project's `local.properties`. Use only a publishable or legacy anon key. The app needs the Focal Supabase migrations in the parent repo applied to that project.

## Sync behavior

- Account login uses the same Supabase Auth project as desktop. Events, study sessions, subjects, and other Focal records are read from the `sync_changes` log. Local edits use a SQLite outbox and stable change IDs. The app pulls before uploading a guest's data on first sign-in. It syncs on app resume, after edits, and every minute while open.
- The Notion integration uses the same database property names and stable `Focal ID` / `Focal Kind` columns as desktop. Configure the token on each device; it stays encrypted in Android Keystore. The database ID and property mapping sync through Focal account settings. Notion edits with overlapping local edits are held for a choice in Account.
- The focus timer writes schema v2 Focal study sessions and records actual work intervals. Its persisted deadline closes a session at the intended time after a pause, app restart, or delayed Android alarm. Android may delay the notification; the recorded study duration remains based on the deadline.
- Music controls play an audio file selected from the device. Focal does not connect to a streaming provider.

The native build is verified with `:app:assembleDebug`. The debug app runs an assert-based timer and session check at startup. Live account and Notion round-trip verification requires signing in to those services on a device.

## Releases and updates

The `app-vX.Y.Z` GitHub Actions release builds a signed native APK alongside the desktop assets. Android `versionName` and monotonically increasing `versionCode` come from the root `package.json`; the tag must match it. Configure Actions secrets `ANDROID_KEYSTORE_BASE64` (base64 of the release `.jks` file), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Keep this signing key for every future release: Android will reject an update signed by another key. The existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` secrets are also required. The workflow checks the APK signature and uploads `Focal-Android.apk` plus `android-update.json` to the same GitHub Release. PR verification builds the debug APK and runs the manifest self-check.

The Account screen checks `releases/latest/download/android-update.json` on app start or resume, normally once per day with jitter, and allows a manual check. It requests the static asset rather than the GitHub REST API, caches its ETag, and persists backoff across app restarts. `403`/`429` responses honor `Retry-After` and GitHub rate reset headers; other failures back off exponentially. A newly published release may return `404` while the Android job finishes, so the app retries later. The app downloads an update only when you tap Install, verifies its size and SHA-256, then opens Android's package installer. Android may ask you to allow installs from Focal first. Existing installations update in place only when signed with the same key. GitHub Actions retries release creation and asset uploads with one minute exponential waits.
