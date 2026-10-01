# Study timer (`web/`)

## Scope

New page in the existing ExamTrack web app, and the **single timer surface**. Mode:
**Operate**. The visitor is mid-study, or about to be, and needs to start a run and read
the remaining time without thinking about anything else.

Two runs live here, as modes of one surface:

- **Focus blocks** — pomodoro with rest, from the Focal desktop app's timer.
- **Timed paper** — a reading/writing practice paper, which used to be its own
  `ExamTimer` page with its own nav item and its own visual language.

## Audience, job, constraints

VCE students who already use this app for exam records. Job: run study time, and get the
same minutes into their study record. Constraints: inherits `DESIGN.md` verbatim (shadcn
neutral, fluid page, no max width, lead band then evidence); no new dependency; the web app
has no Switch or Checkbox primitive, so binary settings are `aria-pressed` toggle buttons.

## Direction

The timer is an **instrument readout**, not a dashboard. It refuses the category default
of a circular progress ring standing in for the clock. Time is set large in tabular
numerals over a hairline linear meter, with a run's shape shown as discrete marks — a
punch card of completed blocks, or the exam's reading/writing phases.

The whole reason this refactor was worth doing: the two timers had drifted into two
different visual languages for the same act of reading a clock. `TimerReadout` is now the
one instrument both report through, so they cannot drift again. Each mode keeps its own
engine, because a pomodoro cycle and a paper's reading/writing phases are genuinely
different state models; the duplication worth deleting was the surface, not the math.

Memorable moment: the marks strip filling, one mark per completed block or phase.

## Unresolved

- **Free study does not count down.** `START_FREE_STUDY` repurposes the break window:
  `secondsLeft` stays frozen at `totalSeconds` and elapsed time accrues in
  `overtimeSeconds` (`breakSeconds` while paused). Deriving an elapsed time as
  `totalSeconds - secondsLeft` is therefore permanently zero. This shipped as
  "free study is stuck on 0" before `tests/study-timer.test.ts` pinned the shape.
- The block log is device-local. A future revision should read today's blocks from the
  canonical `focus` sessions so the page agrees across devices.
- `kind: "focus"` and `kind: "exam"` now share one outbox alongside `sac`. The exam path
  is unchanged in behaviour; it just reports through the shared instrument and lives under
  the study timer's nav entry.
- Base UI Tabs renders no panel when `mode` matches neither tab, so `mode` must stay a
  valid `StudyTimerMode` at every call site.
- The VCAA JSON is a trust boundary and is now filtered in `use-reference-data.ts`.
  Every consumer calls `.toLowerCase()` on these names unguarded, so a row missing one
  is a white screen, not a degraded row. Keep new reference sources behind a validator.

## Direction contract

THESIS: A dense study workstation: setup precedes the clock, lifecycle controls stay with the readout, and supporting information is visible without dominating the task. Replaces the long stack of disconnected timer, setup, metrics, and settings cards.

OWN-WORLD: Existing Focal neutral shadcn surfaces, blue actions, Geist UI type and tabular numerals. Bounded panels use dividers internally rather than nested cards.

STORY: Choose a subject and intent or paper, start study, read the current state, pause or finish, then inspect the record or question progress. Keep all timer, cross-device sync, marking and progression behavior.

FIRST VIEWPORT: Fluid task column plus a 22rem support column at xl. Study puts subject and intent over a shared clock-and-controls panel; settings sit alongside, today's log below. Paper setup leads, suggestions sit alongside. Active paper puts timer and actions beside the save/pace overview, questions below. Mobile follows setup, timer, record, support.

FORM: User-confirmed compact workspace for both Study and Timed paper, preserving the established visual world. Pinned composition; no concept roll or replacement identity. Signature interaction remains the phase-change readout and linear phase markers, with reduced-motion support.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Build path

Code-led (no image generation in this harness; no comp of this page exists).
FINISH: the run's exit condition, verbatim "unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance".
