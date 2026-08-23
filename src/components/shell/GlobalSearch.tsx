import {
 useState,
 useEffect,
 useCallback,
 useId,
 useMemo,
 useRef,
} from"react";
import { invoke } from"@tauri-apps/api/core";
import { openPath } from"@tauri-apps/plugin-opener";
import { format, parseISO } from"date-fns";
import { toast } from"sonner";
import {
 Search,
 X,
 FileText,
 Folder,
 ArrowRight,
 BarChart3,
 Home,
 CalendarDays,
 CalendarClock,
 CircleHelp,
 GraduationCap,
 History,
 Inbox,
 Plus,
 Sparkles,
 Settings,
} from"lucide-react";
import { Button } from"@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from"@/components/ui/dialog";
import { Input } from"@/components/ui/input";
import { ScrollArea } from"@/components/ui/scroll-area";
import { isMacOS } from"@/lib/platform";
import { FileTypeIcon } from"@/components/FileTypeIcon";
import {
 formatFileSize,
 getEventTypeInfo,
 getSessionSubjectIds,
 getSubjectById,
} from"@/lib/utils";
import type {
 CalendarEvent,
 Project,
 StudySession,
 SearchResult,
} from"@/lib/types";
import { cn } from"@/lib/utils";
import {
 addRecentSearch,
 getSearchNavigationIndex,
 normaliseRecentSearches,
} from"@/lib/searchNavigation";

interface GlobalSearchProps {
 projects: Project[];
 sessions: StudySession[];
 events: CalendarEvent[];
 onSelectProject: (id: string) => void;
 onSelectSession: (session: StudySession) => void;
 onSelectEvent: (event: CalendarEvent) => void;
 onNewProject?: () => void;
 onNewSession?: () => void;
 onNewEvent?: () => void;
 onGoHome?: () => void;
 onGoTimetable?: () => void;
 onGoPlanner?: () => void;
 onGoInbox?: () => void;
 onGoAnalytics?: () => void;
 onGoExamTrack?: () => void;
 onGoSettings?: () => void;
 onOpenAiAssistant?: () => void;
 onShowShortcuts?: () => void;
 open: boolean;
 onOpenChange: (open: boolean) => void;
}

interface SearchResults {
 projects: Project[];
 sessions: StudySession[];
 events: CalendarEvent[];
 files: SearchResult[];
}

const EMPTY_RESULTS: SearchResults = {
 projects: [],
 sessions: [],
 events: [],
 files: [],
};

type SearchItem =
 | { type:"project"; data: Project }
 | { type:"session"; data: StudySession }
 | { type:"event"; data: CalendarEvent }
 | { type:"file"; data: SearchResult }
 | { type:"recent"; query: string };

interface QuickAction {
 type:"action";
 id: string;
 label: string;
 hint: string;
 aliases: string[];
 shortcut?: string;
 icon: typeof Search;
 run: () => void;
}

function getTotalResults(results: SearchResults) {
 return (
 results.projects.length +
 results.sessions.length +
 results.events.length +
 results.files.length
 );
}

function quickActionMatches(action: QuickAction, lowerQuery: string) {
 return (
 action.label.toLowerCase().includes(lowerQuery) ||
 action.hint.toLowerCase().includes(lowerQuery) ||
 action.aliases.some((alias) => alias.includes(lowerQuery))
 );
}

function formatSearchDate(value: string | undefined, pattern = "MMM d, h:mm a") {
 if (!value) return undefined;
 const date = parseISO(value);
 return Number.isNaN(date.getTime()) ? undefined : format(date, pattern);
}

const RECENT_SEARCHES_KEY = "focal-recent-searches";

function readRecentSearches(): string[] {
 try {
 return normaliseRecentSearches(JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]"));
 } catch {
 return [];
 }
}

