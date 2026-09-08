import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { downloadDir, join } from "@tauri-apps/api/path"
import { readDir, stat } from "@tauri-apps/plugin-fs"
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns"
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Download,
  FolderInput,
  Inbox,
  Info,
  Loader2,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { FileTypeIcon } from "@/components/FileTypeIcon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  filterRecentDownloads,
  getInboxProjectSuggestion,
  type AcademicInboxItem,
  recentDownloadFingerprint,
  selectRecentDownloads,
  suggestInboxProject,
} from "@/lib/academicInbox"
import { isMacOS } from "@/lib/platform"
import { setCachedPreference } from "@/lib/storage/preferences"
import type { Project, Subject } from "@/lib/types"
import { showUndoToast } from "@/lib/undoToast"
import { formatFileSize, generateId } from "@/lib/utils"

const STORAGE_KEY = "focal-academic-inbox"
const DRAFT_KEY = "focal-academic-inbox-draft"
const HANDLED_DOWNLOADS_KEY = "focal-academic-inbox-handled-downloads"
const NOTE_TITLE_LIMIT = 80
const NOTE_CONTENT_LIMIT = 5_000
const RECENT_DOWNLOAD_LIMIT = 8
const HANDLED_DOWNLOAD_LIMIT = 200

export interface RecentDownload {
  name: string
  path: string
  size: number
  modifiedAt: number
}

function readDraft(): { title: string; content: string } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}")
    if (!value || typeof value !== "object") return { title: "", content: "" }
    const record = value as Record<string, unknown>
    return {
      title: typeof record.title === "string" ? record.title.slice(0, NOTE_TITLE_LIMIT) : "",
      content: typeof record.content === "string" ? record.content.slice(0, NOTE_CONTENT_LIMIT) : "",
    }
  } catch {
    return { title: "", content: "" }
  }
}

function readInbox(): AcademicInboxItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    if (!Array.isArray(value)) return []
    return value.flatMap((item): AcademicInboxItem[] => {
      if (typeof item !== "object" || item === null) return []
      const record = item as Record<string, unknown>
      if (typeof record.id !== "string" || record.kind !== "note" || typeof record.name !== "string" || typeof record.content !== "string") return []
      return [{
        id: record.id,
        kind: "note",
        name: record.name,
        content: record.content,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
        suggestedProjectId: typeof record.suggestedProjectId === "string" ? record.suggestedProjectId : undefined,
      }]
    })
  } catch {
    return []
  }
}

function readHandledDownloads(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HANDLED_DOWNLOADS_KEY) ?? "[]")
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(-HANDLED_DOWNLOAD_LIMIT) : [])
  } catch {
    return new Set()
  }
}

function persistHandledDownloads(handled: Set<string>) {
  try {
    localStorage.setItem(HANDLED_DOWNLOADS_KEY, JSON.stringify([...handled].slice(-HANDLED_DOWNLOAD_LIMIT)))
  } catch {
    // Hiding handled downloads is an enhancement; a failed preference write must not block copying.
  }
}

async function readRecentDownloads(): Promise<RecentDownload[]> {
  const directory = await downloadDir()
  const entries = await readDir(directory)
  let metadataError: string | undefined

  // ponytail: a shallow O(n) metadata scan covers normal Downloads folders.
  // Move to a filesystem index/watcher if very large folders become common.
  const files = await Promise.all(entries.filter((entry) => entry.isFile).map(async (entry): Promise<RecentDownload | null> => {
    try {
      const path = await join(directory, entry.name)
      const info = await stat(path)
      const timestamp = info.mtime?.getTime() ?? info.birthtime?.getTime() ?? 0
      return { name: entry.name, path, size: info.size, modifiedAt: Number.isFinite(timestamp) ? timestamp : 0 }
    } catch (error) {
      metadataError = error instanceof Error ? error.message : String(error)
      return null
    }
  }))

  if (metadataError && files.every((file) => file === null)) throw new Error(`Could not read download metadata: ${metadataError}`)

  return selectRecentDownloads(files.filter((file): file is RecentDownload => file !== null), 64)
}

