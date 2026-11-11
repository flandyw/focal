# Focal branding

## Mark: Study Grid

Four rounded tiles: three filled blocks of study and one ticked off. It stands for planned work getting done, which is what the app does.

- `focal-icon.svg`: the forest tile. This is the canonical app icon (desktop, PWA, Apple touch, notifications).
- `focal-mark-light.svg`: the pale sage tile, for light backgrounds outside the app.

Inside the app, `src/components/focal-mark.tsx` draws the mark from `currentColor` and `--card`, so it follows the accent, sidebar tint, and theme. In the sidebar it is sized to the ascender height of the wordmark and optically centred on the visible lettering, with a 4px upward offset for Newsreader's line-box spacing.

`public/focal-icon.svg` is a copy of the app icon. `public/favicon.svg` contains both and switches with `prefers-color-scheme`. `public/apple-touch-icon.svg` is the full-bleed version for iOS and the maskable PWA icons.

## Palette

| Role | Hex | Where it's used |
| --- | --- | --- |
| Forest | `#0B4C37` | Light `--primary`, wordmark, app icon tile |
| Deep forest | `#043224` | End of the icon tile gradient (icon only) |
| Mint | `#A9CBB6` | Dark `--primary`, secondary tiles |
| Sage | `#DEE7DC` | Light icon tile |
| Paper | `#F9F7F0` | Tiles and the tick on forest |

The app UI stays flat. The gradient appears only on the icon tile.

## Wordmark

Lowercase `focal` in Newsreader (`font-heading`), tight tracking, set in `--sidebar-primary`, with the mark to its left (see `app-navigation.tsx`).

## Regenerating icons

```sh
bun run tauri icon branding/focal-icon.svg -o src-tauri/icons
mv src-tauri/icons/icon.icns src-tauri/icons/focal.icns
rm -rf src-tauri/icons/android
bunx tauri icon public/focal-icon.svg -o /tmp/a --png 192,512          # public/icon-*.png
bunx tauri icon public/apple-touch-icon.svg -o /tmp/m --png 180,192,512 # apple-touch-icon.png, icon-maskable-*.png
```

`public/badge-96.png` is a white grid on transparency, because Android uses only the alpha channel for notification badges. If you change the PWA icons, bump `CACHE` in `public/sw.js`.

## macOS icon wiring and stale icons

`src-tauri/tauri.conf.json` bundles `icons/focal.icns`. Tauri generates the
app's `Contents/Info.plist` with `CFBundleIconFile` pointing at this resource;
`WidgetInfo.plist` adds URL schemes and does not override the icon. Dock, Finder
and Launchpad use this bundle icon, not the sidebar SVG or the root `icon.png`.
The brand-specific filename replaces the historical `icon.icns` resource name
so an update also changes the icon reference. Keep the rename step above when
regenerating assets.

`scripts/build-macos-widget.ts` copies the same ICNS into the widget extension's
`Contents/Resources` and declares `CFBundleIconFile` before signing it. The
publisher helper has no separate app bundle. Widget content uses SF Symbols;
those are content illustrations, not alternative app icons.

There is no Electron configuration, Xcode project, `Assets.xcassets`,
`AppIcon.appiconset`, `CFBundleIconName`, or Icon Composer `.icon` in this project.
Tahoe therefore uses the bundled ICNS; there is no layered icon to regenerate.
The ICNS includes 16, 32, 64, 128, 256, 512 and 1024 pixel representations,
including Retina variants. All of its image payloads already matched freshly
generated output from `branding/focal-icon.svg` when Andy's report was investigated.
The old blue cards cannot be reproduced from this checkout. An older installed
bundle or a cached icon remains the likely cause; inspect the installed app
before assuming which one.

After installing the new build, quit Focal and eject the installer disk image.
Check the installed bundle (adjust `/Applications` if installed elsewhere):

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Focal.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' /Applications/Focal.app/Contents/Info.plist
open /Applications/Focal.app/Contents/Resources/focal.icns
```

The icon file must show the green Study Grid. If it does, refresh registration
and the shell icon caches:

```sh
touch /Applications/Focal.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Focal.app
killall Dock
killall Finder
```

If still stale, clear the system IconServices cache and this user's transient
icon caches, then repeat registration and restart the Mac. Cache removal affects
other apps' cached icons too; they will be rebuilt. These commands do not reset
Dock preferences or delete the Launchpad database.

```sh
sudo rm -rf /Library/Caches/com.apple.iconservices.store
find "$(getconf DARWIN_USER_CACHE_DIR)" -name 'com.apple.iconservices*' -exec rm -rf {} +
find "$(getconf DARWIN_USER_CACHE_DIR)" -name 'com.apple.dock.iconcache' -delete
touch /Applications/Focal.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Focal.app
killall iconservicesagent 2>/dev/null || true
killall Dock
killall Finder
```

If the Dock still opens an older copy, remove that Dock shortcut, open
`/Applications/Focal.app`, and keep that running app in the Dock.
