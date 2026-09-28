import { describe, expect, test } from "bun:test"
import { migrateLegacyPendingCommand } from "../src/lib/study-session-sync"

const command = {
  mutation_id: "20000000-0000-4000-8000-000000000001",
  session_id: "session-1",
  expected_revision: 0,
  action: "start" as const,
  device_id: "30000000-0000-4000-8000-000000000001",
  app: "examtrack" as const,
  kind: "exam" as const,
  phase: "reading" as const,
}

describe("study-session outbox migration", () => {
  test("quarantines legacy commands with no verifiable owner", () => {
    const migrated = migrateLegacyPendingCommand({ command, queuedAt: 10 }, "legacy-unassigned")
    expect(migrated?.accountId).toBe("legacy-unassigned")
    expect(migrated?.command.mutation_id).toBe(command.mutation_id)
    expect(migrated?.attempted).toBe(false)
  })

  test("preserves an existing account owner rather than reassigning it", () => {
    const migrated = migrateLegacyPendingCommand({ command, accountId: "user-a", queuedAt: 10 }, "user-b")
    expect(migrated?.accountId).toBe("user-a")
  })

  test("does not turn malformed legacy rows into commands", () => {
    expect(migrateLegacyPendingCommand({ command: { ...command, device_id: "not-a-device" } }, "legacy-unassigned")).toBeNull()
  })
})
