import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { downloadDir, join } from "@tauri-apps/api/path"
import { readDir, stat } from "@tauri-apps/plugin-fs"
import { formatDistanceToNow } from "date-fns"
import { ChevronDown, Download, Inbox, Loader2, NotebookPen, Plus, Trash2 } from "lucide-react"
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
import { type AcademicInboxItem, selectRecentDownloads } from "@/lib/academicInbox"
import { setCachedPreference } from "@/lib/storage/preferences"
import type { Project } from "@/lib/types"
import { formatFileSize, generateId } from "@/lib/utils"

const STORAGE_KEY = "focal-academic-inbox"

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

export function AcademicInboxView({ projects, onUpdateProject, onFilesChanged }: {
  projects: Project[]
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<void> | void
  onFilesChanged: (projectId: string) => Promise<void> | void
}) {
  const [notes, setNotes] = useState<AcademicInboxItem[]>(() => readInbox().filter((item) => item.kind === "note"))
  const [recentDownloads, setRecentDownloads] = useState<RecentDownload[]>([])
  const [downloadsLoading, setDownloadsLoading] = useState(true)
  const [downloadsError, setDownloadsError] = useState(false)
  const [noteTitle, setNoteTitle] = useState("")
  const [noteContent, setNoteContent] = useState("")
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const activeProjects = useMemo(() => projects.filter((project) => !project.isArchived && !project.isFinished), [projects])

  useEffect(() => setCachedPreference(STORAGE_KEY, JSON.stringify(notes), false), [notes])
  useEffect(() => {
    let cancelled = false
    let requestId = 0
    const refresh = async () => {
      const currentRequest = ++requestId
      setDownloadsLoading(true)
      try {
        const downloads = await readRecentDownloads()
        if (cancelled || currentRequest !== requestId) return
        setRecentDownloads(downloads)
        setDownloadsError(false)
      } catch {
        if (cancelled || currentRequest !== requestId) return
        setDownloadsError(true)
      } finally {
        if (!cancelled && currentRequest === requestId) setDownloadsLoading(false)
      }
    }
    const handleFocus = () => void refresh()

    void refresh()
    window.addEventListener("focus", handleFocus)
    return () => {
      cancelled = true
      window.removeEventListener("focus", handleFocus)
    }
  }, [])

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
    toast.success("Teacher note saved")
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
                Title
                <Input
                  id="teacher-note-title"
                  value={noteTitle}
                  onChange={(event) => setNoteTitle(event.target.value)}
                  placeholder="e.g. Essay feedback"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium" htmlFor="teacher-note-content">
                Note
                <Textarea
                  id="teacher-note-content"
                  className="min-h-20 resize-none"
                  value={noteContent}
                  onChange={(event) => setNoteContent(event.target.value)}
                  placeholder="Paste the message or instructions"
                />
              </label>
            </div>
            <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Saved here until you attach it to a project.</p>
              <Button
                size="sm"
                className="w-full sm:w-auto"
                disabled={!noteTitle.trim() || !noteContent.trim()}
                onClick={addNote}
              >
                <NotebookPen /> Save note
              </Button>
            </div>
          </CardContent>
        </Card>

        {notes.length > 0 && (
          <section className="grid gap-2.5" aria-labelledby="saved-notes-heading">
            <div>
              <h2 id="saved-notes-heading" className="text-sm font-semibold">Saved notes</h2>
              <p className="text-xs text-muted-foreground">Attach a note when you know which project needs it.</p>
            </div>
            <Card size="sm" className="gap-0 py-0">
              {[...notes].reverse().map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  projects={activeProjects}
                  assigning={assigningId === `note:${note.id}`}
                  onAttach={attachNote}
                  onRemove={() => setNotes((current) => current.filter((candidate) => candidate.id !== note.id))}
                />
              ))}
            </Card>
          </section>
        )}

        <section className="grid gap-2.5" aria-labelledby="recent-downloads-heading">
          <div>
            <h2 id="recent-downloads-heading" className="flex items-center gap-2 text-sm font-semibold">
              <Download className="size-4 text-muted-foreground" /> Recent downloads
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">The eight newest files in your Downloads folder.</p>
          </div>
          <Card size="sm" className="gap-0 py-0">
            {downloadsLoading && recentDownloads.length === 0 ? (
              <CardContent className="flex min-h-32 items-center justify-center p-4 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" aria-label="Loading recent downloads" />
              </CardContent>
            ) : downloadsError && recentDownloads.length === 0 ? (
              <CardContent className="flex min-h-32 flex-col items-center justify-center p-4 text-center">
                <p className="font-medium">Downloads aren’t available</p>
                <p className="mt-1 text-xs text-muted-foreground">Focal will try again when this window regains focus.</p>
              </CardContent>
            ) : recentDownloads.length === 0 ? (
              <CardContent className="flex min-h-32 flex-col items-center justify-center p-4 text-center">
                <Download className="mb-2 size-6 text-muted-foreground" />
                <p className="font-medium">No downloads yet</p>
                <p className="mt-1 text-xs text-muted-foreground">New files in Downloads will appear here.</p>
              </CardContent>
            ) : (
              recentDownloads.map((download) => (
                <DownloadRow
                  key={download.path}
                  download={download}
                  projects={activeProjects}
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

function DownloadRow({ download, projects, assigning, onAdd }: {
  download: RecentDownload
  projects: Project[]
  assigning: boolean
  onAdd: (download: RecentDownload, projectId: string) => Promise<void>
}) {
  const extension = download.name.includes(".") ? download.name.split(".").pop() ?? "" : ""
  const modified = download.modifiedAt > 0 ? formatDistanceToNow(download.modifiedAt, { addSuffix: true }) : null

  return (
    <div className="flex min-w-0 items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <FileTypeIcon extension={extension} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={download.name}>{download.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
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
          {projects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => void onAdd(download, project.id)}>
              <span aria-hidden="true">{project.icon ?? "📄"}</span>
              <span className="truncate">{project.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function NoteRow({ note, projects, assigning, onAttach, onRemove }: {
  note: AcademicInboxItem
  projects: Project[]
  assigning: boolean
  onAttach: (note: AcademicInboxItem, projectId: string) => Promise<void>
  onRemove: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/10">
        <NotebookPen className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{note.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{note.content}</p>
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
          {projects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => void onAttach(note, project.id)}>
              <span aria-hidden="true">{project.icon ?? "📄"}</span>
              <span className="truncate">{project.name}</span>
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
