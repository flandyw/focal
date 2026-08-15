import { useState, useEffect, useCallback } from"react";
import { AnimatePresence, motion, useReducedMotion } from"framer-motion";
import {
 ArrowLeft,
 Palette as PaletteIcon,
 EyeOff,
 Cloud,
 Brain,
 Cog,
 FolderDown,
 UserCircle,
 Keyboard,
 Loader2,
 RefreshCw,
} from"lucide-react";
import { check } from"@tauri-apps/plugin-updater";
import { invoke } from"@tauri-apps/api/core";
import { toast } from"sonner";
import { Button } from"@/components/ui/button";
import { ScrollArea } from"@/components/ui/scroll-area";
import { cn } from"@/lib/utils";
import { confirmAction } from"@/lib/confirmToast";
import type { CalendarEvent, Project, Subject } from"@/lib/types";
import { AppearanceSection } from"@/components/settings/AppearanceSection";
import { SubjectsSection } from"@/components/settings/SubjectsSection";
import { AIModelSection } from"@/components/settings/AIModelSection";
import { NotionSection } from"@/components/settings/NotionSection";
import { AutoRenameSection } from"@/components/settings/AutoRenameSection";
import { DataSection } from"@/components/settings/DataSection";
import { AccountSection } from"@/components/settings/AccountSection";
import { VcaaExamImportSection } from"@/components/settings/VcaaExamImportSection";
import { retrySync } from"@/lib/sync/engine";
import type { SyncStatusSnapshot } from"@/lib/sync/types";
import { viewEnter } from"@/lib/motion";

type SettingsSection =
 |"account"
 |"appearance"
 |"subjects"
 |"notion"
 |"ai"
 |"auto-rename"
 |"data";

interface SettingsViewProps {
 onBack: () => void;
 mode:"light" |"dark" |"system";
 setMode: (mode:"light" |"dark" |"system") => void;
 seedColor: string;
 setSeedColor: (color: string) => void;
 zoom: number;
 onZoomChange: (zoom: number) => void;
 subjects: Subject[];
 hiddenSubjectIds: string[];
 onToggleSubjectVisibility: (subjectId: string) => void;
 onShowAllSubjects: () => void;
 events: CalendarEvent[];
 onImportVcaaEvents: (
 events: Omit<CalendarEvent,"id" |"created_at">[],
 ) => Promise<void>;
 onOpenExport?: () => void;
 onOpenSubjects?: () => void;
 onSyncNotionCalendar?: (onProgress: (msg: string) => void) => Promise<{
 created: unknown[];
 updated: unknown[];
 createdSessions?: unknown[];
 updatedSessions?: unknown[];
 skipped: number;
 skippedReasons?: string[];
 pushedCreated?: number;
 pushedUpdated?: number;
 deleted?: number;
 pushErrors?: string[];
 } | null>;
 lastSyncTime?: number;
 projects?: Project[];
 onFilesChanged?: () => void;
 supabaseConfigured: boolean;
 supabaseEmail?: string;
 supabaseLoading: boolean;
 supabaseError: string | null;
 supabaseSync: SyncStatusSnapshot;
 onSupabaseSignIn: (email: string, password: string) => Promise<unknown>;
 onSupabaseSignUp: (email: string, password: string) => Promise<unknown>;
 onSupabaseSignOut: () => Promise<void>;
 onForcePushAndMerge?: () => void;
 onForcePushAndOverwrite?: () => void;
 onPullNow?: () => void;
 onPushNow?: () => void;
 onClearFailedItems?: () => void;
 onRetryFailedItem?: (table: string, rowId: string) => void;
 onDropFailedItem?: (table: string, rowId: string) => void;
 onAcceptRemote?: (table: string, rowId: string) => void;
 onKeepLocal?: (table: string, rowId: string) => void;
 onDismissConflict?: (table: string, rowId: string) => void;
 onClearConflicts?: () => void;
 onProjectsRootChanged?: () => void;
 onScanAndImportProjects?: () => Promise<{ created: string[]; skipped: string[]; failed: string[] }>;
 onLinkFolderAsProject?: (folderPath: string, isLinked?: boolean) => Promise<unknown>;
}

