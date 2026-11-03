# Focal macOS widgets

Four native SwiftUI widgets for macOS 14+: **Up Next** (small, medium, large),
**Exam Countdown**, **Study Today**, and **Review Queue** (small, medium).
Click a widget to open the corresponding Focal screen.

Focal publishes a small snapshot from its existing Supabase-synced account data:
classes and calendar events, tracked exams and SACs, actual study minutes with
overlapping sessions merged, daily goals, and due spaced-repetition cards.
The extension never receives a Supabase token or database credentials.
Signing out clears the snapshot. Gallery previews use sample data only.

While Focal is open and synced, it publishes changes after a short debounce and
refreshes study minutes every minute. WidgetKit controls when those changes render.
While Focal is closed, widgets use cached data and schedule event transitions,
review due dates, and midnight changes. They do not independently sync Supabase;
open Focal to fetch fresh data. Old snapshots show an update reminder.

## Building and installing

`bun run tauri build` compiles and packages both the WidgetKit extension and a
small Swift publisher during macOS bundling, including both existing macOS CI jobs.
Architecture and version match the app. No paid developer account, provisioning
profile, new dependency, or CI secret is required. Windows and Linux are unaffected.

To compile the native components independently on a Mac with Xcode installed:

```sh
bun scripts/build-macos-widget.ts
```

Outputs in `src-tauri/target/widget/`:

- `FocalWidget.appex`, packaged into `Focal.app/Contents/PlugIns/`.
- `focal-widget-publisher`, packaged into `Focal.app/Contents/MacOS/`.

The publisher atomically writes a private (0600) JSON file at
`~/Library/Application Support/com.andy.focal/widgets.json` and tells WidgetKit
to reload. The sandboxed extension has a read-only exception for that exact file.
This supports the existing ad-hoc signing setup; migrate the file to an App Group
when distributing with a team identity. Neither executable stores account secrets.
Ad-hoc signatures provide no Developer ID trust or notarization.

Install the app into Applications, open it and let the account sync, then choose
**Edit Widgets** from the desktop and search **Focal**. The old preview widget kind
is preserved and becomes Up Next. Add the other widgets from the gallery.

If discovery fails, inspect registration and signing:

```sh
pluginkit -m -A -D -v -i com.andy.focal.widget
codesign --verify --deep --strict --verbose=2 /Applications/Focal.app
codesign -d --entitlements :- /Applications/Focal.app/Contents/PlugIns/FocalWidget.appex
```

Rendering and clicking the installed widgets are separate checks from compilation.
Intel execution and CI download/update behavior require verification on those installs.
