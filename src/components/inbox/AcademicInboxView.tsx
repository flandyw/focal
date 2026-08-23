import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { downloadDir, join } from "@tauri-apps/api/path"
import { readDir, stat } from "@tauri-apps/plugin-fs"
import { format, formatDistanceToNow } from "date-fns"
import { ChevronDown, Download, Inbox, Loader2, NotebookPen, Plus, RefreshCw, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { FileTypeIcon } from "@/components/FileTypeIcon"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import {
  filterRecentDownloads,
  type AcademicInboxItem,
  selectRecentDownloads,
  suggestInboxProject,
} from "@/lib/academicInbox"
import { setCachedPreference } from "@/lib/storage/preferences"
import { showUndoToast } from "@/lib/undoToast"
import { isMacOS } from "@/lib/platform"
import type { Project, Subject } from "@/lib/types"
import { formatFileSize, generateId } from "@/lib/utils"

const STORAGE_KEY = "focal-academic-inbox"
const DRAFT_KEY = "focal-academic-inbox-draft"
const NOTE_TITLE_LIMIT = 80
const NOTE_CONTENT_LIMIT = 5_000

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

interface RecentDownload {
  name: string
  path: string
  size: number
  modifiedAt: number
}

function readInbox(): AcademicInboxItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    if (!Array.isArray(value)) return []
    return value.flatMap((item): AcademicInboxItem[] => {
      if (typeof item !== "object" || item === null) return []
      const record = item as Record<string, unknown>
      if (typeof record.id !== "string" || (record.kind !== "file" && record.kind !== "note") || typeof record.name !== "string") return []
      if (record.kind === "file" && typeof record.path !== "string") return []
      if (record.kind === "note" && typeof record.content !== "string") return []
      return [{
        id: record.id,
        kind: record.kind,
        name: record.name,
        path: typeof record.path === "string" ? record.path : undefined,
        content: typeof record.content === "string" ? record.content : undefined,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
        suggestedProjectId: typeof record.suggestedProjectId === "string" ? record.suggestedProjectId : undefined,
      }]
    })
  } catch {
    return []
  }
}

async function readRecentDownloads(): Promise<RecentDownload[]> {
  const directory = await downloadDir()
  const entries = await readDir(directory)

  // ponytail: a shallow O(n) metadata scan covers normal Downloads folders.
  // Move to a filesystem index/watcher if very large folders become common.
  const files = await Promise.all(entries.filter((entry) => entry.isFile).map(async (entry): Promise<RecentDownload | null> => {
    try {
      const path = await join(directory, entry.name)
      const info = await stat(path)
      const timestamp = info.mtime?.getTime() ?? info.birthtime?.getTime() ?? 0
      return {
        name: entry.name,
        path,
        size: info.size,
        modifiedAt: Number.isFinite(timestamp) ? timestamp : 0,
      }
    } catch {
      return null
    }
  }))

  return selectRecentDownloads(files.filter((file): file is RecentDownload => file !== null))
}