const SECTION_ITEMS: {
 id: SettingsSection;
 label: string;
 description: string;
 icon: typeof PaletteIcon;
 shortcut: string;
}[] = [
 {
 id:"account",
 label:"Account",
 description:"Sign in and sync.",
 icon: UserCircle,
 shortcut:"1",
 },
 {
 id:"appearance",
 label:"Appearance",
 description:"Theme and mode.",
 icon: PaletteIcon,
 shortcut:"2",
 },
 {
 id:"subjects",
 label:"Subjects",
 description:"Show or hide subjects.",
 icon: EyeOff,
 shortcut:"3",
 },
 {
 id:"notion",
 label:"Notion Sync",
 description:"Pull from a Notion database.",
 icon: Cloud,
 shortcut:"4",
 },
 {
 id:"ai",
 label:"AI Model",
 description:"API key and model.",
 icon: Brain,
 shortcut:"5",
 },
 {
 id:"auto-rename",
 label:"Auto Rename",
 description:"Tidy up filenames.",
 icon: Cog,
 shortcut:"6",
 },
 {
 id:"data",
 label:"Data",
 description:"Import, export, subjects.",
 icon: FolderDown,
 shortcut:"7",
 },
];

const SETTINGS_SECTION_KEY = "focal-settings-section";

function readSettingsSection(): SettingsSection {
 try {
 const saved = localStorage.getItem(SETTINGS_SECTION_KEY);
 const match = SECTION_ITEMS.find((item) => item.id === saved);
 return match?.id ??"account";
 } catch {
 return"account";
 }
}

