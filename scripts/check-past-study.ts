import assert from "node:assert/strict"
import { pastStudyBlocks } from "../src/lib/pastStudy"
import { createStudySession } from "../src/lib/studySessions"
import { sessionCommands } from "../src/lib/sync/sessions"

const now = new Date("2026-06-01T12:00:00Z").getTime()
const blocks = pastStudyBlocks([
  { start: "2025-01-01T23:45:00Z", minutes: "30" },
  { start: "2025-01-02T00:30:00Z", minutes: "15" },
], now)
assert.equal(blocks[0].end, "2025-01-02T00:15:00.000Z")
assert.equal(blocks.reduce((sum, b) => sum + Date.parse(b.end) - Date.parse(b.start), 0), 45 * 60000)
for (const rows of [
  [{ start: "2026-06-01T11:45:00Z", minutes: "30" }],
  [{ start: "bad", minutes: "30" }],
  [{ start: "2025-01-01T12:00:00Z", minutes: "0" }],
  [{ start: "2025-01-01T12:00:00Z", minutes: "60" }, { start: "2025-01-01T12:30:00Z", minutes: "30" }],
]) assert.throws(() => pastStudyBlocks(rows, now))
const session = createStudySession("past-study", { title: "Revision", subjectIds: ["english"], createdVia: "manual",
  schedule: { blocks }, execution: { state: "completed", completedAt: blocks[blocks.length - 1].end,
    intervals: blocks.map((block) => ({ ...block, source: "manual" })) } })
const commands = sessionCommands(session, undefined, crypto.randomUUID())
assert.equal(commands.length, 1)
assert.equal(commands[0].action, "log")
assert.deepEqual(commands[0].blocks, blocks)
// eslint-disable-next-line no-console
console.log("Past study checks passed")
