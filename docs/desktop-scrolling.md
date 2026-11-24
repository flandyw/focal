# Desktop scrolling

The desktop entry adds `html[data-desktop]` so the document, body, and app root stay fixed to the window height and don't scroll on their own. Instead, the flex shell hands the available height to `#main-content`. The sidebar keeps its own independent scroll area, shared page headers and Calendar's header stick cleanly inside the main pane, and Chat passes the height straight through to its message list so the header and composer stay pinned.

Every descendant on desktop (including portaled dialogs, sheets, popovers, menus, command results, textareas, and wide tables) uses `overscroll-behavior: none`. Unlike `contain`, this stops both local rubber-band bounce and scroll chaining. We don't cancel wheel, touch, or keyboard events, so trackpad momentum, keyboard navigation, focus scrolling, anchors, and `scrollIntoView` keep working natively. Route scroll restoration and tapping the active mobile tab target `#main-content` on desktop, while browser and embedded views keep ordinary window scrolling.

This needs no native overrides or extra packages: modern WKWebView supports CSS overscroll control and the root document has no scroll range. Tauri's `preventOverflow` window setting only affects window sizing, not scroll bounce. Older WebKit versions without CSS overscroll support would need testing on macOS hardware before assuming bounce is gone (see [WebKit's Safari 16 release notes](https://webkit.org/blog/13152/webkit-features-in-safari-16-0/)).

## Scroll regions by page

| Pages | Scroll owner and nested regions |
| --- | --- |
| Today, Subjects | Main pane with shared sticky page header |
| Calendar | Main pane with sticky month header; split day panel scrolls on its own |
| Timetable | Main pane; wide timetable keeps horizontal scroll |
| Practice, Papers | Main pane; tables, paper details, and editors keep their own scroll areas |
| Mistakes | Main pane; review history, import previews, bulk editors, and dialogs scroll independently |
| Study timer | Main pane; workspace and marking dialogs scroll independently |
| Progress | Main pane; analytics tables and charts keep horizontal scroll |
| ATAR, Benchmarks (VCAA data / predictor) | Main pane with sticky headers and tables |
| Friends | Main pane; member pickers and detail sheets scroll independently |
| Chat | Message list and chat-history list; no outer main-pane scrollbar |
| Settings | Main pane; previews and dialogs keep their own scroll areas |
| Onboarding | Height-bounded dialog; root stays locked behind it |

## Checking on macOS

Run `bun run tauri dev` on a Mac and test at both minimum window size and maximised, in light and dark themes:

1. Open each page above with enough items to scroll. Fling vertically and horizontally past both edges. The window background should stay put with no blank rubber-band gap, while the sidebar and page header stay visible and content scrolls smoothly.
2. Scroll the sidebar and an open modal, list, or popover to its edges and keep scrolling; neither the inner pane nor the page behind it should bounce or chain. Check wide tables and Calendar's split day panel too.
3. In Chat, scroll history and messages independently. The composer and conversation header should stay fixed with no second outer scrollbar.
4. Jump to the main region with the skip link, then try arrow keys, Space, Page Up/Down, and Home/End. Tab down to fields near the bottom of dialogs and follow in-page links to confirm focused elements stay visible. Switch pages and come back to confirm scroll position is restored.
5. Reopen onboarding from Settings in a short window and make sure every button stays reachable.
6. Run `bun run dev` to confirm normal browser scrolling, mobile tabs, and the embedded exam view still feel right.

These checks have to be done manually on a Mac, since Linux builds can't verify WKWebView or real trackpad scrolling.
