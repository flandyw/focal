import assert from "node:assert/strict"
import { pastStudyBlocks } from "../src/lib/pastStudy"
import { createStudySession, normalizeStudySession, studySessionFromCanonical } from "../src/lib/studySessions"
import { studySubjectId, studySubjectOptions } from "../src/lib/studySubjects"
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
assert.deepEqual(studySubjectOptions(["English", "eng", "Mathematical Methods CAS", "Mathematical Methods", "English Language"]), [
  { id: "eng", name: "English" }, { id: "mm", name: "Mathematical Methods" }, { id: "eng-lang", name: "English Language" },
])
assert.equal(studySubjectId(" chemistry "), "chem")
assert.equal(studySubjectId("Chinese Second Language Advanced"), "Chinese Second Language Advanced")
assert.equal(studySubjectId("My custom subject"), "My custom subject")
const legacy = studySessionFromCanonical({
  id: "old-web-log", kind: "focus", state: "completed", phase: "focus", revision: 1,
  title: "Methods", subject_id: "Mathematical Methods", originating_app: "examtrack",
  created_at: blocks[0].start, updated_at: blocks[1].end, started_at: blocks[0].start,
  completed_at: blocks[1].end, paused_at: null, cancelled_at: null, segment_started_at: null,
  accumulated_active_ms: 2700000, metadata: { subjectIds: ["Mathematical Methods"], schedule: { blocks } },
  segments: blocks.map((block) => ({ id: crypto.randomUUID(), session_id: "old-web-log", started_at: block.start,
    ended_at: block.end, phase: "focus", source_device_id: null })),
})
assert.deepEqual(legacy?.subjectIds, ["mm"])
assert.deepEqual(normalizeStudySession({ ...session, subjectIds: ["Mathematical Methods", "mm"] }).subjectIds, ["mm"])
// eslint-disable-next-line no-console
console.log("Past study checks passed")