export function GlobalSearch({
 projects,
 sessions,
 events,
 onSelectProject,
 onSelectSession,
 onSelectEvent,
 onNewProject,
 onNewSession,
 onNewEvent,
 onGoHome,
 onGoTimetable,
 onGoPlanner,
 onGoInbox,
 onGoAnalytics,
 onGoExamTrack,
 onGoSettings,
 onOpenAiAssistant,
 onShowShortcuts,
 open,
 onOpenChange,
}: GlobalSearchProps) {
 const [query, setQuery] = useState("");
 const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
 const [loading, setLoading] = useState(false);
 const [fileSearchFailed, setFileSearchFailed] = useState(false);
 const [fileResultTotal, setFileResultTotal] = useState(0);
 const [recentSearches, setRecentSearches] = useState(readRecentSearches);
 const [selectedIndex, setSelectedIndex] = useState(-1);
 const resultRefs = useRef<(HTMLButtonElement | null)[]>([]);
 const searchRequestRef = useRef(0);
 const searchId = useId();
 const titleId = `${searchId}-title`;
 const resultListId = `${searchId}-results`;
 const statusId = `${searchId}-status`;
 const getResultId = (index: number) => `${resultListId}-${index}`;
 const modKeyLabel = isMacOS ?"⌘" :"Ctrl";

 const quickActions = useMemo<QuickAction[]>(
 () => {
 const actions: (QuickAction | undefined)[] = [
 onNewProject && {
 type:"action" as const,
 id:"new-assessment",
 label:"New assessment",
 hint:"Create a folder-backed assessment",
 aliases: ["project","assignment","task","sac","folder"],
 shortcut: `${modKeyLabel} N`,
 icon: Plus,
 run: onNewProject,
 },
 onNewSession && {
 type:"action" as const,
 id:"new-session",
 label:"Plan study session",
 hint:"Plan focused study time",
 aliases: ["study","focus","revision","timer","pomodoro"],
 shortcut: `${modKeyLabel} ⇧ S`,
 icon: FileText,
 run: onNewSession,
 },
 onNewEvent && {
 type:"action" as const,
 id:"new-event",
 label:"New event",
 hint:"Add a deadline, class, or reminder",
 aliases: ["calendar","deadline","due","reminder","schedule"],
 shortcut: `${modKeyLabel} ⇧ N`,
 icon: CalendarDays,
 run: onNewEvent,
 },
 onGoHome && {
 type:"action" as const,
 id:"go-home",
 label:"Go to Today",
 hint:"Review this month's workload",
 aliases: ["home","dashboard","overview","month","plan"],
 shortcut:"H",
 icon: Home,
 run: onGoHome,
 },
 onGoTimetable && {
 type:"action" as const,
 id:"go-timetable",
 label:"Open timetable",
 hint:"Check current and upcoming periods",
 aliases: ["schedule","classes","periods","day","school"],
 shortcut:"T",
 icon: CalendarDays,
 run: onGoTimetable,
 },
 onGoPlanner && {
 type:"action" as const,
 id:"go-planner",
 label:"Open planner",
 hint:"Build a balanced seven-day study plan",
 aliases: ["adaptive","plan","workload","schedule","capacity"],
 shortcut:"P",
 icon: CalendarClock,
 run: onGoPlanner,
 },
 onGoInbox && {
 type:"action" as const,
 id:"go-inbox",
 label:"Open academic inbox",
 hint:"Sort recent downloads and teacher notes",
 aliases: ["inbox","downloads","teacher","notes","files"],
 shortcut:"B",
 icon: Inbox,
 run: onGoInbox,
 },
 onGoAnalytics && {
 type:"action" as const,
 id:"go-analytics",
 label:"Open analytics",
 hint:"Review study patterns",
 aliases: ["stats","charts","progress","reports","insights"],
 shortcut:"A",
 icon: BarChart3,
 run: onGoAnalytics,
 },
 onGoExamTrack && {
 type:"action" as const,
 id:"go-examtrack",
 label:"Open exam practice",
 hint:"Review practice attempts and due mistakes",
 aliases: ["exam","practice","mistakes","examtrack","revision"],
 shortcut:"E",
 icon: GraduationCap,
 run: onGoExamTrack,
 },
 onGoSettings && {
 type:"action" as const,
 id:"open-settings",
 label:"Open settings",
 hint:"Manage account, sync, data, and AI models",
 aliases: ["preferences","account","sync","backup","models"],
 shortcut: `${modKeyLabel} ,`,
 icon: Settings,
 run: onGoSettings,
 },
 onOpenAiAssistant && {
 type:"action" as const,
 id:"open-ai-assistant",
 label:"Ask AI Assistant",
 hint:"Quick answers about studying, planning, or subjects",
 aliases: ["ai","assistant","chat","ask","help","explain"],
 shortcut:"I",
 icon: Sparkles,
 run: onOpenAiAssistant,
 },
 onShowShortcuts && {
 type:"action" as const,
 id:"show-shortcuts",
 label:"Keyboard shortcuts",
 hint:"See every keyboard command",
 aliases: ["help","keys","commands","cheat sheet"],
 shortcut:"?",
 icon: CircleHelp,
 run: onShowShortcuts,
 },
 ];
 return actions.filter((action): action is QuickAction => Boolean(action));
 },
 [
 modKeyLabel,
 onGoAnalytics,
 onGoExamTrack,
 onGoHome,
 onGoInbox,
 onGoPlanner,
 onGoSettings,
 onGoTimetable,
 onNewEvent,
 onNewProject,
 onNewSession,
 onOpenAiAssistant,
 onShowShortcuts,
 ],
 );

 useEffect(() => {
 if (open) {
 // eslint-disable-next-line react-hooks/set-state-in-effect
 setQuery("");
 setResults(EMPTY_RESULTS);
 setLoading(false);
 setFileSearchFailed(false);
 setFileResultTotal(0);
 setSelectedIndex(quickActions.length > 0 ? 0 : -1);
 }
 }, [open, quickActions.length]);

 const search = useCallback(
 async (
 q: string,
 projs: Project[],
 sess: StudySession[],
 evts: CalendarEvent[],
 ) => {
 const requestId = searchRequestRef.current + 1;
 searchRequestRef.current = requestId;
 const trimmed = q.trim();

 if (!trimmed) {
 setResults(EMPTY_RESULTS);
 setLoading(false);
 setFileSearchFailed(false);
 setFileResultTotal(0);
 setSelectedIndex(quickActions.length > 0 ? 0 : -1);
 return;
 }

 const lower = trimmed.toLowerCase();
 const matchedQuickActionCount = quickActions.filter((action) =>
 quickActionMatches(action, lower),
 ).length;

 const matchedProjects = projs.filter(
 (p) =>
 p.name.toLowerCase().includes(lower) ||
 p.folder_path.toLowerCase().includes(lower) ||
 (p.description?.toLowerCase().includes(lower) ?? false) ||
 (getSubjectById(p.subjectId)?.name.toLowerCase().includes(lower) ??
 false),
 );

 const matchedSessions = sess.filter((s) => {
 const project = projs.find((p) => p.id === s.projectId);
 const subjectMatch = getSessionSubjectIds(s, project).some(
 (subjectId) => {
 const subject = getSubjectById(subjectId);
 return (
 subjectId.toLowerCase().includes(lower) ||
 (subject?.name.toLowerCase().includes(lower) ?? false) ||
 (subject?.shortCode.toLowerCase().includes(lower) ?? false)
 );
 },
 );
 return (
 s.title.toLowerCase().includes(lower) ||
 (s.description?.toLowerCase().includes(lower) ?? false) ||
 (s.topics?.some((t) => t.toLowerCase().includes(lower)) ?? false) ||
 (project?.name.toLowerCase().includes(lower) ?? false) ||
 subjectMatch
 );
 });

 const matchedEvents = evts.filter((event) => {
 const subject = getSubjectById(event.subjectId);
 const eventInfo = getEventTypeInfo(event.eventType);
 return (
 event.title.toLowerCase().includes(lower) ||
 (event.description?.toLowerCase().includes(lower) ?? false) ||
 (event.location?.toLowerCase().includes(lower) ?? false) ||
 (subject?.name.toLowerCase().includes(lower) ?? false) ||
 eventInfo.label.toLowerCase().includes(lower)
 );
 });

 const immediateResults = {
 projects: matchedProjects,
 sessions: matchedSessions,
 events: matchedEvents,
 files: [],
 };
 setResults(immediateResults);
 setSelectedIndex(
 matchedQuickActionCount + getTotalResults(immediateResults) > 0 ? 0 : -1,
 );
 setLoading(true);
 setFileSearchFailed(false);
 setFileResultTotal(0);

 try {
 const fileResults = await invoke<SearchResult[]>(
"search_files_all_projects",
 { query: trimmed },
 );
 if (searchRequestRef.current !== requestId) return;

 const nextResults = {
 projects: matchedProjects,
 sessions: matchedSessions,
 events: matchedEvents,
 files: fileResults.slice(0, 20),
 };
 setFileResultTotal(fileResults.length);
 setResults(nextResults);
 setSelectedIndex(
 matchedQuickActionCount + getTotalResults(nextResults) > 0 ? 0 : -1,
 );
 } catch {
 if (searchRequestRef.current !== requestId) return;

 setResults(immediateResults);
 setFileSearchFailed(true);
 setFileResultTotal(0);
 } finally {
 if (searchRequestRef.current === requestId) {
 setLoading(false);
 }
 }
 },
 [quickActions],
 );

 useEffect(() => {
 const timer = setTimeout(
 () => { void search(query, projects, sessions, events) },
 200,
 );
 return () => clearTimeout(timer);
 }, [query, search, projects, sessions, events]);

 const trimmedQuery = query.trim();
 const hasQuery = trimmedQuery.length > 0;
 const lowerQuery = trimmedQuery.toLowerCase();
 const visibleQuickActions = hasQuery
 ? quickActions.filter((action) => quickActionMatches(action, lowerQuery))
 : quickActions;
 const visibleRecentSearches = hasQuery ? [] : recentSearches;
 const recentOffset = visibleQuickActions.length;
 const actionOffset = recentOffset + visibleRecentSearches.length;
 const resultItems: SearchItem[] = [
 ...results.projects.map((p) => ({ type:"project" as const, data: p })),
 ...results.sessions.map((s) => ({ type:"session" as const, data: s })),
 ...results.events.map((event) => ({ type:"event" as const, data: event })),
 ...results.files.map((f) => ({ type:"file" as const, data: f })),
 ];
 const recentItems: SearchItem[] = visibleRecentSearches.map((recentQuery) => ({
 type:"recent" as const,
 query: recentQuery,
 }));
 const allItems = [...visibleQuickActions, ...recentItems, ...resultItems];
 const totalItems = allItems.length;
 const hasVisibleResults = totalItems > 0;
 const activeResultId =
 selectedIndex >= 0 ? getResultId(selectedIndex) : undefined;

 const rememberSearch = (value: string) => {
 const next = addRecentSearch(recentSearches, value);
 setRecentSearches(next);
 try {
 localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
 } catch {
 // Search history remains available for this session.
 }
 };

 const clearRecentSearches = () => {
 setRecentSearches([]);
 try {
 localStorage.removeItem(RECENT_SEARCHES_KEY);
 } catch {
 // Search history is already cleared for this session.
 }
 setSelectedIndex(quickActions.length > 0 ? 0 : -1);
 };

 const handleSelect = (item: SearchItem | QuickAction) => {
 if (item.type ==="action") {
 item.run();
 onOpenChange(false);
 return;
 }
 if (item.type ==="recent") {
 setQuery(item.query);
 const matchingActions = quickActions.filter((action) =>
 quickActionMatches(action, item.query.toLocaleLowerCase()),
 ).length;
 setSelectedIndex(matchingActions > 0 ? 0 : -1);
 return;
 }
 rememberSearch(trimmedQuery);
 if (item.type ==="project") {
 onSelectProject(item.data.id);
 } else if (item.type ==="session") {
 onSelectSession(item.data);
 } else if (item.type ==="event") {
 onSelectEvent(item.data);
 } else if (item.type ==="file") {
 void openPath(item.data.file.path).catch(() => {
 toast.error(`Couldn't open "${item.data.file.name}". It may have been moved or deleted.`);
 });
 }
 onOpenChange(false);
 };

 const kbdClass =
"inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border/80 bg-muted/70 px-1.5 font-mono text-caption leading-none text-muted-foreground"

 const handleKeyDown = (e: React.KeyboardEvent) => {
 const nextIndex = getSearchNavigationIndex(e.key, selectedIndex, totalItems);
 if (nextIndex !== null) {
 e.preventDefault();
 setSelectedIndex(nextIndex);
 } else if (
 e.key ==="Enter" &&
 selectedIndex >= 0 &&
 selectedIndex < allItems.length
 ) {
 e.preventDefault();
 handleSelect(allItems[selectedIndex]);
 } else if (e.key ==="Escape" && query) {
 e.preventDefault();
 e.stopPropagation();
 setQuery("");
 setSelectedIndex(quickActions.length > 0 ? 0 : -1);
 }
 };

 useEffect(() => {
 resultRefs.current = [];
 }, [totalItems]);

 useEffect(() => {
 if (selectedIndex >= 0 && selectedIndex < resultRefs.current.length) {
 const el = resultRefs.current[selectedIndex];
 if (el) {
 el.scrollIntoView({ block:"nearest", behavior:"auto" });
 }
 }
 }, [selectedIndex]);

 return ( <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent
 showCloseButton={false}
 className="top-[14vh] block max-w-2xl translate-y-0 gap-0 rounded-xl border-border/70 p-0 shadow-md sm:top-[18vh]"
 onKeyDown={handleKeyDown}
 >
 <DialogTitle id={titleId} className="sr-only">
 Search
 </DialogTitle>
 <DialogDescription className="sr-only">
 Search your workspace or run a quick action. Use arrow keys to move through results.
 </DialogDescription>
 <div id={statusId} className="sr-only" aria-live="polite">
 {loading
 ?"Searching"
 : hasQuery
 ? `${totalItems} ${totalItems === 1 ? "result" : "results"}`
 : `${visibleQuickActions.length} quick actions and ${visibleRecentSearches.length} recent searches`}
 </div>

 <div className="flex min-h-14 items-center gap-3 border-b px-4">
 <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
 <Input
 value={query}
 onChange={(e) => {
 const nextQuery = e.target.value;
 const nextLower = nextQuery.trim().toLowerCase();
 const hasMatchingAction =
 nextLower.length > 0 &&
 quickActions.some((action) => quickActionMatches(action, nextLower));
 setQuery(nextQuery);
 setSelectedIndex(
 nextLower ? (hasMatchingAction ? 0 : -1) : quickActions.length > 0 ? 0 : -1,
 );
 }}
 placeholder="Search assessments, sessions, events, files"
 aria-label="Search assessments, sessions, events, files"
 role="combobox"
 aria-expanded={totalItems > 0}
 aria-controls={resultListId}
 aria-activedescendant={activeResultId}
 aria-describedby={statusId}
 aria-keyshortcuts={`${isMacOS ? "Meta" : "Control"}+K /`}
 autoComplete="off"
 autoFocus
 enterKeyHint="search"
 spellCheck={false}
 className="h-13 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent"
 />
 {query && (
 <Button
 variant="ghost"
 size="icon-sm"
 className="shrink-0"
 onClick={() => {
 setQuery("");
 setSelectedIndex(quickActions.length > 0 ? 0 : -1);
 }}
 >
 <X className="h-3.5 w-3.5" />
 <span className="sr-only">Clear search</span>
 </Button>
 )}
 <Button
 variant="ghost"
 size="icon-sm"
 className="shrink-0"
 onClick={() => onOpenChange(false)}
 aria-label="Close search"
 >
 <X className="h-3.5 w-3.5" />
 </Button>
 </div>

 {hasVisibleResults && (
 <ScrollArea className="max-h-[min(60vh,28rem)]">
 <div
 id={resultListId}
 role="listbox"
 aria-label="Search results"
 aria-busy={loading}
 className="py-2"
 >
 {visibleQuickActions.length > 0 && (
 <div role="group" aria-label="Quick actions">
 <div className="px-4 pb-1 pt-2 text-micro font-semibold uppercase text-muted-foreground">
 Actions · {visibleQuickActions.length}
 </div>
 {visibleQuickActions.map((action, index) => {
 const Icon = action.icon;
 return (
 <Button
 ref={(el) => {
 resultRefs.current[index] = el;
 }}
 key={action.id}
 id={getResultId(index)}
 role="option"
 aria-selected={selectedIndex === index}
 variant="ghost"
 className={cn("group h-auto min-h-12 w-full justify-start rounded-none px-4 py-2.5 text-left whitespace-normal", selectedIndex === index &&"bg-accent")}
 onMouseEnter={() => setSelectedIndex(index)}
 onClick={() => handleSelect(action)}
 >
 <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary/75">
 <Icon className="h-4 w-4" />
 </span>
 <span className="min-w-0 flex-1">
 <span className="block truncate text-sm font-medium">
 {action.label}
 </span>
 <span className="block truncate text-xs text-muted-foreground">
 {action.hint}
 </span>
 </span>
 {action.shortcut ? (
 <kbd
 className={cn(
 kbdClass,
"hidden shrink-0 opacity-70 transition-opacity group-hover:opacity-100 group-aria-selected:opacity-100 sm:inline-flex",
 )}
 >
 {action.shortcut}
 </kbd>
 ) : (
 <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 group-aria-selected:opacity-100" />
 )}
 </Button>
 );
 })}
 </div>
 )}

 {visibleRecentSearches.length > 0 && (
 <div role="group" aria-label="Recent searches">
 <div className="flex items-center px-4 pb-1 pt-2">
 <span className="text-micro font-semibold uppercase text-muted-foreground">
 Recent · {visibleRecentSearches.length}
 </span>
 <Button
 variant="ghost"
 size="xs"
 className="ml-auto h-6 text-muted-foreground"
 onClick={clearRecentSearches}
 >
 Clear history
 </Button>
 </div>
 {visibleRecentSearches.map((recentQuery, idx) => {
 const globalIdx = recentOffset + idx;
 return (
 <Button
 ref={(element) => { resultRefs.current[globalIdx] = element; }}
 key={recentQuery.toLocaleLowerCase()}
 id={getResultId(globalIdx)}
 role="option"
 aria-selected={selectedIndex === globalIdx}
 variant="ghost"
 className={cn("group h-auto min-h-11 w-full justify-start rounded-none px-4 py-2 text-left", selectedIndex === globalIdx && "bg-accent")}
 onMouseEnter={() => setSelectedIndex(globalIdx)}
 onClick={() => handleSelect({ type:"recent", query: recentQuery })}
 >
 <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
 <History className="size-4" />
 </span>
 <span className="min-w-0 flex-1 truncate text-sm font-medium">{recentQuery}</span>
 <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100" />
 </Button>
 );
 })}
 </div>
 )}

 {results.projects.length > 0 && (
 <div role="group" aria-label="Assessments">
 <div className="px-4 pb-1 pt-2 text-micro font-semibold uppercase text-muted-foreground">
 Assessments · {results.projects.length}
 </div>
 {results.projects.map((project, idx) => {
 const subject = getSubjectById(project.subjectId);
 const deadline = formatSearchDate(project.deadline,"MMM d");
 const globalIdx = actionOffset + idx;
 return (
 <Button
 ref={(el) => {
 resultRefs.current[globalIdx] = el;
 }}
 key={project.id}
 id={getResultId(globalIdx)}
 role="option"
 aria-selected={selectedIndex === globalIdx}
 variant="ghost"
 className={cn("group h-auto min-h-12 w-full justify-start rounded-none px-4 py-2.5 text-left whitespace-normal", selectedIndex === globalIdx &&"bg-accent")}
 onMouseEnter={() => setSelectedIndex(globalIdx)}
 onClick={() =>
 handleSelect({ type:"project", data: project })
 }
 >
 <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/45 text-sm">
 {project.icon ??"📄"}
 </span>
 <div className="flex-1 min-w-0">
 <p className="truncate text-sm font-medium">
 {project.name}
 </p>
 <span className="flex items-center gap-2">
 {subject && (
 <span
 className="rounded px-1.5 py-0.5 text-micro font-medium"
 style={{
 backgroundColor: subject.color +"20",
 color: subject.color,
 }}
 >
 {subject.shortCode}
 </span>
 )}
 {deadline && (
 <span className="text-xs text-muted-foreground">
 Due {deadline}
 </span>
 )}
 </span>
 </div>
 <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 group-aria-selected:opacity-100" />
 </Button>
 );
 })}
 </div>
 )}

 {results.sessions.length > 0 && (
 <div role="group" aria-label="Study Sessions">
 <div className="px-4 pb-1 pt-2 text-micro font-semibold uppercase text-muted-foreground">
 Study Sessions · {results.sessions.length}
 </div>
 {results.sessions.map((session, idx) => {
 const project = projects.find(
 (p) => p.id === session.projectId,
 );
 const subjectLabel = getSessionSubjectIds(session, project)
 .map(
 (subjectId) =>
 getSubjectById(subjectId)?.shortCode ?? subjectId,
 )
 .join(", ");
 const sessionDate = formatSearchDate(session.startTime);
 const globalIdx = actionOffset + results.projects.length + idx;
 return (
 <Button
 ref={(el) => {
 resultRefs.current[globalIdx] = el;
 }}
 key={session.id}
 id={getResultId(globalIdx)}
 role="option"
 aria-selected={selectedIndex === globalIdx}
 variant="ghost"
 className={cn("group h-auto min-h-12 w-full justify-start rounded-none px-4 py-2.5 text-left whitespace-normal", selectedIndex === globalIdx &&"bg-accent")}
 onMouseEnter={() => setSelectedIndex(globalIdx)}
 onClick={() =>
 handleSelect({ type:"session", data: session })
 }
 >
 <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
 <FileText className="h-4 w-4 text-primary/70" />
 </div>
 <div className="flex-1 min-w-0">
 <p className="truncate text-sm font-medium">
 {session.title}
 </p>
 <p className="truncate text-xs text-muted-foreground">
 {[(project?.name ?? subjectLabel) ||"Study session", sessionDate]
 .concat(session.status === "completed" ? ["Completed"] : [])
 .filter(Boolean)
 .join(" · ")}
 </p>
 </div>
 <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 group-aria-selected:opacity-100" />
 </Button>
 );
 })}
 </div>
 )}

 {results.events.length > 0 && (
 <div role="group" aria-label="Events">
 <div className="px-4 pb-1 pt-2 text-micro font-semibold uppercase text-muted-foreground">
 Events · {results.events.length}
 </div>
 {results.events.map((event, idx) => {
 const subject = getSubjectById(event.subjectId);
 const eventInfo = getEventTypeInfo(event.eventType);
 const eventDate = formatSearchDate(event.startTime);
 const globalIdx =
 actionOffset + results.projects.length + results.sessions.length + idx;
 return (
 <Button
 ref={(el) => {
 resultRefs.current[globalIdx] = el;
 }}
 key={event.id}
 id={getResultId(globalIdx)}
 role="option"
 aria-selected={selectedIndex === globalIdx}
 variant="ghost"
 className={cn("group h-auto min-h-12 w-full justify-start rounded-none px-4 py-2.5 text-left whitespace-normal", selectedIndex === globalIdx &&"bg-accent")}
 onMouseEnter={() => setSelectedIndex(globalIdx)}
 onClick={() =>
 handleSelect({ type:"event", data: event })
 }
 >
 <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
 <CalendarDays className="h-4 w-4 text-primary/70" />
 </div>
 <div className="flex-1 min-w-0">
 <p className="truncate text-sm font-medium">
 {event.title}
 </p>
 <div className="mt-1 flex flex-wrap items-center gap-1.5">
 <span
 className="rounded px-1.5 py-0.5 text-micro font-medium"
 style={{
 backgroundColor: eventInfo.color +"20",
 color: eventInfo.color,
 }}
 >
 {eventInfo.label}
 </span>
 {subject && (
 <span
 className="rounded px-1.5 py-0.5 text-micro font-medium"
 style={{
 backgroundColor: subject.color +"20",
 color: subject.color,
 }}
 >
 {subject.shortCode}
 </span>
 )}
 {eventDate && (
 <span className="text-xs text-muted-foreground">
 {eventDate}
 </span>
 )}
 {event.isFinished && (
 <span className="text-xs font-medium text-success">Completed</span>
 )}
 </div>
 </div>
 <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 group-aria-selected:opacity-100" />
 </Button>
 );
 })}
 </div>
 )}

 {results.files.length > 0 && (
 <div role="group" aria-label="Files">
 <div className="px-4 pb-1 pt-2 text-micro font-semibold uppercase text-muted-foreground">
 Files · {results.files.length}{fileResultTotal > results.files.length ? "+" : ""}
 </div>
 {results.files.map((result, idx) => {
 const globalIdx =
 actionOffset +
 results.projects.length +
 results.sessions.length +
 results.events.length +
 idx;
 return (
 <Button
 ref={(el) => {
 resultRefs.current[globalIdx] = el;
 }}
 key={result.file.path}
 id={getResultId(globalIdx)}
 role="option"
 aria-selected={selectedIndex === globalIdx}
 variant="ghost"
 className={cn("group h-auto min-h-12 w-full justify-start rounded-none px-4 py-2.5 text-left whitespace-normal", selectedIndex === globalIdx &&"bg-accent")}
 onMouseEnter={() => setSelectedIndex(globalIdx)}
 onClick={() =>
 handleSelect({ type:"file", data: result })
 }
 >
 <FileTypeIcon extension={result.file.extension} />
 <div className="flex-1 min-w-0">
 <p className="truncate text-sm font-medium">
 {result.file.name}
 </p>
 <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <Folder className="h-3 w-3 shrink-0" />
 <span className="truncate">
 {result.projectFolder}
 </span>
 <span aria-hidden="true">·</span>
 <span className="shrink-0 tabular-nums">
 {formatFileSize(result.file.size)}
 </span>
 </div>
 </div>
 <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 group-aria-selected:opacity-100" />
 </Button>
 );
 })}
 </div>
 )}
 {fileResultTotal > results.files.length && (
 <p className="px-4 py-2 text-xs text-muted-foreground" role="status">
 Showing the first {results.files.length} of {fileResultTotal} file matches. Refine the search to narrow them down.
 </p>
 )}
 </div>
 </ScrollArea>
 )}

 {hasQuery && totalItems === 0 && loading && (
 <div className="space-y-2 px-4 py-4" aria-label="Searching">
 {Array.from({ length: 4 }).map((_, index) => (
 <div
 key={index}
 className="flex min-h-12 items-center gap-3 rounded-lg py-2"
 >
 <div className="size-8 rounded-lg bg-muted/60 motion-safe:animate-pulse" />
 <div className="min-w-0 flex-1 space-y-2">
 <div className="h-3 w-2/5 rounded bg-muted/70 motion-safe:animate-pulse" />
 <div className="h-2.5 w-3/5 rounded bg-muted/45 motion-safe:animate-pulse" />
 </div>
 </div>
 ))}
 </div>
 )}

 {hasQuery && totalItems === 0 && !loading && (
 <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
 <Search className="h-5 w-5 text-muted-foreground/40" />
 <p className="max-w-72 text-sm text-muted-foreground">
 No results for{""}
 <span className="font-medium text-foreground">
"{query.trim()}"
 </span>
 </p>
 <div className="mt-2 flex flex-wrap justify-center gap-2">
 {onNewProject && <Button size="sm" variant="outline" onClick={() => { onNewProject(); onOpenChange(false); }}>New assessment</Button>}
 {onNewSession && <Button size="sm" variant="outline" onClick={() => { onNewSession(); onOpenChange(false); }}>Plan session</Button>}
 {onNewEvent && <Button size="sm" onClick={() => { onNewEvent(); onOpenChange(false); }}>New event</Button>}
 </div>
 </div>
 )}

 <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5 text-micro text-muted-foreground">
 <div className="hidden items-center gap-3 sm:flex">
 <span className="flex items-center gap-1.5">
 <kbd className={kbdClass}>{modKeyLabel} K</kbd>
 <span className="text-muted-foreground">toggle</span>
 </span>
 <span className="flex items-center gap-1.5">
 <kbd className={kbdClass}>↑↓</kbd>
 <span className="text-muted-foreground">navigate</span>
 </span>
 <span className="flex items-center gap-1.5">
 <kbd className={kbdClass}>↵</kbd>
 <span className="text-muted-foreground">open</span>
 </span>
 </div>
 <span
 className={cn("ml-auto flex items-center gap-1.5", fileSearchFailed &&"text-destructive")}
 >
 {loading && hasVisibleResults ? (
"Searching files"
 ) : fileSearchFailed ? (
 <Button
 variant="link"
 size="xs"
 className="h-auto p-0 text-destructive"
 onClick={() => void search(query, projects, sessions, events)}
 >
 Retry file search
 </Button>
 ) : (
 <>
 <kbd className={kbdClass}>Esc</kbd>
 <span className="text-muted-foreground">close</span>
 </>
 )}
 </span>
 </div>
 </DialogContent>
 </Dialog>
 );
}
