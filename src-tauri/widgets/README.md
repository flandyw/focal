# macOS widget packaging probe

This is a static SwiftUI/WidgetKit widget, deliberately without Supabase data or
App Groups until an ad-hoc signed CI download is confirmed to load on macOS.
It supports small and medium widgets on macOS 14 or later. It does not raise
the minimum macOS version of the containing Focal app.

`bun run tauri build` automatically compiles it before macOS bundling, including
both existing macOS release jobs. No extra CI secrets, developer membership,
Xcode project, or dependencies are required. The widget architecture and version
match the app. Linux and Windows builds are unaffected.

To compile just the extension on a Mac with Xcode installed:

```sh
bun scripts/build-macos-widget.ts
```

The output is `src-tauri/target/widget/FocalWidget.appex`. Tauri copies it to
`Focal.app/Contents/PlugIns/` before signing and creating the installer and
updater archive. Both the extension and app use ad-hoc signatures, which do not
provide Developer ID trust or notarization.

## Try the CI download

1. Download the correct macOS release and quit the running Focal app.
2. Install the downloaded Focal into Applications, replacing the older copy.
3. Open Focal once, then right-click the desktop and choose **Edit Widgets**.
4. Search for **Focal** and add **Focal Preview**, in either size.
5. Confirm it renders “Ready to focus.” and the downloaded release version.

Finding the widget in the gallery and seeing its content are separate checks:
successful compilation or registration alone does not prove rendering works.
Repeat with a later CI version to verify updates, and on Intel if available.

If macOS blocks this unnotarized download, approve it in **System Settings →
Privacy & Security**. If Focal opens but the widget is absent, inspect its
registration and signature:

```sh
pluginkit -m -A -D -v -i com.andy.focal.widget
codesign --verify --deep --strict --verbose=2 /Applications/Focal.app
codesign -d --entitlements :- /Applications/Focal.app/Contents/PlugIns/FocalWidget.appex
```

Ad-hoc widget discovery and execution after download remain experimental. Do not
disable Gatekeeper or change global security settings to make the probe work.
Supabase integration is a separate next step after this installation check.
