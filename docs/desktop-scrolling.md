# Desktop scrolling

The desktop entry marks `html[data-desktop]`. Its document, body and app root are height-bounded and cannot scroll; the flex shell passes the available height to `#main-content`. Sidebar content keeps its existing independent overflow. Shared page headers and Calendar's custom header stick inside the main pane. Chat instead passes the available height through to its existing message scroller, keeping its header and composer outside scrolling.

All desktop descendants (including portaled dialogs, sheets, popovers, menus, command results, textareas and horizontal tables) use `overscroll-behavior: none`. Unlike `contain`, this suppresses local elasticity as well as scroll chaining. No wheel/touch/key events are cancelled, so momentum, native keyboard navigation, focus scrolling, anchors and `scrollIntoView` still use the browser's scrolling machinery. Route restoration and active mobile-tab taps target the main pane on desktop; browser and embedded navigation retain window scrolling.

No native override or dependency is added: modern WKWebView supports CSS overscroll control, and the root document has no scroll range. Tauri's window `preventOverflow` setting controls window size, not scroll elasticity. Older WebKit without CSS overscroll support requires separate macOS hardware validation before claiming bounce suppression. See [WebKit's Safari 16 release notes](https://webkit.org/blog/13152/webkit-features-in-safari-16-0/) for overscroll support.

## Source audit

| Pages | Scroll owner / nested regions |
| --- | --- |
| Today, Subjects | Main pane; shared sticky page header |
| Calendar | Main pane; custom sticky month header; bounded split day panel remains independently scrollable |
| Timetable | Main pane; horizontal timetable overflow remains available |
| Practice, Papers | Main pane; tables, paper details and editors retain their bounded overflow |
| Mistakes | Main pane; review history, import previews, bulk editors and dialogs retain independent overflow |
| Study timer | Main pane; workspace and marking dialogs retain independent overflow |
| Progress | Main pane; analytics tables/charts retain horizontal overflow |
| ATAR, Benchmarks (VCAA data / predictor) | Main pane; shared sticky headers and existing tables |
| Friends | Main pane; member pickers and detail sheets retain independent overflow |
| Chat | Message list and chat-history list; no outer main-pane scrollbar |
| Settings | Main pane; previews and dialogs retain their existing overflow |
| Onboarding | Existing height-bounded dialog; root stays locked underneath |

## Verify on macOS

Run `bun run tauri dev` on a Mac. Test at the minimum window size and maximized, in light and dark themes.

1. Visit every row above with enough records to overflow. Fling vertically and horizontally at both edges. The document/background must never move or reveal blank space. Sidebar and page header stay visible; content scrolls with trackpad momentum.
2. Overflow the sidebar and a modal/list/popover. Scroll to each boundary and keep scrolling: neither that pane nor its parent should bounce or chain. Check wide tables and Calendar's split day panel too.
3. In Chat, overflow history and messages independently; the composer and conversation header must stay visible and there must be no second outer scrollbar.
4. Focus the main region using the skip link, then test arrows, Space, Page Up/Down, Home/End. Tab into fields near the bottom of dialogs and use in-page links: focused targets should remain reachable. Confirm returning to a page restores its main-pane position.
5. Reopen onboarding from Settings and complete it in a short window. All actions must remain reachable.
6. Run `bun run dev` to check ordinary browser scrolling, mobile tabs and the embedded exam view still behave as before.

Hardware checks above are manual; Linux checks/builds do not validate WKWebView or physical trackpad behavior.
