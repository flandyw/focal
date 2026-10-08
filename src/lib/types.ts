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

export interface NotionSource {
  type: "notion";
  id: string;
  url?: string;
  lastEditedTime?: string;
  kind?: "event" | "session";
  bodyHash?: string;
  syncSnapshot?: NotionSyncSnapshot;
}

// ponytail: the brand is Focal, but the persisted keys stay "examtrack". They are a wire
// contract with the web build, the Folio Android app and rows already in Postgres.
export interface FocalWebSource {
  type: "examtrack";
  id: string;
  kind: "exam" | "sac" | "focus";
  subject: string;
  phase?: "reading" | "writing" | "paused";
  phaseBeforePause?: "reading" | "writing";
}

export interface FolioSource {
  type: "folio";
  id: string;
  kind: "study" | "exam";
  subject?: string;
  phase?: "reading" | "writing" | "paused";
  phaseBeforePause?: "reading" | "writing";
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
  /** Server revision for the canonical session row; absent for unsynced local records. */
  revision?: number;
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
  integrations?: { notion?: NotionSource; examtrack?: FocalWebSource; folio?: FolioSource };
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
  last_modified_device_id?: string | null;

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
  { id: "eng", name: "English", shortCode: "ENG", color: "hsl(335 65% 36%)", icon: "📖" },
  { id: "eng-lang", name: "English Language", shortCode: "ELG", color: "hsl(227 65% 46%)", icon: "📖" },
  { id: "lit", name: "Literature", shortCode: "LIT", color: "hsl(118 65% 36%)", icon: "📚" },
  { id: "mm", name: "Mathematical Methods", shortCode: "MCM", color: "hsl(192 65% 46%)", icon: "📐" },
  { id: "sm", name: "Specialist Mathematics", shortCode: "SME", color: "hsl(201 65% 36%)", icon: "🧮" },
  { id: "gm", name: "General Mathematics", shortCode: "GMM", color: "hsl(182 65% 36%)", icon: "📊" },
  { id: "csl", name: "Chinese Second Language", shortCode: "CSL", color: "hsl(15 65% 36%)", icon: "🀄" },
  { id: "pe", name: "Physical Education", shortCode: "PED", color: "hsl(120 65% 36%)", icon: "🏃" },
  { id: "chem", name: "Chemistry", shortCode: "CHE", color: "hsl(175 65% 46%)", icon: "🧪" },
  { id: "phys", name: "Physics", shortCode: "PHY", color: "hsl(275 65% 36%)", icon: "⚛️" },
  { id: "bio", name: "Biology", shortCode: "BIO", color: "hsl(142 65% 36%)", icon: "🧬" },
  { id: "psych", name: "Psychology", shortCode: "PSY", color: "hsl(290 65% 46%)", icon: "🧠" },
  { id: "hist", name: "History", shortCode: "HIS", color: "hsl(60 65% 36%)", icon: "🏛️" },
  { id: "geo", name: "Geography", shortCode: "GEO", color: "hsl(82 65% 36%)", icon: "🌍" },
  { id: "econ", name: "Economics", shortCode: "ECO", color: "hsl(266 65% 36%)", icon: "📈" },
  { id: "bm", name: "Business Management", shortCode: "BM", color: "hsl(248 65% 36%)", icon: "💼" },
  { id: "eal", name: "English as an Additional Language", shortCode: "EAL", color: "hsl(10 65% 46%)" },
  { id: "csl-adv", name: "Chinese Second Language Advanced", shortCode: "CSA", color: "hsl(21 65% 46%)" },
  { id: "cfl", name: "Chinese First Language", shortCode: "CFL", color: "hsl(26 65% 36%)" },
  { id: "jsl", name: "Japanese Second Language", shortCode: "JSL", color: "hsl(32 65% 46%)" },
  { id: "isl", name: "Indonesian Second Language", shortCode: "ISL", color: "hsl(38 65% 36%)" },
  { id: "fr", name: "French", shortCode: "FRE", color: "hsl(44 65% 46%)" },
  { id: "it", name: "Italian", shortCode: "ITA", color: "hsl(49 65% 36%)" },
  { id: "sp", name: "Spanish", shortCode: "SPA", color: "hsl(55 65% 46%)" },
  { id: "ahist", name: "Australian History", shortCode: "AHI", color: "hsl(66 65% 40%)" },
  { id: "rev", name: "Revolutions", shortCode: "REV", color: "hsl(71 65% 36%)" },
  { id: "anc", name: "Ancient History", shortCode: "ANC", color: "hsl(77 65% 40%)" },
  { id: "pol", name: "Politics", shortCode: "POL", color: "hsl(88 65% 40%)" },
  { id: "soc", name: "Sociology", shortCode: "SOC", color: "hsl(93 65% 36%)" },
  { id: "phil", name: "Philosophy", shortCode: "PHI", color: "hsl(99 65% 40%)" },
  { id: "legal", name: "Legal Studies", shortCode: "LEG", color: "hsl(104 65% 36%)" },
  { id: "ras", name: "Religion and Society", shortCode: "RAS", color: "hsl(110 65% 40%)" },
  { id: "hhd", name: "Health and Human Development", shortCode: "HHD", color: "hsl(131 65% 46%)" },
  { id: "envsci", name: "Environmental Science", shortCode: "ENV", color: "hsl(153 65% 46%)" },
  { id: "food", name: "Food Studies", shortCode: "FOO", color: "hsl(164 65% 36%)" },
  { id: "fm", name: "Foundation Mathematics", shortCode: "FMA", color: "hsl(211 65% 46%)" },
  { id: "da", name: "Data Analytics", shortCode: "DAT", color: "hsl(221 65% 36%)" },
  { id: "sd", name: "Software Development", shortCode: "SDV", color: "hsl(230 65% 46%)" },
  { id: "algo", name: "Algorithmics (HESS)", shortCode: "ALG", color: "hsl(240 65% 36%)" },
  { id: "acc", name: "Accounting", shortCode: "ACC", color: "hsl(257 65% 46%)" },
  { id: "media", name: "Media", shortCode: "MED", color: "hsl(300 65% 36%)" },
  { id: "artmake", name: "Art Making and Exhibiting", shortCode: "AME", color: "hsl(304 65% 46%)" },
  { id: "artcp", name: "Art Creative Practice", shortCode: "ACP", color: "hsl(308 65% 36%)" },
  { id: "vcd", name: "Visual Communication Design", shortCode: "VCD", color: "hsl(313 65% 46%)" },
  { id: "drama", name: "Drama", shortCode: "DRA", color: "hsl(317 65% 36%)" },
  { id: "theatre", name: "Theatre Studies", shortCode: "THS", color: "hsl(321 65% 46%)" },
  { id: "dance", name: "Dance", shortCode: "DAN", color: "hsl(325 65% 36%)" },
  { id: "mrp", name: "Music Repertoire Performance", shortCode: "MRP", color: "hsl(330 65% 46%)" },
  { id: "minq", name: "Music Inquiry", shortCode: "MIQ", color: "hsl(334 65% 36%)" },
  { id: "pdt", name: "Product Design and Technologies", shortCode: "PDT", color: "hsl(338 65% 46%)" },
];

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
