/**
 * Shared motion design tokens and variants.
 *
 * Centralizes timing, easing, and reusable variant objects so animations feel
 * cohesive across the app. Honors `prefers-reduced-motion` via framer-motion's
 * `useReducedMotion` + a `MOTION_REDUCED_*` constant for plain CSS consumers.
 *
 * Design constraints (from .impeccable.md):
 *  - "precision tool" aesthetic — restrained, purposeful motion
 *  - one well-orchestrated experience beats scattered animations
 *  - ease out with exponential curves; no bounce / elastic
 *  - GPU-accelerated: transform + opacity only
 */
import type { Transition, Variants } from "framer-motion"

/** Primary ease curve — refines material deceleration, no overshoot. */
export const MOTION_EASE = [0.16, 1, 0.3, 1] as const
/** Slightly snappier sibling for tighter feedback (tooltips, toggles). */
export const MOTION_EASE_SNAPPY = [0.22, 1, 0.36, 1] as const

/** Duration tokens (seconds — framer-motion units). */
export const MOTION_DURATION = {
  instant: 0.08,
  fast: 0.15,
  normal: 0.22,
  medium: 0.32,
  slow: 0.48,
} as const

/** Standard transitions for common purposes. */
export const TRANSITION = {
  /** For view/page enter/exit. */
  view: { duration: MOTION_DURATION.normal, ease: MOTION_EASE } as Transition,
  /** For entrance choreography (list stagger). */
  entrance: { duration: MOTION_DURATION.medium, ease: MOTION_EASE } as Transition,
  /** For exit (faster than entrance per design rules). */
  exit: { duration: MOTION_DURATION.fast, ease: MOTION_EASE_SNAPPY } as Transition,
} as const

/** Disabled (no-motion) transitions for prefers-reduced-motion users. */
export const REDUCED_TRANSITION = { duration: 0 } as const

/* ------------------------------ Variants ------------------------------ */

/** Container that staggers child entrance. */
export const staggerContainer = (stagger = 0.04, delayChildren = 0.05): Variants => ({
  initial: {},
  animate: {
    transition: {
      staggerChildren: stagger,
      delayChildren,
    },
  },
  exit: {
    transition: {
      staggerChildren: stagger * 0.5,
      staggerDirection: -1,
    },
  },
})

/** Item that fades + slides up on entrance (stagger child). */
export const staggerItem: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: TRANSITION.entrance },
  exit: { opacity: 0, y: -4, transition: TRANSITION.exit },
}

/* ------------------------------ App-wide ------------------------------ */

/** Page shell: fades in and staggers every descendant that uses `riseItem` (cards, page header). */
export const pageVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: MOTION_DURATION.normal, ease: MOTION_EASE, staggerChildren: 0.05 } },
}

/** Card-sized block rising into place. Inert outside a parent that sets the labels (e.g. inside dialogs). */
export const riseItem: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: MOTION_DURATION.slow, ease: MOTION_EASE } },
}

/** Shared-layout glide for active indicators (nav highlight, tab underline). */
export const indicatorSpring: Transition = { type: "spring", stiffness: 500, damping: 40, mass: 0.8 }
