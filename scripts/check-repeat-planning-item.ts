import { repeatCalendarEvent, repeatStudySession } from "../src/lib/repeatPlanningItem.ts"
import { normalizeStudySession } from "../src/lib/studySessions.ts"
import type { CalendarEvent } from "../src/lib/types.ts"

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const event: CalendarEvent = {
  id: "event-1",
  title: "Methods SAC",
  startTime: "2026-06-01T09:30:00+10:00",
  endTime: "2026-06-01T11:00:00+10:00",
  eventType: "sac",
  subjectId: "mm",
  isFinished: true,
  finishedAt: "2026-06-01T11:00:00+10:00",
  source: { type: "notion", id: "remote-event" },
  created_at: "2026-05-01T00:00:00Z",
}

const repeatedEvent = repeatCalendarEvent(event)
const week = 7 * 24 * 60 * 60 * 1000
check(new Date(repeatedEvent.startTime).getTime() - new Date(event.startTime).getTime() === week, "event start time was not shifted")
check(new Date(repeatedEvent.endTime!).getTime() - new Date(event.endTime!).getTime() === week, "event end time was not shifted")
check(repeatedEvent.isFinished === false, "repeated event stayed complete")
check(repeatedEvent.source === undefined, "repeated event kept its integration identity")
check(repeatedEvent.finishedAt === undefined, "repeated event kept its completion time")

const session = normalizeStudySession({
  id: "session-1",
  projectId: "project-1",
  subjectIds: ["mm"],
  title: "Revise chapter 4",
  description: "Work through examples",
  topics: ["functions"],
  schedule: {
    blocks: [
      { start: "2026-06-01T09:30:00+10:00", end: "2026-06-01T10:00:00+10:00" },
      { start: "2026-06-01T10:10:00+10:00", end: "2026-06-01T10:40:00+10:00" },
    ],
  },
  execution: {
    state: "completed",
    intervals: [],
    completedAt: "2026-06-01T10:40:00+10:00",
  },
  reflection: {
    notes: "Finished the examples",
    confidence: 3,
    nextAction: "Redo the hard questions",
  },
  integrations: { notion: { type: "notion", id: "remote-session" } },
  createdVia: "notion",
  created_at: "2026-05-01T00:00:00Z",
})

const repeatedSession = repeatStudySession(session)
check(repeatedSession.title === "Redo the hard questions", "next action was not carried into the repeated session")
check(repeatedSession.execution?.state === "planned", "repeated session was not reset to planned")
check(repeatedSession.schedule.blocks.length === 2, "repeated session lost study blocks")
check(
  new Date(repeatedSession.schedule.blocks[0].start).getTime() - new Date(session.schedule.blocks[0].start).getTime() === week,
  "session start time was not shifted",
)
check(repeatedSession.reflection === undefined, "repeated session kept its reflection")
check(repeatedSession.integrations === undefined, "repeated session kept its integration identity")

console.warn("Repeat planning item checks passed")