export function AcademicInboxView({ projects, subjects, onUpdateProject, onFilesChanged }: {
  projects: Project[]
  subjects: Subject[]
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<void> | void
  onFilesChanged: (projectId: string) => Promise<void> | void
}) {
  const [notes, setNotes] = useState<AcademicInboxItem[]>(() => readInbox().filter((item) => item.kind === "note"))
  const [recentDownloads, setRecentDownloads] = useState<RecentDownload[]>([])
  const [downloadsLoading, setDownloadsLoading] = useState(true)
  const [downloadsError, setDownloadsError] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const initialDraft = useMemo(readDraft, [])
  const [noteTitle, setNoteTitle] = useState(initialDraft.title)
  const [noteContent, setNoteContent] = useState(initialDraft.content)
  const [downloadQuery, setDownloadQuery] = useState("")
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const activeProjects = useMemo(
    () => projects
      .filter((project) => !project.isArchived && !project.isFinished)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  )
  const visibleDownloads = useMemo(
    () => filterRecentDownloads(recentDownloads, downloadQuery),
    [downloadQuery, recentDownloads],
  )
  const mountedRef = useRef(true)
  const downloadsRequestRef = useRef(0)

  useEffect(() => setCachedPreference(STORAGE_KEY, JSON.stringify(notes), false), [notes])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (noteTitle || noteContent) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: noteTitle, content: noteContent }))
        } else {
          localStorage.removeItem(DRAFT_KEY)
        }
      } catch {
        // Draft persistence is optional; the in-memory form still works.
      }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [noteContent, noteTitle])

  const refreshDownloads = useCallback(async () => {
    const requestId = ++downloadsRequestRef.current
    setDownloadsLoading(true)
    try {
      const downloads = await readRecentDownloads()
      if (!mountedRef.current || requestId !== downloadsRequestRef.current) return
      setRecentDownloads(downloads)
      setDownloadsError(false)
      setLastRefreshedAt(Date.now())
    } catch {
      if (!mountedRef.current || requestId !== downloadsRequestRef.current) return
      setDownloadsError(true)
    } finally {
      if (mountedRef.current && requestId === downloadsRequestRef.current) setDownloadsLoading(false)
    }
  }, [])

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
    setNotes((current) => [...current, {
      id: generateId(),
      kind: "note",
      name: noteTitle.trim(),
      content: noteContent.trim(),
      createdAt: new Date().toISOString(),
    }])
    setNoteTitle("")
    setNoteContent("")
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      // The cleared form is still reflected in memory.
    }
    toast.success("Teacher note saved")
  }

  const clearDraft = () => {
    setNoteTitle("")
    setNoteContent("")
  }

  const removeNote = (note: AcademicInboxItem) => {
    setNotes((current) => current.filter((candidate) => candidate.id !== note.id))
    showUndoToast({
      message: `“${note.name}” removed`,
      onUndo: () => setNotes((current) => current.some((candidate) => candidate.id === note.id) ? current : [...current, note]),
    })
  }

  const addDownload = async (download: RecentDownload, projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project) return
    setAssigningId(`download:${download.path}`)
    try {
      await invoke("move_files_to_project", { files: [download.path], projectName: project.folder_path, copy: true })
      await onFilesChanged(project.id)
      toast.success(`${download.name} added to ${project.name}`)
    } catch (error) {
      toast.error(`Could not add file: ${String(error)}`)
    } finally {
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
    <ScrollArea className="h-full">
      <div className="mx-auto grid max-w-6xl gap-5 p-4 pb-10 min-[1200px]:p-6">
        <header className="border-b pb-5">
          <div className="flex items-center gap-2">
            <Inbox className="size-5 text-primary" />
            <h1 className="text-xl font-semibold">Academic inbox</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Send a recent download or teacher note straight to the project where it belongs.
          </p>
        </header>

        <Card size="sm" className="gap-0 py-0">
          <CardHeader className="border-b bg-muted/20 px-4 py-4">
            <CardTitle className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <NotebookPen className="size-3.5" />
              </span>
              Teacher note
            </CardTitle>
            <CardDescription>Save instructions or feedback now, then attach the note to a project.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
              <label className="grid content-start gap-1.5 text-xs font-medium" htmlFor="teacher-note-title">
                <span className="flex items-center justify-between gap-2">
                  Title
                  <span id="teacher-note-title-count" className="font-normal tabular-nums text-muted-foreground">{noteTitle.length}/{NOTE_TITLE_LIMIT}</span>
                </span>
                <Input
                  id="teacher-note-title"
                  value={noteTitle}
                  onChange={(event) => setNoteTitle(event.target.value)}
                  placeholder="e.g. Essay feedback"
                  maxLength={NOTE_TITLE_LIMIT}
                  aria-describedby="teacher-note-title-count"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium" htmlFor="teacher-note-content">
                <span className="flex items-center justify-between gap-2">
                  Note
                  <span id="teacher-note-content-count" className="font-normal tabular-nums text-muted-foreground">{noteContent.length}/{NOTE_CONTENT_LIMIT}</span>
                </span>
                <Textarea
                  id="teacher-note-content"
                  className="min-h-20 resize-none"
                  value={noteContent}
                  onChange={(event) => setNoteContent(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      addNote()
                    }
                  }}
                  placeholder="Paste the message or instructions"
                  maxLength={NOTE_CONTENT_LIMIT}
                  aria-describedby="teacher-note-content-count teacher-note-save-hint"
                />
              </label>
            </div>
            <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p id="teacher-note-save-hint" className="text-xs text-muted-foreground">Drafts are kept automatically · {isMacOS ? "⌘" : "Ctrl"}+Enter to save</p>
              <div className="flex gap-2">
                {(noteTitle || noteContent) && (
                  <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" onClick={clearDraft}>
                    Clear
                  </Button>
                )}
                <Button
                  size="sm"
                  className="flex-1 sm:flex-none"
                  disabled={!noteTitle.trim() || !noteContent.trim()}
                  onClick={addNote}
                >
                  <NotebookPen /> Save note
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {notes.length > 0 && (
          <section className="grid gap-2.5" aria-labelledby="saved-notes-heading">
            <div>
              <h2 id="saved-notes-heading" className="text-sm font-semibold">Saved notes · {notes.length}</h2>
              <p className="text-xs text-muted-foreground">Attach a note when you know which project needs it.</p>
            </div>
            <Card size="sm" className="gap-0 py-0">
              {[...notes].reverse().map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  projects={activeProjects}
                  suggestedProjectId={suggestInboxProject(`${note.name} ${note.content ?? ""}`, activeProjects, subjects)}
                  assigning={assigningId === `note:${note.id}`}
                  onAttach={attachNote}
                  onRemove={() => removeNote(note)}
                />
              ))}
            </Card>
          </section>
        )}

        <section className="grid gap-2.5" aria-labelledby="recent-downloads-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="recent-downloads-heading" className="flex items-center gap-2 text-sm font-semibold">
                <Download className="size-4 text-muted-foreground" /> Recent downloads · {recentDownloads.length}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The eight newest files in Downloads{lastRefreshedAt ? ` · checked ${formatDistanceToNow(lastRefreshedAt, { addSuffix: true })}` : ""}.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshDownloads()}
              disabled={downloadsLoading}
              aria-busy={downloadsLoading}
            >
              <RefreshCw className={downloadsLoading ? "animate-spin motion-reduce:animate-none" : undefined} />
              Refresh
            </Button>
          </div>
          {recentDownloads.length > 0 && (
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={downloadQuery}
                onChange={(event) => setDownloadQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && downloadQuery) {
                    event.preventDefault()
                    setDownloadQuery("")
                  }
                }}
                placeholder="Filter recent downloads"
                aria-label="Filter recent downloads"
                className="pl-9 pr-9"
              />
              {downloadQuery && (
                <Button variant="ghost" size="icon-sm" className="absolute right-0.5 top-1/2 -translate-y-1/2" onClick={() => setDownloadQuery("")} aria-label="Clear download filter">
                  <X />
                </Button>
              )}
            </div>
          )}
          {downloadsError && recentDownloads.length > 0 && (
            <p className="text-xs text-destructive" role="status">Refresh failed; showing the last available list.</p>
          )}
          <Card size="sm" className="gap-0 py-0">
            {downloadsLoading && recentDownloads.length === 0 ? (
              <CardContent className="flex min-h-32 items-center justify-center p-4 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" aria-label="Loading recent downloads" />
              </CardContent>
            ) : downloadsError && recentDownloads.length === 0 ? (
              <CardContent className="flex min-h-32 flex-col items-center justify-center p-4 text-center">
                <p className="font-medium">Downloads aren’t available</p>
                <p className="mt-1 text-xs text-muted-foreground">Check folder access, then try again.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void refreshDownloads()}>
                  <RefreshCw /> Retry
                </Button>
              </CardContent>
            ) : recentDownloads.length === 0 ? (
              <CardContent className="flex min-h-32 flex-col items-center justify-center p-4 text-center">
                <Download className="mb-2 size-6 text-muted-foreground" />
                <p className="font-medium">No downloads yet</p>
                <p className="mt-1 text-xs text-muted-foreground">New files in Downloads will appear here.</p>
              </CardContent>
            ) : visibleDownloads.length === 0 ? (
              <CardContent className="flex min-h-32 flex-col items-center justify-center p-4 text-center">
                <Search className="mb-2 size-6 text-muted-foreground" />
                <p className="font-medium">No matching downloads</p>
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setDownloadQuery("")}>Clear filter</Button>
              </CardContent>
            ) : (
              visibleDownloads.map((download) => (
                <DownloadRow
                  key={download.path}
                  download={download}
                  projects={activeProjects}
                  suggestedProjectId={suggestInboxProject(download.name, activeProjects, subjects)}
                  assigning={assigningId === `download:${download.path}`}
                  onAdd={addDownload}
                />
              ))
            )}
          </Card>
        </section>
      </div>
    </ScrollArea>
  )
}

