# Focal macOS widgets

Five native SwiftUI widgets for macOS 14+: **Up Next** and **ATAR** (small, medium, large), plus **Exam Countdown**, **Study Today**, and **Review Queue** (small, medium). Clicking any widget jumps straight to that screen in Focal.

Focal writes a small snapshot from your synced account data: classes and calendar events, tracked exams and SACs, actual study minutes (with overlapping sessions merged), daily targets, due mistake cards, and a live ATAR estimate (paired with your active ATAR goal). On the ATAR page, the **Desktop widget** card shows exactly what was sent and lets you pick the source (latest saved scenario, live Focal estimate, or a pinned scenario), choose what's displayed, set the target, or trigger a refresh. Those preferences stay on this Mac only, and clicking the ATAR widget opens that card. The widget extension never sees Supabase tokens or credentials, signing out clears the snapshot, and gallery previews only use sample data.

While Focal is open and synced, it updates the snapshot shortly after changes and refreshes study minutes every minute (WidgetKit decides exactly when to redraw). When Focal is closed, widgets read the cached snapshot and still handle upcoming event transitions, review due dates, and midnight rollovers. They don't sync with Supabase on their own, so open Focal to pull fresh data. Stale snapshots display a gentle reminder to open the app.

## Building and installing

`bun run tauri build` compiles and bundles both the WidgetKit extension and the small Swift publisher during macOS builds (including both macOS CI jobs). Architecture and version match the main app, and you don't need a paid Apple developer account, provisioning profile, extra dependencies, or CI secrets. Windows and Linux builds are untouched.

To compile the native widget pieces on their own on a Mac with Xcode installed:

```sh
bun scripts/build-macos-widget.ts
```

Outputs land in `src-tauri/target/widget/`:

- `FocalWidget.appex` (bundled into `Focal.app/Contents/PlugIns/`)
- `focal-widget-publisher` (bundled into `Focal.app/Contents/MacOS/`)

The publisher atomically writes a private (`0600`) JSON file at `~/Library/Application Support/com.andy.focal/widgets.json` and asks WidgetKit to reload. The sandboxed extension has a read-only exception for that exact file so it works with ad-hoc signing (switch to an App Group if you ever distribute with a team signing identity). Neither binary stores account secrets; ad-hoc signatures don't provide Developer ID trust or notarisation.

Copy Focal into Applications, open it, and let your account sync. Then open **Edit Widgets** on your Mac desktop and search for **Focal**. The older preview widget kind is preserved and becomes **Up Next**, and you can add the others from the gallery.

If the widgets don't show up, check registration and code signing:

```sh
pluginkit -m -A -D -v -i com.andy.focal.widget
codesign --verify --deep --strict --verbose=2 /Applications/Focal.app
codesign -d --entitlements :- /Applications/Focal.app/Contents/PlugIns/FocalWidget.appex
```

Double-check widget rendering and clicks on a real install separately from compilation, and test Intel execution and CI updates on matching hardware.
