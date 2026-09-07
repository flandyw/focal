import { useState } from "react";
import { AcademicInboxView, type RecentDownload } from "@/components/inbox/AcademicInboxView";
import { Sidebar } from "@/components/shell/Sidebar";
import type { Project, StudySession, Subject } from "@/lib/types";

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

const subjects: Subject[] = [
  { id: "chem", name: "Chemistry", shortCode: "CHE", color: "#059669" },
  { id: "eng-lang", name: "English Language", shortCode: "ELG", color: "#E11D48" },
  { id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#2563EB" },
  { id: "pe", name: "Physical Education", shortCode: "PED", color: "#16A34A" },
];
const now = Date.now();
const downloads: RecentDownload[] = [
  { name: "integration_techniques_notes.pdf", path: "/Downloads/integration_techniques_notes.pdf", size: 1_887_437, modifiedAt: now - 2 * 60_000 },
  { name: "equilibrium_reaction_rates.docx", path: "/Downloads/equilibrium_reaction_rates.docx", size: 872_448, modifiedAt: now - 18 * 60_000 },
  { name: "practice_test_2_results.xlsx", path: "/Downloads/practice_test_2_results.xlsx", size: 626_688, modifiedAt: now - 24 * 60_000 },
  { name: "language_analysis_annotated.pptx", path: "/Downloads/language_analysis_annotated.pptx", size: 1_258_291, modifiedAt: now - 51 * 60_000 },
  { name: "training_plan_week_6.docx", path: "/Downloads/training_plan_week_6.docx", size: 719_872, modifiedAt: now - 3 * 60 * 60_000 },
];
const createSession = () => Promise.resolve({ id: "preview-session" } as StudySession);
const noop = () => undefined;

export function DesignPreview() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <div className={collapsed ? "w-16 shrink-0" : "w-[clamp(13.5rem,20vw,15rem)] shrink-0"}>
        <Sidebar
          sessions={[]}
          customSubjects={[]}
          homeSelected={false}
          assessmentsSelected={false}
          timetableSelected={false}
          plannerSelected={false}
          inboxSelected
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
        <AcademicInboxView
          projects={projects}
          subjects={subjects}
          onUpdateProject={noop}
          onFilesChanged={noop}
          loadRecentDownloads={() => Promise.resolve(downloads)}
          copyDownloadToProject={() => Promise.resolve()}
        />
      </main>
    </div>
  );
}
