# Friends shared-session implementation

References: the three approved Friends concepts (open desk, shared focus round, scheduled invitation), combined into the existing app rather than separate prototypes.

The implementation keeps Focal’s current fonts, semantic light/dark theme tokens, shared components and sidebar. The Together tab contains live sessions, invitations and upcoming plans; the session view uses the approved clock-and-participants structure. Existing social analytics and sharing controls remain in Activity & sharing.

Validation: typecheck/lint, web build, desktop frontend build and isolated Supabase migration execution. Local authenticated RPC exercises covered duplicate create/accept, invitation notifications, joining/leaving, withdrawal, outsider access denial and cancellation that preserves a running personal session. No tests were added.

Visual comparison and browser interaction checks were not run. Mobile layouts, keyboard interaction and physical notification delivery therefore remain unverified.

final result: blocked (visual verification only)
