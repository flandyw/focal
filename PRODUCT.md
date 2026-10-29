# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

VCE students planning study, practising exams and revising mistakes.

## Product Purpose

Focal is a study companion that helps students plan their week, track study sessions and practice exams, and turn mistakes into revision.

## Operating Context

Students use Focal in a browser or as a Tauri desktop app. They can plan study alongside classes and calendar events, track time, review progress, and consult VCAA and VTAC reference data.

## Capabilities and Constraints

Supported data can sync across devices and with Folio using a Focal account. Students can export their data. Historical `examtrack` storage and sync identifiers must remain compatible with existing data and Folio.

## Brand Commitments

Focal is sharp, fast, minimal, approachable and precise.

## Evidence on Hand

The app includes VCAA and VTAC reference datasets in `public/`, and its workflows are documented in `docs/`.

## Product Principles

- Make common study workflows quick and straightforward.
- Help students make sense of their progress and revise from their mistakes.
- Preserve access to existing data and interoperability with Folio.
- Make accessibility a routine part of the experience.

## Accessibility & Inclusion

Aim for WCAG AA contrast in light and dark themes, visible focus indicators, reduced motion support, and information that does not rely on colour alone.

## Design Context

### Brand Personality
Sharp · Fast · Minimal. No-nonsense precision, like a good mechanical pencil or a field notebook. The interface should be confident and efficient — every element earns its place, nothing decorative without purpose. Approachable minimalism, not cold minimalism.

### Aesthetic Direction
- **Visual tone**: Precision tool aesthetic. Clean lines, intentional whitespace, subtle structure. Think: Muji meets a drafting table. Not playful, not sterile — quietly capable.
- **Theme**: Both dark and light modes, equally important. System-preference driven with toggle. Dark mode for late-night study sessions; light mode for bright libraries. Both modes must feel equally considered, not one as an afterthought.
- **Typography**: Sharp, condensed, or mechanical-leaning display font for branding moments (empty state, logo, headers) — Sora Variable in current use (via `@fontsource-variable/sora`) — paired with Geist as the workhorse UI font. Both register through Tailwind v4 `@theme` tokens so type stays consistent across views.
- **Color**: Muted, intentional palette. The current shadcn neutral is a good base. The accent should be distinctive but restrained — used sparingly to highlight what matters (deadlines, counts, actions). Consider a single color accent (not a rainbow palette).
- **Motion**: Minimal and purposeful. Faster ingress, no gratuitous animations. Transitions should convey state changes clearly (project selected, file added) without slowing the user down.

### Design Principles
1. **Make the default path frictionless** — common study workflows should feel instant. Avoid unnecessary confirmations, modals, or steps.
2. **Visual hierarchy through subtraction** — fewer elements, more contrast between them. Use spacing and weight, not extra UI chrome, to establish hierarchy.
3. **System-familiar, not system-generic** — Focal is a native desktop app (Tauri). It should feel at home on the OS but not blend in. Respect platform conventions while carving a distinct identity.
4. **Accessibility as a matter of course** — WCAG AA contrast in both themes, focus indicators, reduced motion support, and text that never relies on color alone.
5. **Every interaction has intent** — no decorative animations, no border-left accents, no gradient text. If it moves, it communicates something.
