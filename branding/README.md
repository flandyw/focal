# Focal branding

## Mark: Study Grid

Four rounded tiles: three filled blocks of study and one ticked off. It stands for planned work getting done, which is what the app does.

- `focal-icon.svg`: the forest tile. This is the canonical app icon (desktop, PWA, Apple touch, notifications).
- `focal-mark-light.svg`: the pale sage tile, for light backgrounds outside the app.

Inside the app, `src/components/focal-mark.tsx` draws the mark from `currentColor` and `--card`, so it follows the accent, sidebar tint, and theme. In the sidebar it is aligned to the baseline and sized to the ascender height of the wordmark.

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
bunx tauri icon branding/focal-icon.svg -o src-tauri/icons && rm -rf src-tauri/icons/android
bunx tauri icon public/focal-icon.svg -o /tmp/a --png 192,512          # public/icon-*.png
bunx tauri icon public/apple-touch-icon.svg -o /tmp/m --png 180,192,512 # apple-touch-icon.png, icon-maskable-*.png
```

`public/badge-96.png` is a white grid on transparency, because Android uses only the alpha channel for notification badges. If you change the PWA icons, bump `CACHE` in `public/sw.js`.
