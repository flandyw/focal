# Interface design

Focal uses the same React interface on web and desktop. Its theme tokens, light and dark palettes, fonts, and surface variants live in `src/index.css`; users can customize appearance in Settings. Reuse components in `src/components/ui/` and follow the surrounding page's layout and interaction patterns.

Favor clear study actions, readable data, and responsive layouts. Keep keyboard focus visible, provide text alongside color-coded status, respect reduced motion, and give charts useful labels or summaries. Test dense tables and calendars at narrow widths as well as on desktop.

See [typography](TYPOGRAPHY.md) and [product context](web-PRODUCT.md).