export function SettingsView({
 onBack,
 mode,
 setMode,
 seedColor,
 setSeedColor,
 zoom,
 onZoomChange,
 subjects,
 hiddenSubjectIds,
 onToggleSubjectVisibility,
 onShowAllSubjects,
 events,
 onImportVcaaEvents,
 onOpenExport,
 onOpenSubjects,
 onSyncNotionCalendar,
 lastSyncTime,
 projects,
 onFilesChanged,
 supabaseConfigured,
 supabaseEmail,
 supabaseLoading,
 supabaseError,
 supabaseSync,
 onSupabaseSignIn,
 onSupabaseSignUp,
 onSupabaseSignOut,
 onForcePushAndMerge,
 onForcePushAndOverwrite,
 onPullNow,
 onPushNow,
 onClearFailedItems,
 onRetryFailedItem,
 onDropFailedItem,
 onAcceptRemote,
 onKeepLocal,
 onDismissConflict,
 onClearConflicts,
 onProjectsRootChanged,
 onScanAndImportProjects,
 onLinkFolderAsProject,
}: SettingsViewProps) {
 const [activeSection, setActiveSection] =
 useState<SettingsSection>(readSettingsSection);
 const [checkingUpdate, setCheckingUpdate] = useState(false);
 const [installingUpdate, setInstallingUpdate] = useState(false);
 const reduceMotion = useReducedMotion();
 const activeIndex = SECTION_ITEMS.findIndex(
 (item) => item.id === activeSection,
 );

 const handleCheckForUpdates = useCallback(async () => {
 if (checkingUpdate || installingUpdate) return;
 setCheckingUpdate(true);
 try {
 const update = await check();
 if (!update) {
 toast.success("Focal is up to date");
 return;
 }

 const install = await confirmAction({
 title: `Focal ${update.version} is available`,
 description: update.body ??"Download and install this update now?",
 actionLabel:"Install",
 cancelLabel:"Later",
 duration: 15000,
 });
 if (!install) return;

 setInstallingUpdate(true);
 await invoke("stop_chatgpt_sidecar");
 let downloaded = 0;
 let contentLength = 0;
 const toastId = toast.loading("Downloading update...");

 await update.downloadAndInstall((event) => {
 if (event.event ==="Started") {
 downloaded = 0;
 contentLength = event.data.contentLength ?? 0;
 }
 if (event.event ==="Progress") {
 downloaded += event.data.chunkLength;
 const progress = contentLength
 ? ` ${Math.round((downloaded / contentLength) * 100)}%`
 :"";
 toast.loading(`Downloading update${progress}...`, { id: toastId });
 }
 if (event.event ==="Finished") {
 toast.loading("Installing update...", { id: toastId });
 }
 });

 toast.success("Update installed. Restart Focal to finish.", { id: toastId });
 } catch (error) {
 toast.error(`Update check failed: ${String(error)}`);
 } finally {
 setCheckingUpdate(false);
 setInstallingUpdate(false);
 }
 }, [checkingUpdate, installingUpdate]);

 const goToSection = useCallback((next: SettingsSection) => {
 setActiveSection(next);
 try {
 localStorage.setItem(SETTINGS_SECTION_KEY, next);
 } catch {
 // ponytail: storage is optional; in-memory navigation still works.
 }
 }, []);

 // Keyboard navigation: 1-7 for direct jump, ArrowUp/ArrowDown or j/k to step
 useEffect(() => {
 const handler = (event: KeyboardEvent) => {
 const target = event.target as HTMLElement | null;
 const tag = target?.tagName;
 if (tag ==="INPUT" || tag ==="TEXTAREA" || target?.isContentEditable)
 return;
 if (event.metaKey || event.ctrlKey || event.altKey) return;

 const digit = Number.parseInt(event.key, 10);
 if (!Number.isNaN(digit) && digit >= 1 && digit <= SECTION_ITEMS.length) {
 const nextSection = SECTION_ITEMS[digit - 1];
 if (nextSection) {
 event.preventDefault();
 goToSection(nextSection.id);
 return;
 }
 }

 if (event.key ==="ArrowDown" || event.key ==="j") {
 event.preventDefault();
 const next = SECTION_ITEMS[(activeIndex + 1) % SECTION_ITEMS.length];
 if (next) goToSection(next.id);
 } else if (event.key ==="ArrowUp" || event.key ==="k") {
 event.preventDefault();
 const next =
 SECTION_ITEMS[
 (activeIndex - 1 + SECTION_ITEMS.length) % SECTION_ITEMS.length
 ];
 if (next) goToSection(next.id);
 } else if (event.key ==="Home") {
 const first = SECTION_ITEMS[0];
 if (first) {
 event.preventDefault();
 goToSection(first.id);
 }
 } else if (event.key ==="End") {
 const last = SECTION_ITEMS[SECTION_ITEMS.length - 1];
 if (last) {
 event.preventDefault();
 goToSection(last.id);
 }
 }
 };
 window.addEventListener("keydown", handler);
 return () => window.removeEventListener("keydown", handler);
 }, [activeIndex, goToSection]);

 const activeItem = SECTION_ITEMS[activeIndex];

 return (
 <motion.div
 className="flex h-full flex-col"
 initial={reduceMotion ? false : { opacity: 0 }}
 animate={{ opacity: 1 }}
 transition={
 reduceMotion
 ? { duration: 0 }
 : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }
 }
 >
 <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3 min-[1200px]:px-6">
 <Button
 variant="ghost"
 size="icon-sm"
 onClick={onBack}
 aria-label="Back"
 >
 <ArrowLeft className="h-4 w-4" />
 </Button>
 <div className="min-w-0 flex-1">
 <h1 className="text-lg font-semibold leading-none">
 Settings
 </h1>
 <p className="mt-1 truncate text-caption text-muted-foreground">
 {activeItem?.description ??"Local preferences and integrations."}
 </p>
 </div>
 <div className="hidden shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-caption text-muted-foreground/70 sm:inline-flex">
 <Keyboard className="h-3 w-3" />
 <span>Press</span>
 <kbd className="rounded border border-border/60 bg-background/60 px-1 font-mono text-[10px] text-foreground/80">
 1
 </kbd>
 <span>–</span>
 <kbd className="rounded border border-border/60 bg-background/60 px-1 font-mono text-[10px] text-foreground/80">
 7
 </kbd>
 <span>to jump</span>
 </div>
 <span className="shrink-0 rounded-md border border-border/60 bg-background/40 px-2 py-0.5 font-mono text-caption text-muted-foreground/70 select-none">
 {__APP_VERSION__}
 </span>
 <Button
 type="button"
 variant="outline"
 size="sm"
 onClick={() => void handleCheckForUpdates()}
 disabled={checkingUpdate || installingUpdate}
 aria-busy={checkingUpdate || installingUpdate}
 aria-label={installingUpdate ? "Installing update" : checkingUpdate ? "Checking for updates" : "Check for updates"}
 className="gap-1.5"
 >
 {checkingUpdate || installingUpdate ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
 ) : (
 <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
 )}
 <span className="max-[520px]:hidden">
 {installingUpdate ?"Installing" : checkingUpdate ?"Checking" :"Update"}
 </span>
 </Button>
 </div>

 <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
 <nav aria-label="Settings sections" className="flex w-full shrink-0 flex-col border-b border-border/70 py-2 sm:w-56 sm:border-b-0 sm:border-r sm:py-3 min-[1200px]:w-60">
 <div className="flex gap-1 overflow-x-auto px-2 sm:flex-1 sm:flex-col sm:space-y-0.5 sm:overflow-visible">
 {SECTION_ITEMS.map((item) => {
 const Icon = item.icon;
 const isActive = activeSection === item.id;
 return (
 <Button
 key={item.id}
 onClick={() => goToSection(item.id)}
 variant={isActive ? "secondary" : "ghost"}
 className="group/nav min-w-max shrink-0 justify-start gap-2.5 sm:w-full sm:min-w-0"
 aria-current={isActive ? "page" : undefined}
 >
 <Icon />
 <span className="min-w-0 flex-1 truncate text-left">
 {item.label}
 </span>
 <kbd
 aria-hidden="true"
 className={cn(
"hidden shrink-0 rounded border border-border/50 bg-background/35 px-1 font-mono text-[10px] leading-relaxed transition-opacity min-[1200px]:inline-block",
 isActive
 ?"opacity-60"
 :"opacity-0 group-hover/nav:opacity-50",
 )}
 >
 {item.shortcut}
 </kbd>
 </Button>
 );
 })}
 </div>
 </nav>

 <ScrollArea className="min-h-0 flex-1 overflow-hidden">
 <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7 min-[1200px]:px-8">
 <AnimatePresence mode="wait">
 <motion.div
 key={activeSection}
 variants={viewEnter}
 initial={reduceMotion ? false :"initial"}
 animate="animate"
 exit={reduceMotion ? undefined :"exit"}
 >
 {activeSection ==="appearance" && (
 <AppearanceSection
 mode={mode}
 setMode={setMode}
 seedColor={seedColor}
 setSeedColor={setSeedColor}
 zoom={zoom}
 onZoomChange={onZoomChange}
 />
 )}

 {activeSection ==="account" && (
 <AccountSection
 configured={supabaseConfigured}
 email={supabaseEmail}
 loading={supabaseLoading}
 error={supabaseError}
 sync={supabaseSync}
 onSignIn={onSupabaseSignIn}
 onSignUp={onSupabaseSignUp}
 onSignOut={onSupabaseSignOut}
 onRetrySync={() => void retrySync()}
 onPullNow={onPullNow}
 onPushNow={onPushNow}
 onClearFailedItems={onClearFailedItems}
 onRetryFailedItem={onRetryFailedItem}
 onDropFailedItem={onDropFailedItem}
 onForcePushAndMerge={onForcePushAndMerge}
 onForcePushAndOverwrite={onForcePushAndOverwrite}
 onAcceptRemote={onAcceptRemote}
 onKeepLocal={onKeepLocal}
 onDismissConflict={onDismissConflict}
 onClearConflicts={onClearConflicts}
 />
 )}

 {activeSection ==="subjects" && (
 <div className="space-y-4">
 <SubjectsSection
 subjects={subjects}
 hiddenSubjectIds={hiddenSubjectIds}
 onToggleSubjectVisibility={onToggleSubjectVisibility}
 onShowAllSubjects={onShowAllSubjects}
 onOpenSubjects={onOpenSubjects}
 />
 <VcaaExamImportSection
 subjects={subjects}
 hiddenSubjectIds={hiddenSubjectIds}
 events={events}
 onImport={onImportVcaaEvents}
 />
 </div>
 )}

 {activeSection ==="ai" && <AIModelSection />}

 {activeSection ==="notion" && (
 <NotionSection
 onSyncNotionCalendar={onSyncNotionCalendar}
 lastSyncTime={lastSyncTime}
 />
 )}

 {activeSection ==="auto-rename" && (
 <AutoRenameSection
 projects={projects ?? []}
 onFilesChanged={onFilesChanged}
 />
 )}

 {activeSection ==="data" && (
 <DataSection
 onOpenExport={onOpenExport}
 onProjectsRootChanged={onProjectsRootChanged}
 onScanAndImportProjects={onScanAndImportProjects}
 onLinkFolderAsProject={onLinkFolderAsProject}
 />
 )}
 </motion.div>
 </AnimatePresence>
 </div>
 </ScrollArea>
 </div>
 </motion.div>
 );
}

export type { SettingsSection };
