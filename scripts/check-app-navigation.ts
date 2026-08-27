import {
  closeSettingsDestination,
  navigateTo,
  type AppNavigationState,
} from "../src/features/shell/useAppNavigation"
import { blocksSingleKeyShortcut } from "../src/hooks/useKeyboardShortcuts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const initial: AppNavigationState = {
  destination: { kind: "home" },
  previousDestination: { kind: "home" },
}
const project = navigateTo(initial, { kind: "project", projectId: "methods" })
const settings = navigateTo(project, { kind: "settings" })
const restored = closeSettingsDestination(settings)
assert(restored.destination.kind === "project", "closing settings must restore the previous destination")
assert(
  restored.destination.kind === "project" && restored.destination.projectId === "methods",
  "closing settings restored the wrong project",
)

const timetable = navigateTo(restored, { kind: "timetable" })
assert(timetable.destination.kind === "timetable", "primary navigation must be mutually exclusive")
const assessments = navigateTo(timetable, { kind: "assessments" })
assert(assessments.destination.kind === "assessments", "assessments must be a first-class destination")
const examTrack = navigateTo(assessments, { kind: "examtrack" })
assert(examTrack.destination.kind === "examtrack", "ExamTrack must be a first-class destination")
const planner = navigateTo(examTrack, { kind: "planner" })
assert(planner.destination.kind === "planner", "adaptive planner must be a first-class destination")
const inbox = navigateTo(planner, { kind: "inbox" })
assert(inbox.destination.kind === "inbox", "academic inbox must be a first-class destination")

const inputTarget = { tagName: "INPUT" } as unknown as EventTarget
const dialogTarget = {
  tagName: "BUTTON",
  closest: (selector: string) => selector === '[role="dialog"]' ? {} : null,
} as unknown as EventTarget
const pageTarget = { tagName: "BUTTON", closest: () => null } as unknown as EventTarget
assert(blocksSingleKeyShortcut(inputTarget), "single-key shortcuts must pause in text fields")
assert(blocksSingleKeyShortcut(dialogTarget), "single-key shortcuts must stay inside modal dialogs")
assert(!blocksSingleKeyShortcut(pageTarget), "single-key shortcuts must remain available on the page")

const assessmentRowSource = await fetch(
  new URL("../src/components/project/AssessmentRow.tsx", import.meta.url),
).then((response) => response.text())
assert(assessmentRowSource.includes('tabIndex={0}'), "assessment rows must be keyboard focusable")
assert(assessmentRowSource.includes('event.key !== "Enter" && event.key !== " "'), "assessment rows must support Enter and Space")

const titleBarSource = await fetch(
  new URL("../src/components/shell/TitleBar.tsx", import.meta.url),
).then((response) => response.text())
assert(titleBarSource.includes('aria-label="Create new item"'), "primary creation actions must remain globally discoverable")
assert(titleBarSource.includes("onNewAssessment={onNewAssessment}"), "the title bar must expose new assessments")
assert(titleBarSource.includes("onNewEvent={onNewEvent}"), "the title bar must expose new events")
assert(titleBarSource.includes("onNewSession={onNewSession}"), "the title bar must expose study sessions")

const sidebarSource = await fetch(
  new URL("../src/components/shell/Sidebar.tsx", import.meta.url),
).then((response) => response.text())
assert(sidebarSource.includes("prominent"), "the sidebar must give the timer its primary workspace")
assert(sidebarSource.includes("Assessments"), "the sidebar must label the assessment library clearly")
assert(sidebarSource.includes("Adaptive planner"), "the sidebar must expose the adaptive planner")
assert(sidebarSource.includes("Academic inbox"), "the sidebar must expose the academic inbox")

const studyTimerSource = await fetch(
  new URL("../src/components/timer/StudyTimer.tsx", import.meta.url),
).then((response) => response.text())
assert(studyTimerSource.includes("Start focus"), "the sidebar timer must expose the focus flow")

const appSource = await fetch(new URL("../src/App.tsx", import.meta.url)).then(
  (response) => response.text(),
)
assert(appSource.includes("onNewAssessment={handleNewProject}"), "the global New menu must create assessments")
assert(appSource.includes("onNewEvent={() => handleOpenNewEvent()}"), "the global New menu must create events")
assert(appSource.includes("onNewSession={() => handleOpenNewSession()}"), "the global New menu must create study sessions")
assert(appSource.includes("onOpenFocus: handleOpenFocus"), "the app must keep the focus keyboard shortcut connected")
assert(appSource.includes('label: "Add files"'), "new assessments must offer the next core action")
