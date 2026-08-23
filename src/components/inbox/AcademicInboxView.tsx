import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { downloadDir } from "@tauri-apps/api/path"
import { FilePlus2, Inbox, Loader2, NotebookPen, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { type AcademicInboxItem, suggestInboxProject } from "@/lib/academicInbox"
import { setCachedPreference } from "@/lib/storage/preferences"
import type { Project, Subject } from "@/lib/types"
import { generateId } from "@/lib/utils"

const STORAGE_KEY = "focal-academic-inbox"

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
  } catch { return [] }
}

export function AcademicInboxView({ projects, subjects, onUpdateProject, onFilesChanged }: {
  projects: Project[]
  subjects: Subject[]
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<void> | void
  onFilesChanged: (projectId: string) => Promise<void> | void
}) {
  const [items, setItems] = useState<AcademicInboxItem[]>(readInbox)
  const [noteTitle, setNoteTitle] = useState("")
  const [noteContent, setNoteContent] = useState("")
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const activeProjects = useMemo(() => projects.filter((project) => !project.isArchived && !project.isFinished), [projects])
  useEffect(() => setCachedPreference(STORAGE_KEY, JSON.stringify(items), false), [items])

  const addFiles = async () => {
    const selected = await open({ multiple: true, directory: false, defaultPath: await downloadDir() })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    setItems((current) => {
      const known = new Set(current.flatMap((item) => item.path ? [item.path] : []))
      const additions = paths.filter((path) => !known.has(path)).map((path): AcademicInboxItem => {
        const name = path.split(/[\\/]/).pop() ?? path
        return { id: generateId(), kind: "file", name, path, createdAt: new Date().toISOString(), suggestedProjectId: suggestInboxProject(name, projects, subjects) }
      })
      return [...current, ...additions]
    })
  }
  const addNote = () => {
    if (!noteTitle.trim() || !noteContent.trim()) return
    const searchable = `${noteTitle} ${noteContent}`
    setItems((current) => [...current, { id: generateId(), kind: "note", name: noteTitle.trim(), content: noteContent.trim(), createdAt: new Date().toISOString(), suggestedProjectId: suggestInboxProject(searchable, projects, subjects) }])
    setNoteTitle("")
    setNoteContent("")
  }
  const assign = async (item: AcademicInboxItem, projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project) return
    setAssigningId(item.id)
    try {
      if (item.kind === "file" && item.path) {
        await invoke("move_files_to_project", { files: [item.path], projectName: project.folder_path, copy: true })
        await onFilesChanged(project.id)
      } else if (item.content) {
        const prefix = project.notes?.trim() ? `${project.notes.trim()}\n\n` : ""
        await onUpdateProject(project.id, { notes: `${prefix}${item.name}\n${item.content}` })
      }
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      toast.success(`${item.kind === "file" ? "File" : "Note"} assigned to ${project.name}`)
    } catch (error) {
      toast.error(`Could not assign item: ${String(error)}`)
    } finally { setAssigningId(null) }
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid max-w-6xl gap-5 p-4 pb-10 min-[1200px]:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
          <div><div className="flex items-center gap-2"><Inbox className="size-5 text-primary" /><h1 className="text-xl font-semibold">Academic inbox</h1></div><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Collect first, review once, then copy material into the right assessment. Suggested destinations are filename- and subject-based.</p></div>
          <Button onClick={() => void addFiles()}><FilePlus2 /> Add downloaded files</Button>
        </header>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><NotebookPen className="size-4" /> Capture a teacher note</CardTitle><CardDescription>Save instructions or feedback now and attach it to an assessment when ready.</CardDescription></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
            <Input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Title" aria-label="Inbox note title" />
            <Textarea className="min-h-9" value={noteContent} onChange={(event) => setNoteContent(event.target.value)} placeholder="Paste the message or instructions" aria-label="Inbox note content" />
            <Button disabled={!noteTitle.trim() || !noteContent.trim()} onClick={addNote}>Capture</Button>
          </CardContent>
        </Card>
        <div className="grid gap-3">
          {items.map((item) => <InboxRow key={item.id} item={item} projects={activeProjects} assigning={assigningId === item.id} onAssign={assign} onDestination={(projectId) => setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, suggestedProjectId: projectId } : candidate))} onRemove={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))} />)}
          {!items.length && <Card><CardContent className="flex min-h-56 flex-col items-center justify-center text-center"><Inbox className="mb-3 size-9 text-muted-foreground" /><p className="font-medium">Inbox clear</p><p className="mt-1 text-sm text-muted-foreground">Add downloaded files or capture a teacher note.</p></CardContent></Card>}
        </div>
      </div>
    </ScrollArea>
  )
}

function InboxRow({ item, projects, assigning, onAssign, onDestination, onRemove }: {
  item: AcademicInboxItem; projects: Project[]; assigning: boolean
  onAssign: (item: AcademicInboxItem, projectId: string) => Promise<void>
  onDestination: (projectId: string) => void; onRemove: () => void
}) {
  return <Card size="sm"><CardContent className="flex flex-wrap items-center gap-3">
    <span className="flex size-9 items-center justify-center rounded-lg bg-muted">{item.kind === "file" ? <FilePlus2 className="size-4" /> : <NotebookPen className="size-4" />}</span>
    <div className="min-w-48 flex-1"><p className="truncate font-medium">{item.name}</p><p className="truncate text-xs text-muted-foreground">{item.kind === "file" ? item.path : item.content}</p></div>
    {item.suggestedProjectId && <span className="inline-flex items-center gap-1 text-xs text-primary"><Sparkles className="size-3" /> Suggested</span>}
    <Select value={item.suggestedProjectId ?? ""} onValueChange={onDestination}><SelectTrigger className="w-52"><SelectValue placeholder="Choose assessment" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select>
    <Button disabled={!item.suggestedProjectId || assigning} onClick={() => item.suggestedProjectId && void onAssign(item, item.suggestedProjectId)}>{assigning ? <Loader2 className="animate-spin" /> : item.kind === "file" ? "Copy in" : "Attach"}</Button>
    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.name} from inbox`} onClick={onRemove}><Trash2 /></Button>
  </CardContent></Card>
}
