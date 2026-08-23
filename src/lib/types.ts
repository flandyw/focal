export type DeadlineType = "sac" | "exam" | "assignment";

export type EventType = DeadlineType | "event" | "homework" | "other" | "practice-sac";

export type FileTag = "sac" | "notes" | "past-paper" | "exam" | "resource" | "other";

export type Unit = "1" | "2" | "3" | "4";

export type StudySessionStatus = "planned" | "in-progress" | "completed";

export type ConfidenceScore = 1 | 2 | 3 | 4 | 5;

export interface StudyTimeRange {
  start: string;
  end: string;
}

export interface StudyInterval {
  start: string;
  end?: string;
  source: "manual" | "pomodoro" | "imported";
  cycleNumber?: number;
}

export type StudySessionExecution =
  | { state: "planned"; intervals: [] }
  | { state: "in-progress"; intervals: StudyInterval[] }
  | { state: "completed"; intervals: StudyInterval[]; completedAt: string; reportedMinutes?: number };

export type NotionSyncSnapshot = Record<string, string | boolean | null>;

export interface StudySessionDraft {
  id?: string;
  projectId?: string;
  subjectIds: string[];
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  status?: StudySessionStatus;
  topics?: string[];
  notes?: string;
  confidence?: ConfidenceScore;
  blockers?: string;
  nextAction?: string;
  activeDurations?: StudyTimeRange[];
  completedAt?: string;
  source?: NotionSource;
}

export interface NotionSource {
  type: "notion";
  id: string;
  url?: string;
  lastEditedTime?: string;
  kind?: "event" | "session";
  bodyHash?: string;
  syncSnapshot?: NotionSyncSnapshot;
}

export interface ExamTrackSource {
  type: "examtrack";
  id: string;
  kind: "exam" | "sac";
  subject: string;
}

export interface VcaaSource {
  type: "vcaa";
  id: string;
  year: number;
  url: string;
}

export interface StudySession {
  schemaVersion: 2;
  id: string;
  projectId?: string;
  subjectIds: string[];
  title: string;
  description?: string;
  topics?: string[]; // Topics covered in the session
  schedule: { blocks: StudyTimeRange[] };
  execution: StudySessionExecution;
  reflection?: {
    notes?: string;
    confidence?: ConfidenceScore;
    blockers?: string;
    nextAction?: string;
  };
  createdVia: "manual" | "planner" | "assistant" | "notion" | "examtrack";
  integrations?: { notion?: NotionSource; examtrack?: ExamTrackSource };
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
  last_modified_device_id?: string | null;

  /** @deprecated Compatibility view. New code should use schedule.blocks. */
  startTime: string;
  /** @deprecated Compatibility view. New code should use schedule.blocks. */
  endTime: string;
  /** @deprecated Compatibility view. New code should use execution.state. */
  status: StudySessionStatus;
  /** @deprecated Compatibility view. New code should use reflection. */
  notes?: string;
  /** @deprecated Compatibility view. New code should use reflection. */
  confidence?: ConfidenceScore;
  /** @deprecated Compatibility view. New code should use reflection. */
  blockers?: string;
  /** @deprecated Compatibility view. New code should use reflection. */
  nextAction?: string;
  /** @deprecated Compatibility view. Planned blocks and actual intervals are now separate. */
  activeDurations?: StudyTimeRange[];
  /** @deprecated Compatibility view. New code should use execution. */
  completedAt?: string;
  /** @deprecated Compatibility view. New code should use integrations.notion. */
  source?: NotionSource;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: string; // ISO date
  endTime?: string; // ISO date
  eventType: EventType;
  subjectId?: string;
  location?: string;
  isFinished?: boolean;
  finishedAt?: string;
  source?: NotionSource | VcaaSource;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
  last_modified_device_id?: string | null;
}

export interface Subject {
  id: string;
  name: string;
  shortCode: string;
  color: string;
  icon?: string;
}

export const VCE_SUBJECTS: Subject[] = [
  { id: "eng", name: "English", shortCode: "ENG", color: "#E11D48", icon: "📖" },
  { id: "eng-lang", name: "English Language", shortCode: "ELG", color: "#E11D48", icon: "📖" },
  { id: "lit", name: "Literature", shortCode: "LIT", color: "#E11D48", icon: "📚" },
  { id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "#2563EB", icon: "📐" },
  { id: "sm", name: "Specialist Mathematics", shortCode: "SME", color: "#2563EB", icon: "🧮" },
  { id: "gm", name: "General Mathematics", shortCode: "GMM", color: "#2563EB", icon: "📊" },
  { id: "csl", name: "Chinese Second Language", shortCode: "CSL", color: "#DC2626", icon: "🀄" },
  { id: "pe", name: "Physical Education", shortCode: "PED", color: "#16A34A", icon: "🏃" },
  { id: "chem", name: "Chemistry", shortCode: "CHE", color: "#059669", icon: "🧪" },
  { id: "phys", name: "Physics", shortCode: "PHY", color: "#7C3AED", icon: "⚛️" },
  { id: "bio", name: "Biology", shortCode: "BIO", color: "#16A34A", icon: "🧬" },
  { id: "psych", name: "Psychology", shortCode: "PSY", color: "#EA580C", icon: "🧠" },
  { id: "hist", name: "History", shortCode: "HIS", color: "#A16207", icon: "🏛️" },
  { id: "geo", name: "Geography", shortCode: "GEO", color: "#0D9488", icon: "🌍" },
  { id: "econ", name: "Economics", shortCode: "ECO", color: "#DC2626", icon: "📈" },
  { id: "bm", name: "Business Management", shortCode: "BM", color: "#4F46E5", icon: "💼" },

];