function DownloadRow({ download, projects, suggestedProjectId, assigning, onAdd }: {
  download: RecentDownload
  projects: Project[]
  suggestedProjectId?: string
  assigning: boolean
  onAdd: (download: RecentDownload, projectId: string) => Promise<void>
}) {
  const extension = download.name.includes(".") ? download.name.split(".").pop() ?? "" : ""
  const modified = download.modifiedAt > 0 ? formatDistanceToNow(download.modifiedAt, { addSuffix: true }) : null
  const orderedProjects = suggestedProjectId
    ? [...projects].sort((a, b) => Number(b.id === suggestedProjectId) - Number(a.id === suggestedProjectId))
    : projects

  return (
    <div className="flex min-w-0 items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <FileTypeIcon extension={extension} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={download.name}>{download.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={download.modifiedAt > 0 ? `${download.path} · ${format(download.modifiedAt, "PPpp")}` : download.path}>
          {formatFileSize(download.size)}{modified ? ` · ${modified}` : ""}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={assigning || projects.length === 0}
            aria-label={`Add ${download.name} to a project`}
            aria-busy={assigning}
            title={projects.length === 0 ? "Create an active project first" : undefined}
          >
            {assigning ? <Loader2 className="animate-spin" /> : <Plus />}
            Add
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Add to project</DropdownMenuLabel>
          {orderedProjects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => void onAdd(download, project.id)}>
              <span aria-hidden="true">{project.icon ?? "📄"}</span>
              <span className="truncate">{project.name}</span>
              {project.id === suggestedProjectId && <span className="ml-auto text-micro font-medium text-primary">Suggested</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function NoteRow({ note, projects, suggestedProjectId, assigning, onAttach, onRemove }: {
  note: AcademicInboxItem
  projects: Project[]
  suggestedProjectId?: string
  assigning: boolean
  onAttach: (note: AcademicInboxItem, projectId: string) => Promise<void>
  onRemove: () => void
}) {
  const orderedProjects = suggestedProjectId
    ? [...projects].sort((a, b) => Number(b.id === suggestedProjectId) - Number(a.id === suggestedProjectId))
    : projects
  const createdAt = new Date(note.createdAt)
  const createdLabel = Number.isNaN(createdAt.getTime())
    ? undefined
    : formatDistanceToNow(createdAt, { addSuffix: true })

  return (
    <div className="flex min-w-0 items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/10">
        <NotebookPen className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{note.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={note.content}>
          {note.content}{createdLabel ? ` · ${createdLabel}` : ""}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={assigning || projects.length === 0}
            aria-label={`Attach ${note.name} to a project`}
            aria-busy={assigning}
            title={projects.length === 0 ? "Create an active project first" : undefined}
          >
            {assigning ? <Loader2 className="animate-spin" /> : <Plus />}
            Attach
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Attach to project</DropdownMenuLabel>
          {orderedProjects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => void onAttach(note, project.id)}>
              <span aria-hidden="true">{project.icon ?? "📄"}</span>
              <span className="truncate">{project.name}</span>
              {project.id === suggestedProjectId && <span className="ml-auto text-micro font-medium text-primary">Suggested</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${note.name}`} onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  )
}
