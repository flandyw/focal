# Focal Design

## Direction

Use standard shadcn/ui components and default neutral theme tokens without a custom brand palette.

## Layout

The page is fluid: no page-level max width anywhere. Extra viewport width is spent on more columns (`xl` and `2xl` grids), never on longer lines.

- Shell: `p-4 sm:p-5 lg:p-6 2xl:p-8` gutters, `min-width: 0` on content regions, a desktop sidebar rail at `lg` and above, and a navigation sheet below `lg` so tablets keep the full width.
- Reading order: every page opens with a lead band carrying the one next study action and its count, then evidence. Support follows — metrics, then tables and charts.
- Rhythm: `gap-4` inside a group, `gap-6 lg:gap-8` between page bands. Whitespace separates groups; containers are reserved for genuinely bounded content.
- Measure: running text (card and alert descriptions, section copy) is capped at `68ch`. The page is never capped.
- Density: one column on phones with stacked rows that never truncate mid-word; two columns from `sm`; sidebar rail plus two- to three-column grids from `lg`; a third column at `2xl` where the content supports it.
- Horizontal scrolling is allowed only for data tables, dense calendars, and the activity heatmap, always inside their own container.

## Typography

Use shadcn's default system sans stack. Use tabular numerals for marks and percentages. Apply shadcn Typeset only to rendered mistake notes.

## Components

Keep canonical shadcn states, spacing, radii, and focus treatments. Recharts visualizations use shadcn Chart wrappers and always include a textual summary.
