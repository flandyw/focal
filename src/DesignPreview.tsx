import { useState } from "react";
import { AssessmentsView } from "@/components/assessments/AssessmentsView";
import { Sidebar } from "@/components/shell/Sidebar";
import type { Project, StudySession } from "@/lib/types";

const projects: Project[] = [
  { id: "chem-1", name: "Equilibrium & Acid Reactions", description: "Practice questions and exam-style tasks", subjectId: "chem", deadline: "2026-09-04T09:00:00+10:00", deadlineType: "sac", created_at: "2026-08-01T00:00:00Z", folder_path: "/Chemistry/Equilibrium", checklist: [{ id: "1", text: "Review notes", completed: true }, { id: "2", text: "Practice set", completed: false }] },
  { id: "chem-2", name: "Practical Report — Titration", description: "Lab report and data analysis", subjectId: "chem", deadline: "2026-09-15T09:00:00+10:00", deadlineType: "assignment", created_at: "2026-08-03T00:00:00Z", folder_path: "/Chemistry/Titration" },
  { id: "chem-3", name: "Unit 2 Quiz", description: "Short answer quiz", subjectId: "chem", deadline: "2026-08-12T09:00:00+10:00", deadlineType: "sac", created_at: "2026-07-10T00:00:00Z", folder_path: "/Chemistry/Quiz", isFinished: true },
  { id: "eng-1", name: "Comparative Essay", description: "Texts and contexts", subjectId: "eng-lang", deadline: "2026-09-01T09:00:00+10:00", deadlineType: "assignment", created_at: "2026-08-05T00:00:00Z", folder_path: "/English/Essay", checklist: [{ id: "3", text: "Plan", completed: true }, { id: "4", text: "Draft", completed: false }, { id: "5", text: "Edit", completed: false }] },
  { id: "eng-2", name: "Language Analysis — Article", description: "Persuasive language analysis", subjectId: "eng-lang", deadline: "2026-09-08T09:00:00+10:00", deadlineType: "sac", created_at: "2026-08-07T00:00:00Z", folder_path: "/English/Analysis" },
  { id: "mm-1", name: "Integration Techniques", description: "Methods SAC preparation", subjectId: "mm", deadline: "2026-08-31T09:00:00+10:00", deadlineType: "sac", created_at: "2026-08-09T00:00:00Z", folder_path: "/Methods/Integration" },
  { id: "mm-2", name: "Practice Test 2", description: "Timed exam practice", subjectId: "mm", deadline: "2026-09-10T09:00:00+10:00", deadlineType: "exam", created_at: "2026-08-11T00:00:00Z", folder_path: "/Methods/Test-2" },
  { id: "pe-1", name: "Training Plan — Week 6", description: "Skill execution and analysis", subjectId: "pe", deadline: "2026-09-03T09:00:00+10:00", deadlineType: "assignment", created_at: "2026-08-13T00:00:00Z", folder_path: "/PE/Training" },
];

const fileCounts = { "chem-1": 18, "chem-2": 6, "chem-3": 12, "eng-1": 8, "eng-2": 5, "mm-1": 14, "mm-2": 4, "pe-1": 7 };
const createSession = () => Promise.resolve({ id: "preview-session" } as StudySession);
const noop = () => undefined;

export function DesignPreview() {
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<"deadline" | "name" | "created-newest" | "created-oldest" | "fileCount">("deadline");
  const toggleSelected = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <div className={collapsed ? "w-16 shrink-0" : "w-[clamp(13.5rem,20vw,15rem)] shrink-0"}>
        <Sidebar
          sessions={[]}
          customSubjects={[]}
          homeSelected={false}
          assessmentsSelected
          timetableSelected={false}
          plannerSelected={false}
          inboxSelected={false}
          analyticsSelected={false}
          examTrackSelected={false}
          isCollapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
          onSelectHome={noop}
          onSelectAssessments={noop}
          onSelectTimetable={noop}
          onSelectPlanner={noop}
          onSelectInbox={noop}
          onSelectAnalytics={noop}
          onSelectExamTrack={noop}
          onSearch={noop}
          onStartPomodoroSession={createSession}
          onUpdatePomodoroSession={() => Promise.resolve()}
        />
      </div>
      <main className="min-w-0 flex-1">
        <AssessmentsView
          projects={projects}
          fileCounts={fileCounts}
          sortKey={sortKey}
          onSortChange={setSortKey}
          selectedProjectIds={selected}
          onToggleProjectSelection={toggleSelected}
          onSelectProject={noop}
          onNewProject={noop}
          onDelete={noop}
          onOpenProjectSettings={noop}
          onDuplicateProject={noop}
          onToggleFavorite={noop}
          onToggleArchive={noop}
          onToggleFinished={noop}
          onStartSession={createSession}
          onAddFile={noop}
          onBulkArchive={noop}
          onBulkUnarchive={noop}
          onBulkFinish={noop}
          onBulkDelete={noop}
        />
      </main>
    </div>
  );
}