interface AcademicInboxViewProps {
  projects: Project[]
  subjects: Subject[]
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<void> | void
  onFilesChanged: (projectId: string) => Promise<void> | void
  loadRecentDownloads?: () => Promise<RecentDownload[]>
  copyDownloadToProject?: (download: RecentDownload, project: Project) => Promise<void>
}

export function AcademicInboxView({ projects, subjects, onUpdateProject, onFilesChanged, loadRecentDownloads, copyDownloadToProject }: AcademicInboxViewProps) {
  const [notes, setNotes] = useState<AcademicInboxItem[]>(readInbox)
  const [recentDownloads, setRecentDownloads] = useState<RecentDownload[]>([])
  const [handledDownloads, setHandledDownloads] = useState(readHandledDownloads)
  const [downloadsLoading, setDownloadsLoading] = useState(true)
  const [downloadsError, setDownloadsError] = useState<string | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [selectedDownloadPath, setSelectedDownloadPath] = useState<string | null>(null)
  const [projectOverrides, setProjectOverrides] = useState<Record<string, string>>({})
  const initialDraft = useMemo(readDraft, [])
  const [noteTitle, setNoteTitle] = useState(initialDraft.title)
  const [noteContent, setNoteContent] = useState(initialDraft.content)
  const [noteComposerOpen, setNoteComposerOpen] = useState(false)
  const [savedNotesOpen, setSavedNotesOpen] = useState(false)
  const [downloadQuery, setDownloadQuery] = useState("")
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const downloadsRequestRef = useRef(0)
  const assignmentInFlight = useRef(false)

  const activeProjects = useMemo(() => projects.filter((project) => !project.isArchived && !project.isFinished).sort((a, b) => a.name.localeCompare(b.name)), [projects])
  const queueDownloads = useMemo(() => selectRecentDownloads(recentDownloads.filter((download) => !handledDownloads.has(recentDownloadFingerprint(download))), RECENT_DOWNLOAD_LIMIT), [handledDownloads, recentDownloads])
  const visibleDownloads = useMemo(() => filterRecentDownloads(queueDownloads, downloadQuery), [downloadQuery, queueDownloads])
  const groupedDownloads = useMemo(() => {
    const groups = new Map<string, RecentDownload[]>()
    for (const download of visibleDownloads) {
      const modified = new Date(download.modifiedAt)
      const label = Date.now() - download.modifiedAt < 10 * 60_000 ? "Just now" : isToday(modified) ? "Earlier today" : isYesterday(modified) ? "Yesterday" : "Older"
      groups.set(label, [...(groups.get(label) ?? []), download])
    }
    return [...groups.entries()]
  }, [visibleDownloads])
  const selectedDownload = visibleDownloads.find((download) => download.path === selectedDownloadPath) ?? visibleDownloads[0]
  const suggestion = useMemo(() => selectedDownload ? getInboxProjectSuggestion(selectedDownload.name, activeProjects, subjects) : undefined, [activeProjects, selectedDownload, subjects])
  const targetProjectId = selectedDownload ? projectOverrides[recentDownloadFingerprint(selectedDownload)] ?? suggestion?.projectId : undefined
  const targetProject = activeProjects.find((project) => project.id === targetProjectId)
  const targetSubject = subjects.find((subject) => subject.id === targetProject?.subjectId)
  const alternativeProjects = useMemo(() => {
    const targetSubjectId = targetProject?.subjectId
    const deadline = (project: Project) => {
      const timestamp = project.deadline ? new Date(project.deadline).getTime() : Number.POSITIVE_INFINITY
      return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY
    }
    return activeProjects.filter((project) => project.id !== targetProject?.id).sort((a, b) => Number(b.subjectId === targetSubjectId) - Number(a.subjectId === targetSubjectId) || deadline(a) - deadline(b) || a.name.localeCompare(b.name)).slice(0, 2)
  }, [activeProjects, targetProject])

  useEffect(() => setCachedPreference(STORAGE_KEY, JSON.stringify(notes), false), [notes])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (noteTitle || noteContent) localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: noteTitle, content: noteContent }))
        else localStorage.removeItem(DRAFT_KEY)
      } catch {
        // Draft persistence is optional; the in-memory form still works.
      }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [noteContent, noteTitle])
  useEffect(() => {
    if (!visibleDownloads.some((download) => download.path === selectedDownloadPath)) setSelectedDownloadPath(visibleDownloads[0]?.path ?? null)
  }, [selectedDownloadPath, visibleDownloads])

  const refreshDownloads = useCallback(async () => {
    const requestId = ++downloadsRequestRef.current
    setDownloadsLoading(true)
    try {
      const downloads = await (loadRecentDownloads ?? readRecentDownloads)()
      if (!mountedRef.current || requestId !== downloadsRequestRef.current) return
      setRecentDownloads(downloads)
      setDownloadsError(null)
      setLastRefreshedAt(Date.now())
    } catch (error) {
      if (!mountedRef.current || requestId !== downloadsRequestRef.current) return
      setDownloadsError(error instanceof Error ? error.message : String(error))
    } finally {
      if (mountedRef.current && requestId === downloadsRequestRef.current) setDownloadsLoading(false)
    }
  }, [loadRecentDownloads])

  useEffect(() => {
    mountedRef.current = true
    const handleFocus = () => void refreshDownloads()
    void refreshDownloads()
    window.addEventListener("focus", handleFocus)
    return () => {
      mountedRef.current = false
      downloadsRequestRef.current += 1
      window.removeEventListener("focus", handleFocus)
    }
  }, [refreshDownloads])

  const addNote = () => {
    if (!noteTitle.trim() || !noteContent.trim()) return
    setNotes((current) => [...current, { id: generateId(), kind: "note", name: noteTitle.trim(), content: noteContent.trim(), createdAt: new Date().toISOString() }])
    setNoteTitle("")
    setNoteContent("")
    setNoteComposerOpen(false)
    setSavedNotesOpen(true)
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* The cleared form is still reflected in memory. */ }
    toast.success("Teacher note saved")
  }

  const removeNote = (note: AcademicInboxItem) => {
    setNotes((current) => current.filter((candidate) => candidate.id !== note.id))
    showUndoToast({ message: `“${note.name}” removed`, onUndo: () => setNotes((current) => current.some((candidate) => candidate.id === note.id) ? current : [...current, note]) })
  }

  const chooseProject = (download: RecentDownload, projectId: string) => setProjectOverrides((current) => ({ ...current, [recentDownloadFingerprint(download)]: projectId }))
  const markDownloadHandled = (download: RecentDownload) => {
    setHandledDownloads((current) => {
      const next = new Set(current)
      next.add(recentDownloadFingerprint(download))
      persistHandledDownloads(next)
      return next
    })
  }

  const addDownload = async (download: RecentDownload, projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project || assignmentInFlight.current) return
    assignmentInFlight.current = true
    setAssigningId(`download:${download.path}`)
    try {
      if (copyDownloadToProject) await copyDownloadToProject(download, project)
      else {
        const paths = await invoke<string[]>("move_files_to_project", { files: [download.path], projectName: project.folder_path, copy: true })
        if (paths.length !== 1) throw new Error("The file copy was not confirmed. Please try again.")
      }
      markDownloadHandled(download)
      await Promise.resolve().then(() => onFilesChanged(project.id)).catch(() => {
        toast.warning("File copied, but the assessment file list could not refresh. Reopen the assessment to see it.")
      })
      toast.success(`${download.name} added to ${project.name}`)
    } catch (error) {
      toast.error(`Could not add file: ${String(error)}`)
    } finally {
      assignmentInFlight.current = false
      setAssigningId(null)
    }
  }

  const attachNote = async (note: AcademicInboxItem, projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project || !note.content) return
    setAssigningId(`note:${note.id}`)
    try {
      const prefix = project.notes?.trim() ? `${project.notes.trim()}\n\n` : ""
      await onUpdateProject(project.id, { notes: `${prefix}${note.name}\n${note.content}` })
      setNotes((current) => current.filter((candidate) => candidate.id !== note.id))
      toast.success(`Note attached to ${project.name}`)
    } catch (error) {
      toast.error(`Could not attach note: ${String(error)}`)
    } finally {
      setAssigningId(null)
    }
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="flex min-h-full flex-col">
        <header className="flex flex-wrap items-start justify-between gap-4 px-5 py-6 sm:px-7 sm:py-7">
          <div>
            <p className="text-micro font-semibold tracking-[0.16em] text-primary uppercase">Study library</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Academic inbox</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sort recent downloads and notes into their assessment homes.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setNoteComposerOpen((open) => !open)} aria-expanded={noteComposerOpen}><Plus /> Capture teacher note {noteComposerOpen ? <ChevronUp /> : <ChevronDown />}</Button>
            <span className="flex items-center gap-2 px-2 text-xs text-muted-foreground" role="status"><CircleCheck className="size-4" />{lastRefreshedAt ? `Checked ${formatDistanceToNow(lastRefreshedAt, { addSuffix: true })}` : "Checking Downloads…"}</span>
          </div>
        </header>

        {noteComposerOpen && (
          <section className="border-y bg-muted/20 px-5 py-4 sm:px-7" aria-label="Capture teacher note">
            <div className="grid gap-3 lg:grid-cols-[minmax(12rem,0.65fr)_minmax(20rem,1.35fr)_auto] lg:items-end">
              <label className="grid gap-1.5 text-xs font-medium" htmlFor="teacher-note-title"><span className="flex items-center justify-between gap-2">Title <span className="font-normal tabular-nums text-muted-foreground">{noteTitle.length}/{NOTE_TITLE_LIMIT}</span></span><Input id="teacher-note-title" value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="e.g. Essay feedback" maxLength={NOTE_TITLE_LIMIT} /></label>
              <label className="grid gap-1.5 text-xs font-medium" htmlFor="teacher-note-content"><span className="flex items-center justify-between gap-2">Note <span className="font-normal tabular-nums text-muted-foreground">{noteContent.length}/{NOTE_CONTENT_LIMIT}</span></span><Textarea id="teacher-note-content" className="min-h-20 resize-none" value={noteContent} onChange={(event) => setNoteContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); addNote() } }} placeholder="Capture instructions, reminders or feedback" maxLength={NOTE_CONTENT_LIMIT} /></label>
              <div className="flex gap-2 lg:flex-col"><Button className="flex-1" disabled={!noteTitle.trim() || !noteContent.trim()} onClick={addNote}><NotebookPen /> Save note</Button><Button variant="ghost" size="sm" className="flex-1" onClick={() => { setNoteTitle(""); setNoteContent("") }}>Clear</Button></div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Drafts are kept automatically · {isMacOS ? "⌘" : "Ctrl"}+Enter to save</p>
          </section>
        )}

        <div className="grid min-h-[42rem] flex-1 border-y lg:grid-cols-[minmax(22rem,0.95fr)_minmax(27rem,1.1fr)]">
          <section className="min-w-0 border-b lg:border-r lg:border-b-0" aria-labelledby="download-queue-heading">
            <div className="flex flex-col items-stretch justify-between gap-3 border-b px-5 py-4 sm:px-7 xl:flex-row xl:items-center">
              <div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Inbox className="size-4" /></span><h2 id="download-queue-heading" className="font-semibold">{queueDownloads.length} {queueDownloads.length === 1 ? "item" : "items"} to sort</h2></div>
              <div className="flex min-w-0 flex-1 justify-stretch gap-2 xl:justify-end">
                <div className="relative w-full xl:max-w-64"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input type="search" value={downloadQuery} onChange={(event) => setDownloadQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && downloadQuery) { event.preventDefault(); setDownloadQuery("") } }} placeholder="Search downloads…" aria-label="Search recent downloads" className="pl-9 pr-9" />{downloadQuery && <Button variant="ghost" size="icon-sm" className="absolute right-0.5 top-1/2 -translate-y-1/2" onClick={() => setDownloadQuery("")} aria-label="Clear download search"><X /></Button>}</div>
                <Button variant="outline" size="icon" onClick={() => void refreshDownloads()} disabled={downloadsLoading} aria-label="Refresh recent downloads" aria-busy={downloadsLoading}><RefreshCw className={downloadsLoading ? "animate-spin motion-reduce:animate-none" : undefined} /></Button>
              </div>
            </div>

            {downloadsError && <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive sm:mx-7" role="status"><Info className="mt-0.5 size-4 shrink-0" /><span>Downloads could not be read. Check folder access and refresh.<span className="sr-only"> {downloadsError}</span></span></div>}

            <div className="px-5 py-3 sm:px-7">
              {downloadsLoading && recentDownloads.length === 0 ? <div className="flex min-h-72 items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" aria-label="Loading recent downloads" /></div> : visibleDownloads.length === 0 ? (
                <div className="flex min-h-72 flex-col items-center justify-center text-center"><span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><CheckCircle2 className="size-6" /></span><p className="mt-3 font-medium">{downloadsError ? "Downloads unavailable" : downloadQuery ? "No matching downloads" : "Inbox empty"}</p><p className="mt-1 max-w-xs text-sm text-muted-foreground">{downloadsError ? "Refresh to try again once folder access is available." : downloadQuery ? "Try a different filename." : "You’re all caught up. New downloads will appear here."}</p>{downloadQuery && <Button variant="ghost" size="sm" className="mt-2" onClick={() => setDownloadQuery("")}>Clear search</Button>}</div>
              ) : groupedDownloads.map(([label, downloads]) => <div key={label} className="mb-2 last:mb-0"><p className="border-b py-2 text-xs font-semibold text-muted-foreground">{label}</p>{downloads.map((download) => <DownloadQueueRow key={download.path} download={download} selected={download.path === selectedDownload?.path} onSelect={() => setSelectedDownloadPath(download.path)} />)}</div>)}
            </div>
          </section>

          <section className="min-w-0 px-5 py-6 sm:px-7 sm:py-7" aria-label="Selected download details">
            {!selectedDownload ? <div className="flex min-h-96 flex-col items-center justify-center text-center"><Download className="size-7 text-muted-foreground" /><p className="mt-3 font-medium">Select a download to file it</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">Focal will suggest an active assessment based on the filename and subject.</p></div> : (
              <div className="mx-auto grid max-w-2xl gap-5">
                <div className="flex min-w-0 items-center gap-4 border-b pb-5"><FileTypeIcon extension={fileExtension(selectedDownload.name)} className="size-14 rounded-xl" iconClassName="size-6" /><div className="min-w-0"><h2 className="truncate text-lg font-semibold" title={selectedDownload.name}>{selectedDownload.name}</h2><p className="mt-1 text-sm text-muted-foreground">{fileExtension(selectedDownload.name).toUpperCase() || "FILE"} · {formatFileSize(selectedDownload.size)} · {formatDownloadTime(selectedDownload)}</p></div></div>
                <div>
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" /> {suggestion && targetProject?.id === suggestion.projectId ? "Suggested assessment" : "Assessment destination"}</p>
                  {targetProject ? <div className="overflow-hidden rounded-xl border bg-card"><div className="flex items-start gap-3 p-5"><SubjectMarker color={targetSubject?.color} /><div className="min-w-0 flex-1"><p className="font-semibold">{targetProject.name}</p><p className="mt-0.5 text-sm text-muted-foreground">{targetSubject?.name ?? "No subject"}{targetProject.deadlineType ? ` · ${targetProject.deadlineType.toUpperCase()}` : ""}</p>{targetProject.deadline && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" /> Due {format(new Date(targetProject.deadline), "d MMM yyyy")} ({formatDistanceToNow(new Date(targetProject.deadline), { addSuffix: true })})</p>}</div><Badge variant="success">Active</Badge></div><div className="flex items-start gap-2 border-t bg-muted/20 px-5 py-4 text-xs text-muted-foreground"><CircleCheck className="mt-0.5 size-3.5 shrink-0" /><span><strong className="text-foreground">Why this match?</strong> {suggestion && targetProject.id === suggestion.projectId ? suggestion.reason : "Selected by you"}.</span></div></div> : <div className="rounded-xl border border-dashed p-5 text-center"><p className="font-medium">No confident match</p><p className="mt-1 text-sm text-muted-foreground">Choose the assessment this file belongs to.</p></div>}
                </div>
                <div className="grid gap-2"><Button size="lg" disabled={!targetProject || assigningId === `download:${selectedDownload.path}`} onClick={() => targetProject && void addDownload(selectedDownload, targetProject.id)} aria-busy={assigningId === `download:${selectedDownload.path}`}>{assigningId === `download:${selectedDownload.path}` ? <Loader2 className="animate-spin" /> : <FolderInput />}{targetProject ? `Add to ${targetProject.name}` : "Choose an assessment"}</Button><ProjectPicker projects={activeProjects} subjects={subjects} label="Choose another assessment" onSelect={(projectId) => chooseProject(selectedDownload, projectId)} /></div>
                {alternativeProjects.length > 0 && <div><p className="mb-2 text-sm font-semibold">Other likely assessments</p><div className="overflow-hidden rounded-xl border bg-card">{alternativeProjects.map((project) => { const subject = subjects.find((candidate) => candidate.id === project.subjectId); return <button key={project.id} type="button" className="flex w-full items-center gap-3 border-b px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => chooseProject(selectedDownload, project.id)}><SubjectMarker color={subject?.color} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{project.name}</span><span className="block truncate text-xs text-muted-foreground">{subject?.name ?? "No subject"}</span></span>{project.deadline && <span className="shrink-0 text-xs text-muted-foreground">Due {format(new Date(project.deadline), "d MMM")}</span>}</button> })}</div></div>}
                <div className="overflow-hidden rounded-xl border bg-card"><button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => setSavedNotesOpen((open) => !open)} aria-expanded={savedNotesOpen}><CircleCheck className="size-4 text-muted-foreground" /> {notes.length} saved teacher {notes.length === 1 ? "note" : "notes"}{savedNotesOpen ? <ChevronUp className="ml-auto size-4" /> : <ChevronDown className="ml-auto size-4" />}</button>{savedNotesOpen && <div className="border-t">{notes.length === 0 ? <p className="px-4 py-5 text-center text-sm text-muted-foreground">Captured notes will wait here until you attach them.</p> : [...notes].reverse().map((note) => <NoteRow key={note.id} note={note} projects={activeProjects} suggestedProjectId={suggestInboxProject(`${note.name} ${note.content ?? ""}`, activeProjects, subjects)} assigning={assigningId === `note:${note.id}`} onAttach={attachNote} onRemove={() => removeNote(note)} />)}</div>}</div>
              </div>
            )}
          </section>
          <footer className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground lg:col-span-2 sm:px-7"><Info className="size-4 shrink-0" /> This file will be copied to your assessment materials. The original stays in Downloads.</footer>
        </div>
      </div>
    </div>
  )
}

function fileExtension(name: string) { return name.includes(".") ? name.split(".").pop() ?? "" : "" }
function formatDownloadTime(download: RecentDownload) { return download.modifiedAt <= 0 ? "Download time unavailable" : `Downloaded ${formatDistanceToNow(download.modifiedAt, { addSuffix: true })}` }

function DownloadQueueRow({ download, selected, onSelect }: { download: RecentDownload; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={`my-1 flex w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary/35 bg-primary/8" : "border-transparent hover:bg-muted/45"}`} onClick={onSelect} aria-pressed={selected}><FileTypeIcon extension={fileExtension(download.name)} className="size-11 rounded-xl" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={download.name}>{download.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{fileExtension(download.name).toUpperCase() || "FILE"} · {formatFileSize(download.size)}</span></span><span className="shrink-0 text-xs text-muted-foreground">{download.modifiedAt > 0 ? formatDistanceToNow(download.modifiedAt, { addSuffix: true }) : "—"}</span></button>
}

function SubjectMarker({ color, size = "default" }: { color?: string; size?: "default" | "sm" }) {
  return <span className={`${size === "sm" ? "size-4 rounded" : "size-7 rounded-lg"} shrink-0 border border-black/10 shadow-xs`} style={{ backgroundColor: color ?? "var(--primary)" }} aria-hidden="true" />
}

function ProjectPicker({ projects, subjects, label, onSelect }: { projects: Project[]; subjects: Subject[]; label: string; onSelect: (projectId: string) => void }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="lg" disabled={projects.length === 0}>{label}<ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-72"><DropdownMenuLabel>Active assessments</DropdownMenuLabel>{projects.map((project) => { const subject = subjects.find((candidate) => candidate.id === project.subjectId); return <DropdownMenuItem key={project.id} onSelect={() => onSelect(project.id)}><SubjectMarker color={subject?.color} size="sm" /><span className="min-w-0"><span className="block truncate">{project.name}</span><span className="block truncate text-xs text-muted-foreground">{subject?.name ?? "No subject"}</span></span></DropdownMenuItem> })}</DropdownMenuContent></DropdownMenu>
}

function NoteRow({ note, projects, suggestedProjectId, assigning, onAttach, onRemove }: { note: AcademicInboxItem; projects: Project[]; suggestedProjectId?: string; assigning: boolean; onAttach: (note: AcademicInboxItem, projectId: string) => Promise<void>; onRemove: () => void }) {
  const orderedProjects = suggestedProjectId ? [...projects].sort((a, b) => Number(b.id === suggestedProjectId) - Number(a.id === suggestedProjectId)) : projects
  const createdAt = new Date(note.createdAt)
  const createdLabel = Number.isNaN(createdAt.getTime()) ? undefined : formatDistanceToNow(createdAt, { addSuffix: true })
  return <div className="flex min-w-0 items-center gap-3 border-b px-4 py-3 last:border-b-0"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><NotebookPen className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{note.name}</p><p className="mt-0.5 truncate text-xs text-muted-foreground" title={note.content}>{note.content}{createdLabel ? ` · ${createdLabel}` : ""}</p></div><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" disabled={assigning || projects.length === 0} aria-busy={assigning}>{assigning ? <Loader2 className="animate-spin" /> : <Plus />} Attach</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64"><DropdownMenuLabel>Attach to assessment</DropdownMenuLabel>{orderedProjects.map((project) => <DropdownMenuItem key={project.id} onSelect={() => void onAttach(note, project.id)}><FolderInput /><span className="truncate">{project.name}</span>{project.id === suggestedProjectId && <span className="ml-auto text-micro font-medium text-primary">Suggested</span>}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu><Button variant="ghost" size="icon-sm" aria-label={`Delete ${note.name}`} onClick={onRemove}><Trash2 /></Button></div>
}
