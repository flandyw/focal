# Focal branding

## The mark: Study Grid

Four rounded tiles: three filled study blocks and one ticked off, showing planned work getting done, which is what Focal is all about.

- `focal-icon.svg`: the blue tile, used as the main app icon (desktop, PWA, Apple touch, and notifications).
- `focal-mark-light.svg`: the pale blue tile, meant for light backgrounds outside the app.

Inside the app, `src/components/focal-mark.tsx` draws the mark with `currentColor` and `--card`, so it automatically matches your accent colour, sidebar tint, and light/dark theme.

`public/focal-icon.svg` mirrors the main app icon. `public/favicon.svg` bundles both variants and switches with `prefers-color-scheme`. `public/apple-touch-icon.svg` is the full-bleed version for iOS and maskable PWA icons.

## Palette

| Role | Hex | Where it's used |
| --- | --- | --- |
| Blue | `#2A5FC4` | Default accent (light `--primary`) and app icon tile |
| Deep blue | `#173A85` | Bottom of the icon tile gradient (icon only) |
| Sky | `#AFC6EE` | Secondary tiles |
| Mist | `#E1E9F8` | Light icon tile |
| White | `#FFFFFF` | Tiles and the tick on blue |

The app UI itself stays flat; only the icon tile uses a gradient.

## Wordmark

Lowercase `focal` in the heading font (`font-heading`, semibold), paired with the mark on the left (see `app-navigation.tsx`).

## Regenerating icons

```sh
bun run tauri icon branding/focal-icon.svg -o src-tauri/icons
mv src-tauri/icons/icon.icns src-tauri/icons/focal.icns
rm -rf src-tauri/icons/android
bunx tauri icon public/focal-icon.svg -o /tmp/a --png 192,512          # public/icon-*.png
bunx tauri icon public/apple-touch-icon.svg -o /tmp/m --png 180,192,512 # apple-touch-icon.png, icon-maskable-*.png
```

`public/badge-96.png` is a white grid on a transparent background because Android reads only the alpha channel for notification badges. If you regenerate PWA icons, bump `CACHE` in `public/sw.js`.

## macOS icon wiring and stale icon caches

`src-tauri/tauri.conf.json` bundles `icons/focal.icns`, and Tauri sets `CFBundleIconFile` in `Contents/Info.plist` to point at it (`WidgetInfo.plist` only adds URL schemes and doesn't touch the icon). Dock, Finder, and Launchpad all read this bundle icon, not the sidebar SVG or root `icon.png`. Using `focal.icns` instead of the old `icon.icns` ensures updates also change the icon reference, so keep the rename step above when regenerating assets.

`scripts/build-macos-widget.ts` copies the same ICNS into the widget extension's `Contents/Resources` and sets `CFBundleIconFile` before signing. The publisher helper doesn't have its own app bundle, and the widgets use SF Symbols for their illustrations rather than alternate app icons.

There's no Electron config, Xcode project, `Assets.xcassets`, `AppIcon.appiconset`, `CFBundleIconName`, or Icon Composer `.icon` here. macOS Tahoe reads the bundled ICNS directly, which includes 16 through 1024 px sizes (including Retina). If an old icon still shows up after updating, it's almost always an older installed copy or a stale macOS icon cache, so check the installed app before rebuilding.

After installing a new build, quit Focal, eject the DMG, and inspect the bundle (adjust `/Applications` if you installed it somewhere else):

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Focal.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' /Applications/Focal.app/Contents/Info.plist
open /Applications/Focal.app/Contents/Resources/focal.icns
```

You should see the blue Study Grid. If it's right there but macOS is still showing the old icon, refresh LaunchServices, Dock, and Finder:

```sh
touch /Applications/Focal.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Focal.app
killall Dock
killall Finder
```

If macOS still hangs onto the old icon, clear the IconServices caches, re-register, and restart your Mac (this clears cached icons for other apps too, which macOS rebuilds automatically; it won't touch Dock preferences or Launchpad layout):

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

If the Dock still launches an older copy, remove that Dock icon, open `/Applications/Focal.app` directly, and pin it back to the Dock.
