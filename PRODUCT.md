# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

VCE students planning their study, sitting practice exams, and revising from mistakes.

## Product Purpose

Focal is a calm, practical study app that helps VCE students plan their week, track study sessions and practice papers, and turn mistakes into steady revision.

## Operating Context

Students use Focal in a browser or as a Tauri desktop app. They can plan study around classes and calendar events, time their work, follow their progress, and check official VCAA and VTAC reference data.

## Capabilities and Constraints

With a Focal account, supported study data syncs across devices and with Folio. Students can export their own backups at any time. Historical `examtrack` storage and sync identifiers must stay intact so existing data and Folio keep working.

## Brand Commitments

Focal feels warm, clear, calm, and practical: a study space that respects a student's time and attention.

## Evidence on Hand

Official VCAA and VTAC reference datasets live in `public/`, and workflows are documented in `docs/`.

## Product Principles

- Keep everyday study tasks quick and low-friction.
- Help students make sense of their progress and learn from mistakes without feeling overwhelmed.
- Keep existing student data safe and compatible with Folio.
- Treat accessibility as a baseline, not an afterthought.

## Accessibility & Inclusion

Aim for WCAG AA contrast in both light and dark themes, clear focus indicators, reduced-motion support, and status cues that never rely on colour alone.

## Design Context

### Brand Personality
Warm · Clear · Grounded. Like a well-kept study notebook and a helpful desk companion: approachable, steady, and focused on getting real study done. Every piece of copy and UI should feel human and encouraging without getting cheesy or in the way.

### Aesthetic Direction
- **Visual tone**: Clean, readable, and calm. Thoughtful spacing, gentle structure, and clear numbers, never cluttered or cold.
- **Theme**: Light and dark modes get equal care, following system preference with a quick toggle. Dark mode for late-night revision; light mode for bright classrooms and libraries.
- **Typography**: Readable, friendly UI typography (Instrument Sans by default, with optional Newsreader headings and user-selectable fonts in Settings) registered through Tailwind v4 `@theme` tokens so everything stays consistent.
- **Color**: Muted neutral surfaces with a single accent colour that draws the eye to what matters (deadlines, due counts, primary actions) without turning the page into a rainbow.
- **Motion**: Quick and purposeful. Transitions clarify what just changed without slowing students down.

### Design Principles
1. **Make the everyday path easy**: logging a paper, starting a timer, or reviewing a mistake should take a few clicks, not a maze of dialogs.
2. **Clarity through simplicity**: let spacing, weight, and plain language do the work instead of extra chrome.
3. **Feel native, not generic**: Focal runs on the web and as a Tauri desktop app; it should respect platform habits while feeling unmistakably like itself.
4. **Accessibility as a habit**: WCAG AA contrast in both themes, visible focus rings, reduced-motion support, and text alongside colour cues.
5. **Every detail earns its spot**: no decorative fluff, border-left stripes, or gradient text. If something moves or speaks, it should genuinely help the student.