export const DEFAULT_SUBFOLDERS = ["SACs", "Notes", "Past-Papers", "Exam-Revision", "Resources"];

export interface ProjectChecklistItem {
  id: string
  text: string
  completed: boolean
}

export interface ProjectPlanningSettings {
  /** Total effort expected for this assessment, including completed study. */
  estimatedMinutes: number
  /** Preferred size of each generated focus block. */
  sessionMinutes: number
}

export interface AssessmentResult {
  id: string
  title: string
  score: number
  maxScore: number
  completedAt: string
  topics: string[]
  feedback?: string
}

export interface StudyCard {
  id: string
  question: string
  answer: string
  topics: string[]
  sourcePath: string
  sourceName: string
  createdAt: string
  reviewCount: number
  correctCount: number
  intervalDays: number
  dueAt: string
  lastReviewedAt?: string
}

export interface ProjectTemplate {
  id: string
  name: string
  description?: string
  icon?: string
  subjectId?: string
  unit?: Unit
  deadlineType?: DeadlineType
  customSubfolders?: string[]
  checklist?: { text: string }[]
  created_at: string
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  deadline?: string;
  created_at: string;
  folder_path: string;
  subjectId?: string;
  unit?: Unit;
  deadlineType?: DeadlineType;
  examDate?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
  isFinished?: boolean;
  customSubfolders?: string[];
  isLinked?: boolean;
  notes?: string
  checklist?: ProjectChecklistItem[]
  dependsOn?: string[]
  templateId?: string
  planning?: ProjectPlanningSettings
  results?: AssessmentResult[]
  studyCards?: StudyCard[]
  updated_at?: string;
  deleted_at?: string | null;
  last_modified_device_id?: string | null;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified: number;
  extension: string;
  tag?: FileTag; // Legacy field for backward compatibility
  tags?: FileTag[];
  subfolder?: string;
  isFavorite?: boolean;
}

export interface SearchResult {
  file: FileInfo;
  projectFolder: string;
}

// --- Timetable ---

/**
 * The day label for a timetable entry. Historically hardcoded to 1–10 for the
 * default VCE two-week cycle; the cycle length is now configurable so the label
 * is a plain positive integer (1..cycleLength).
 */
export type TimetableDayLabel = number

export interface TimetablePeriod {
  period: string
  subject: string
  location?: string
  startTime: string // HH:mm
  endTime: string   // HH:mm
}

export interface TimetableEntry {
  dayLabel: TimetableDayLabel // 1–10
  periods: TimetablePeriod[]
}

export interface SchoolHoliday {
  name: string
  startDate: string // YYYY-MM-DD
  endDate: string   // YYYY-MM-DD
}

export interface UserSettings {
  openrouter_api_key: string
  openrouter_model: string
  reasoning_effort: string
  reasoning_max_tokens: number
  reasoning_exclude: boolean
  notion_token: string
  notion_data_source_id: string
  notion_title_property: string
  notion_date_property: string
  notion_type_property: string
  notion_completed_property: string
  notion_subject_property: string
  // ponytail: AI provider plumbing — see src/lib/providers/* + PROVIDERS.md.
  provider?: string
  ollama_base_url?: string
  ollama_model?: string
  assistant_personality?: string
  assistant_custom_instructions?: string
  quick_links?: QuickLink[]
}

export interface QuickLink {
  id: string
  label: string
  url: string
  icon: string
  color: string
}

export interface TimetableViewSettings {
  /** Show all 10 days at once instead of 5-day blocks. */
  showAllDays: boolean
  /** Show location badges on period rows. */
  showLocations: boolean
  /** Show break entries (Recess, Lunch, etc.). */
  showBreaks: boolean
  /** Use 24-hour time format instead of 12-hour. */
  use24Hour: boolean
  /** Manual week block override (null = auto-detect from current day). */
  manualBlock: 1 | 2 | null
  /** Day labels to hide from the view display. */
  hiddenDays: number[]
}

/** Relaxed timetable config for localStorage persistence. Use TimetableEntry from types.ts for runtime access. */
export interface TimetableConfig {
  enabled: boolean
  day1Starts: string // YYYY-MM-DD — the first day of the cycle
  holidays: SchoolHoliday[]
  entries: TimetableEntry[]
  /** Total number of days in the cycle. Default 10 (two school weeks, Mon–Fri). */
  cycleLength?: number
  /**
   * Day-label → JS weekday (0=Sun..6=Sat). Size equals `cycleLength`. The default
   * for cycleLength=10 is [1,2,3,4,5,1,2,3,4,5] (Mon–Fri, then Mon–Fri again).
   * Lets the user override which calendar day each "Day X" lands on.
   */
  dayToWeekday?: number[]
  /**
   * When true, Saturday and Sunday count as school days and the cycle can
   * include weekend day-labels. When false (default), weekends return null
   * from getDayLabelForDate so the day picker shows "Weekend" instead of
   * the most recent Friday's day-label.
   */
  weekendTimetables?: boolean
  /** Manual override of the current day label (1..cycleLength). When set, takes precedence over the date-based calculation. */
  currentDayOverride?: TimetableDayLabel | null
  /** View-level display preferences. */
  viewSettings?: TimetableViewSettings
}

export type PriorityItemKind =
  | "overdue-project"
  | "upcoming-assessment"
  | "pinned-event"
  | "planned-session"
  | "plan-prep"
  | "weak-topic";

export type PriorityUrgency = "critical" | "high" | "medium" | "low";

export interface PriorityItem {
  id: string;
  kind: PriorityItemKind;
  title: string;
  reason: string;
  urgency: PriorityUrgency;
  subjectIds: string[];
  projectId?: string;
  eventId?: string;
  sessionId?: string;
  action: string;
}
