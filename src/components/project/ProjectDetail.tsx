import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react"
import { AlertCircle, Plus, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { openPath } from "@tauri-apps/plugin-opener"
import { join } from "@tauri-apps/api/path"
import { exists } from "@tauri-apps/plugin-fs"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { toast } from "sonner"
import type { UnlistenFn } from "@tauri-apps/api/event"
import { useProjectFiles, SORT_COMPARATORS } from "@/hooks/useProjectFiles"
import { confirmDestructiveAction } from "@/lib/confirmToast"
import { type FileTag } from "@/lib/types"
import type { Project, FileInfo, StudySession } from "@/lib/types"
import { ProjectHeader } from "@/components/project/ProjectHeader"
import { FileTree } from "@/components/project/FileTree"
import type { ListItem } from "@/components/project/FileTree"
import { SessionList } from "@/components/project/SessionList"
import { ProjectChecklistPanel } from "@/components/project/ProjectChecklistPanel"
import { ProjectDependenciesPanel } from "@/components/project/ProjectDependenciesPanel"
import { AutoRenameButton } from "@/components/project/AutoRenameButton"
import { ProjectLearningPanel } from "@/components/project/ProjectLearningPanel"
import { notifyProjectActionError } from "@/components/project/shared"
import { getErrorMessage } from "@/lib/utils"

interface ProjectDetailProps {
  project: Project
  sessions: StudySession[]
  onFilesChanged: () => void
  onOpenSettings: () => void
  onToggleFinished?: (id: string) => void
  onSelectSession?: (session: StudySession) => void
  onNewSession?: () => void
  onUpdateNotes?: (notes: string) => void
  onAddChecklistItem?: (text: string) => void
  onAddChecklistItems?: (texts: string[]) => void | Promise<void>
  onToggleChecklistItem?: (itemId: string) => void
  onRemoveChecklistItem?: (itemId: string) => void
  onAddDependency?: (dependsOnId: string) => void
  onRemoveDependency?: (dependsOnId: string) => void
  onOpenProject?: (projectId: string) => void
  availableProjects?: Project[]
  onExport?: () => void
  onSaveAsTemplate?: () => void
  onStartFocus?: () => void
  onUpdateProject?: (updates: Partial<Project>) => Promise<void> | void
}

export const ProjectDetail = memo(function ProjectDetail({
  project, sessions, onFilesChanged, onOpenSettings, onToggleFinished,
  onSelectSession, onNewSession,
  onUpdateNotes, onAddChecklistItem, onToggleChecklistItem, onRemoveChecklistItem,
  onAddChecklistItems,
  onAddDependency, onRemoveDependency, onOpenProject, availableProjects,
  onExport, onSaveAsTemplate,
  onStartFocus,
  onUpdateProject,
}: ProjectDetailProps) {
  const {
    files, loading, error, loadFiles, addFiles, renameFile, moveFileToFolder, deleteFiles,
    addFileTags, removeFileTag, toggleFavorite,
    sortKey, sortAsc, setSortKey, setSortAsc,
    firstLevelSubfolders, hasPendingChanges, changedPaths, removedFiles,
  } = useProjectFiles(project.folder_path)
  const [isDragging, setIsDragging] = useState(false)
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const shiftPressedRef = useRef(false)
  const [selectedSubfolder, setSelectedSubfolder] = useState<string | null>("__root__")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTags, setSelectedTags] = useState<FileTag[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<"files" | "sessions" | "learning">("files")
  const [showBulkTagMenu, setShowBulkTagMenu] = useState(false)
  const [showBulkMoveMenu, setShowBulkMoveMenu] = useState(false)
  const activeDropKeysRef = useRef(new Set<string>())

  const breadcrumbSegments = useMemo(() => {
    const segments: { label: string; path: string }[] = []
    if (selectedSubfolder === null) {
      segments.push({ label: "All Files", path: "__all__" })
    } else {
      segments.push({ label: "Project Files", path: "__root__" })
      if (selectedSubfolder !== "__root__") {
        const parts = selectedSubfolder.split("/")
        let currentPath = ""
        for (const part of parts) {
          currentPath = currentPath ? `${currentPath}/${part}` : part
          segments.push({ label: part, path: currentPath })
        }
      }
    }
    return segments
  }, [selectedSubfolder])

  const canGoBack = useMemo(() => {
    if (selectedSubfolder === null) return false
    return selectedSubfolder !== "__root__"
  }, [selectedSubfolder])

  const handleGoBack = useCallback(() => {
    if (selectedSubfolder === null || selectedSubfolder === "__root__") return
    const parts = selectedSubfolder.split("/")
    if (parts.length === 1) {
      setSelectedSubfolder("__root__")
    } else {
      setSelectedSubfolder(parts.slice(0, -1).join("/"))
    }
  }, [selectedSubfolder])

  const handleBreadcrumbNavigate = useCallback((path: string) => {
    if (path === "__all__") {
      setSelectedSubfolder(null)
    } else {
      setSelectedSubfolder(path)
    }
  }, [])

  useEffect(() => {
    void loadFiles()
  }, [project.id, loadFiles])

  useEffect(() => {
    if (!loading) {
      onFilesChanged()
    }
  }, [files, loading, onFilesChanged])

  useEffect(() => {
    let cancelled = false
    let unlisten: UnlistenFn | undefined

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftPressedRef.current = true
        setIsShiftPressed(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftPressedRef.current = false
        setIsShiftPressed(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)

    const setup = async () => {
      try {
        const u = await getCurrentWebviewWindow().onDragDropEvent((event) => {
          const payload = event.payload

          switch (payload.type) {
            case "enter":
            case "over":
              if (!cancelled) setIsDragging(true)
              break
            case "drop": {
              if (!cancelled) setIsDragging(false)
              if (cancelled || payload.paths.length === 0) break
              const targetFolder = selectedSubfolder && selectedSubfolder !== "__root__"
                ? `${project.folder_path}/${selectedSubfolder}`
                : project.folder_path
              const dropKey = `${targetFolder}\0${payload.paths.join("\0")}`
              if (activeDropKeysRef.current.has(dropKey)) break
              activeDropKeysRef.current.add(dropKey)
              const copy = shiftPressedRef.current
              invoke("move_files_to_project", {
                files: payload.paths,
                projectName: targetFolder,
                copy,
              })
                .then(() => {
                  if (!cancelled) {
                    void loadFiles({ silent: true })
                    onFilesChanged()
                  }
                })
                .catch((e) => {
                  if (!cancelled) {
                    void loadFiles({ silent: true })
                    onFilesChanged()
                    notifyProjectActionError(copy ? "Could not copy dropped files" : "Could not move dropped files", e)
                  }
                })
                .finally(() => {
                  activeDropKeysRef.current.delete(dropKey)
                })
              break
            }
            case "leave":
              if (!cancelled) setIsDragging(false)
              break
          }
        })
        if (!cancelled) {
          unlisten = u
        } else {
          u()
        }
      } catch (e) {
        if (!cancelled) {
          notifyProjectActionError("Drag and drop is unavailable", e)
        }
      }
    }

    void setup()

    return () => {
      cancelled = true
      unlisten?.()
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [project.folder_path, selectedSubfolder, loadFiles, onFilesChanged])

  const handleAddFiles = useCallback(async () => {
    try {
      const count = await addFiles(selectedSubfolder === "__root__" ? null : selectedSubfolder)
      if (count) onFilesChanged()
    } catch (e) {
      notifyProjectActionError("Could not add files", e)
    }
  }, [addFiles, selectedSubfolder, onFilesChanged])

  const handleCreateFolder = useCallback(async () => {
    try {
      const baseName = "New Folder"
      const existingNames = new Set<string>()
      for (const f of files) {
        if (!f.subfolder) continue
        if (selectedSubfolder === "__root__" || !selectedSubfolder) {
          const firstPart = f.subfolder.split("/")[0]
          if (firstPart) existingNames.add(firstPart)
        } else if (f.subfolder.startsWith(`${selectedSubfolder}/`)) {
          const relative = f.subfolder.slice(selectedSubfolder.length + 1)
          const firstPart = relative.split("/")[0]
          if (firstPart) existingNames.add(firstPart)
        }
      }
      let name = baseName
      let counter = 1
      while (existingNames.has(name)) {
        name = `${baseName} (${counter})`
        counter++
      }
      const relativePath = selectedSubfolder && selectedSubfolder !== "__root__"
        ? `${project.folder_path}/${selectedSubfolder}/${name}`
        : `${project.folder_path}/${name}`
      const projectsDir = await invoke<string>("get_projects_directory")
      const fullPath = await join(projectsDir, relativePath)
      if (await exists(fullPath)) {
        toast.error(`A folder named "${name}" already exists`)
        return
      }
      await invoke("create_project_folder", { projectName: relativePath })
      await loadFiles({ silent: true })
      onFilesChanged()
    } catch (e) {
      notifyProjectActionError("Could not create folder", e)
    }
  }, [files, project.folder_path, selectedSubfolder, loadFiles, onFilesChanged])

  const handleOpenFolder = useCallback(async () => {
    try {
      const projectsDir = await invoke<string>("get_projects_directory")
      const folderPath = selectedSubfolder && selectedSubfolder !== "__root__"
        ? await join(projectsDir, project.folder_path, selectedSubfolder)
        : await join(projectsDir, project.folder_path)
      await openPath(folderPath)
    } catch (e) {
      notifyProjectActionError("Could not open folder", e)
    }
  }, [project.folder_path, selectedSubfolder])

  const handleOpenFile = useCallback(async (file: { path: string }) => {
    try {
      await openPath(file.path)
    } catch (e) {
      notifyProjectActionError("Could not open file", e)
    }
  }, [])

  const handleRenameFile = useCallback(async (file: FileInfo, newName: string) => {
    try {
      await renameFile(file.path, newName)
      onFilesChanged()
    } catch (e) {
      notifyProjectActionError("Could not rename file", e)
    }
  }, [renameFile, onFilesChanged])

  const handleRemoveTag = useCallback(async (file: FileInfo, tag: FileTag) => {
    try {
      await removeFileTag(file.path, tag)
      onFilesChanged()
    } catch (e) {
      notifyProjectActionError("Could not remove tag", e)
    }
  }, [removeFileTag, onFilesChanged])

  const handleAddTag = useCallback(async (file: FileInfo, tag: FileTag) => {
    try {
      await addFileTags([file.path], [tag])
      onFilesChanged()
    } catch (e) {
      notifyProjectActionError("Could not add tag", e)
    }
  }, [addFileTags, onFilesChanged])

  const handleToggleFavorite = useCallback(async (file: FileInfo) => {
    try {
      await toggleFavorite(file.path)
      onFilesChanged()
    } catch (e) {
      notifyProjectActionError("Could not update favorite", e)
    }
  }, [toggleFavorite, onFilesChanged])

  const handleShowInFinder = useCallback(async (file: FileInfo) => {
    try {
      const lastSep = Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\"))
      const parentFolder = lastSep >= 0 ? file.path.substring(0, lastSep) : file.path
      await openPath(parentFolder)
    } catch (e) {
      notifyProjectActionError("Could not show file in folder", e)
    }
  }, [])

  const handleCopyPath = useCallback(async (file: FileInfo) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable")
      }
      await navigator.clipboard.writeText(file.path)
      toast.success("Path copied")
    } catch (e) {
      notifyProjectActionError("Could not copy path", e)
    }
  }, [])

  const handleCopySelectedPaths = useCallback(async () => {
    if (selectedFiles.size === 0) return
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable")
      }
      const paths = Array.from(selectedFiles)
      await navigator.clipboard.writeText(paths.join("\n"))
      toast.success(`Copied ${paths.length} path${paths.length === 1 ? "" : "s"}`)
    } catch (e) {
      notifyProjectActionError("Could not copy selected paths", e)
    }
  }, [selectedFiles])

  const handleMoveFile = useCallback(async (file: FileInfo, destSubfolder: string) => {
    try {
      const projectsDir = await invoke<string>("get_projects_directory")
      const destFolder = await join(projectsDir, project.folder_path, destSubfolder)
      await moveFileToFolder(file.path, destFolder)
      onFilesChanged()
    } catch (e) {
      notifyProjectActionError("Could not move file", e)
    }
  }, [moveFileToFolder, project.folder_path, onFilesChanged])

  const handleBulkTag = useCallback(async (tag: FileTag) => {
    if (selectedFiles.size === 0) return
    try {
      await addFileTags(Array.from(selectedFiles), [tag])
      setSelectedFiles(new Set())
      onFilesChanged()
    } catch (e) {
      notifyProjectActionError("Could not tag selected files", e)
    }
  }, [addFileTags, selectedFiles, onFilesChanged])

  const handleBulkMove = useCallback(async (destSubfolder: string) => {
    if (selectedFiles.size === 0) return
    let destFolder: string
    try {
      const projectsDir = await invoke<string>("get_projects_directory")
      destFolder = await join(projectsDir, project.folder_path, destSubfolder)
    } catch (e) {
      notifyProjectActionError("Could not prepare file move", e)
      return
    }
    const paths = Array.from(selectedFiles)
    let moved = 0
    const failedPaths: string[] = []
    const toastId = toast.loading(`Processing 0 of ${paths.length} files...`)
    for (const [index, fp] of paths.entries()) {
      try {
        await moveFileToFolder(fp, destFolder)
        moved++
      } catch {
        failedPaths.push(fp)
      }
      toast.loading(`Processing ${index + 1} of ${paths.length} files...`, { id: toastId })
    }
    toast.dismiss(toastId)
    if (moved > 0) {
      setSelectedFiles(new Set(failedPaths))
      onFilesChanged()
      toast.success(`Moved ${moved} file${moved > 1 ? "s" : ""}`)
    }
    if (failedPaths.length > 0) {
      toast.error(`Could not move ${failedPaths.length} file${failedPaths.length === 1 ? "" : "s"}`)
    }
  }, [moveFileToFolder, project.folder_path, selectedFiles, onFilesChanged])

  const handleFolderTagAll = useCallback(async (folderPath: string, tag: FileTag) => {
    const pathsToTag = files
      .filter((file) => {
        if (!file.subfolder) return false
        return file.subfolder === folderPath || file.subfolder.startsWith(`${folderPath}/`)
      })
      .map((file) => file.path)

    if (pathsToTag.length === 0) {
      toast.error(`No files found in "${folderPath}"`)
      return
    }

    try {
      await addFileTags(pathsToTag, [tag])
      onFilesChanged()
      toast.success(`Tagged ${pathsToTag.length} file${pathsToTag.length > 1 ? "s" : ""} as "${tag}"`)
    } catch (e) {
      notifyProjectActionError("Could not tag files in folder", e)
    }
  }, [files, addFileTags, onFilesChanged])

  const currentLevelSubfolders = useMemo(() => {
    const set = new Set<string>()
    for (const f of files) {
      if (!f.subfolder) continue
      if (selectedSubfolder === null || selectedSubfolder === "__root__") {
        const first = f.subfolder.split("/")[0]
        if (first) set.add(first)
      } else if (f.subfolder.startsWith(`${selectedSubfolder}/`)) {
        const relative = f.subfolder.slice(selectedSubfolder.length + 1)
        const firstPart = relative.split("/")[0]
        if (firstPart) set.add(`${selectedSubfolder}/${firstPart}`)
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [files, selectedSubfolder])

  const handleApplyAutoRenames = useCallback(
    async (renames: { filePath: string; newName: string }[]) => {
      if (renames.length === 0) return []
      const failed: { filePath: string; newName: string }[] = []
      const toastId = toast.loading(`Renaming 0 of ${renames.length} files...`)
      for (let i = 0; i < renames.length; i++) {
        const { filePath, newName } = renames[i]
        try {
          await renameFile(filePath, newName)
        } catch {
          failed.push(renames[i])
        }
        toast.loading(`Renaming ${i + 1} of ${renames.length} files...`, { id: toastId })
      }
      toast.dismiss(toastId)
      onFilesChanged()
      if (failed.length > 0) {
        const renamed = renames.length - failed.length
        toast.error(`Renamed ${renamed} file${renamed === 1 ? "" : "s"}; could not rename ${failed.length}`)
      } else {
        toast.success(`Renamed ${renames.length} file${renames.length > 1 ? "s" : ""}`)
      }
      return failed
    },
    [renameFile, onFilesChanged],
  )

  const filteredFiles = useMemo(() => {
    return files.filter((file) => {
      if (searchQuery && !file.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false
      }
      if (selectedTags.length > 0) {
        const fileTags = file.tags ?? (file.tag ? [file.tag] : [])
        return selectedTags.some(tag => fileTags.includes(tag))
      }
      if (selectedSubfolder === "__root__") {
        return !file.subfolder
      }
      if (selectedSubfolder) {
        const fileSubfolder = file.subfolder ?? ""
        if (fileSubfolder !== selectedSubfolder) {
          return false
        }
      }
      return true
    })
  }, [files, searchQuery, selectedTags, selectedSubfolder])

  const folderCounts = useMemo(() => {
    const recursiveCounts = new Map<string, number>()
    const directCounts = new Map<string, number>()
    for (const f of files) {
      if (!f.subfolder) continue
      const parts = f.subfolder.split("/")
      let current = ""
      for (const part of parts) {
        current = current ? `${current}/${part}` : part
        recursiveCounts.set(current, (recursiveCounts.get(current) ?? 0) + 1)
      }
      directCounts.set(f.subfolder, (directCounts.get(f.subfolder) ?? 0) + 1)
    }
    return { recursiveCounts, directCounts }
  }, [files])

  const folderItems = useMemo(() => {
    const items: ListItem[] = []
    const showFolders = !searchQuery && selectedTags.length === 0 && selectedSubfolder !== null
    if (!showFolders) return items

    const { recursiveCounts, directCounts } = folderCounts

    if (selectedSubfolder === "__root__") {
      for (const folder of firstLevelSubfolders) {
        const direct = directCounts.get(folder) ?? 0
        const total = recursiveCounts.get(folder) ?? 0
        items.push({ type: "folder", name: folder, path: folder, fileCount: direct, totalFileCount: total })
      }
    } else if (selectedSubfolder) {
      const childFolders = new Set<string>()
      for (const f of files) {
        if (f.subfolder?.startsWith(`${selectedSubfolder}/`)) {
          const relative = f.subfolder.slice(selectedSubfolder.length + 1)
          const firstPart = relative.split("/")[0]
          if (firstPart) childFolders.add(firstPart)
        }
      }
      for (const folder of childFolders) {
        const fullPath = `${selectedSubfolder}/${folder}`
        const direct = directCounts.get(fullPath) ?? 0
        const total = recursiveCounts.get(fullPath) ?? 0
        items.push({ type: "folder", name: folder, path: fullPath, fileCount: direct, totalFileCount: total })
      }
    }
    return items
  }, [files, selectedSubfolder, firstLevelSubfolders, folderCounts, searchQuery, selectedTags])

  const removedFileItems = useMemo(() => {
    const items: ListItem[] = []
    const currentPaths = new Set(files.map((f) => f.path))
    for (const file of removedFiles) {
      if (currentPaths.has(file.path)) continue
      if (searchQuery && !file.name.toLowerCase().includes(searchQuery.toLowerCase())) continue
      if (selectedTags.length > 0) {
        const fileTags = file.tags ?? (file.tag ? [file.tag] : [])
        if (!selectedTags.some(tag => fileTags.includes(tag))) continue
      }
      if (selectedSubfolder === "__root__" && file.subfolder) continue
      if (selectedSubfolder && selectedSubfolder !== "__root__" && file.subfolder !== selectedSubfolder) continue
      items.push({ type: "file", data: file, isExiting: true })
    }
    return items
  }, [removedFiles, files, searchQuery, selectedTags, selectedSubfolder])

  const listItems = useMemo(() => {
    const items: ListItem[] = [
      ...folderItems,
      ...filteredFiles.map((f) => ({ type: "file" as const, data: f })),
      ...removedFileItems,
    ]

    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1
      }

      if (a.type === "folder") {
        const fa = a as { type: "folder"; name: string; path: string }
        const fb = b as { type: "folder"; name: string; path: string }
        const cmp = fa.name.localeCompare(fb.name, undefined, { numeric: true })
        return sortAsc ? cmp : -cmp
      }

      const fa = a as { type: "file"; data: FileInfo }
      const fb = b as { type: "file"; data: FileInfo }
      const cmp = SORT_COMPARATORS[sortKey](fa.data, fb.data)
      return sortAsc ? cmp : -cmp
    })

    return items
  }, [folderItems, filteredFiles, removedFileItems, sortKey, sortAsc])

  const handleFileSelectionChange = useCallback((file: FileInfo, selected: boolean) => {
    setSelectedFiles((prev) => {
      const newSelected = new Set(prev)
      if (selected) {
        newSelected.add(file.path)
      } else {
        newSelected.delete(file.path)
      }
      return newSelected
    })
  }, [setSelectedFiles])

  const handleSelectAll = useCallback(() => {
    const allPaths = new Set(filteredFiles.map((f) => f.path))
    setSelectedFiles(allPaths)
  }, [filteredFiles])

  const handleClearSelection = useCallback(() => {
    setSelectedFiles(new Set())
  }, [])

  const handleDeleteSelected = useCallback(async () => {
    if (selectedFiles.size === 0) return
    const confirmed = await confirmDestructiveAction({
      title: `Delete ${selectedFiles.size} file${selectedFiles.size > 1 ? "s" : ""}?`,
      description: "Selected files will be removed from this assessment folder.",
      actionLabel: "Delete",
    })
    if (!confirmed) return
    const paths = Array.from(selectedFiles)
    try {
      await deleteFiles(paths)
      setSelectedFiles(new Set())
      onFilesChanged()
      toast.success(`Deleted ${paths.length} file${paths.length > 1 ? "s" : ""}`)
    } catch (e) {
      toast.error(`Could not delete selected files: ${getErrorMessage(e)}`)
    }
  }, [selectedFiles, deleteFiles, onFilesChanged])

  const hasChecklist = onUpdateNotes && onAddChecklistItem && onAddChecklistItems && onToggleChecklistItem && onRemoveChecklistItem
  const hasDependencies = onAddDependency && onRemoveDependency && onOpenProject && availableProjects

  return (
    <div className="@container/project relative flex h-full min-w-0 flex-col overflow-hidden">
      {isDragging && (
        <div className="pointer-events-none absolute inset-4 z-modal-backdrop flex items-center justify-center rounded-lg border bg-background/90">
          <div className="flex items-center gap-2">
            <Plus className="size-5" />
            <p className="text-sm font-medium">
              {isShiftPressed ? "Copy files here" : "Drop files here"}
            </p>
          </div>
        </div>
      )}

      <ProjectHeader
        project={project}
        sessions={sessions}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenSettings={onOpenSettings}
        onToggleFinished={onToggleFinished}
        onOpenFolder={handleOpenFolder}
        onAddFiles={handleAddFiles}
        onRefresh={() => loadFiles({ silent: true })}
        hasPendingChanges={hasPendingChanges}
        onExport={onExport}
        onSaveAsTemplate={onSaveAsTemplate}
        onPlanSession={onNewSession}
        onStartFocus={onStartFocus}
      />

      {/* Notes, Checklist & Dependencies — shared bordered container */}
      {viewMode !== "learning" && (hasChecklist ?? hasDependencies) && (
        <div className="border-b border-border/60">
          {hasChecklist && (
            <ProjectChecklistPanel
              project={project}
              sessions={sessions}
              onUpdateNotes={(notes) => onUpdateNotes(notes)}
              onAddChecklistItem={(text) => onAddChecklistItem(text)}
              onAddChecklistItems={(texts) => onAddChecklistItems(texts)}
              onToggleChecklistItem={(itemId) => onToggleChecklistItem(itemId)}
              onRemoveChecklistItem={(itemId) => onRemoveChecklistItem(itemId)}
            />
          )}
          {hasDependencies && (
            <ProjectDependenciesPanel
              project={project}
              availableProjects={availableProjects}
              onAddDependency={(dependsOnId) => onAddDependency(dependsOnId)}
              onRemoveDependency={(dependsOnId) => onRemoveDependency(dependsOnId)}
              onOpenProject={(projectId) => onOpenProject(projectId)}
            />
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {viewMode === "files" && error && (
          <div role="alert" className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={error}>Couldn&apos;t load project files.</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void loadFiles()}
            >
              <RefreshCw />
              Retry
            </Button>
          </div>
        )}
        {viewMode === "learning" && onUpdateProject ? (
          <ProjectLearningPanel
            project={project}
            files={files}
            onUpdateProject={onUpdateProject}
          />
        ) : viewMode === "sessions" ? (
          <SessionList
            sessions={sessions}
            project={project}
            projectName={project.name}
            onSelectSession={onSelectSession}
            onNewSession={onNewSession}
          />
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 text-muted-foreground/50 motion-safe:animate-spin" />
          </div>
        ) : (
          <FileTree
            files={files}
            loading={loading}
            listItems={listItems}
            selectedFiles={selectedFiles}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedTags={selectedTags}
            setSelectedTags={setSelectedTags}
            selectedSubfolder={selectedSubfolder}
            setSelectedSubfolder={setSelectedSubfolder}
            sortKey={sortKey}
            sortAsc={sortAsc}
            setSortKey={setSortKey}
            setSortAsc={setSortAsc}
            allSubfolders={currentLevelSubfolders}
            showBulkTagMenu={showBulkTagMenu}
            setShowBulkTagMenu={setShowBulkTagMenu}
            showBulkMoveMenu={showBulkMoveMenu}
            setShowBulkMoveMenu={setShowBulkMoveMenu}
            onAddFiles={handleAddFiles}
            onCreateFolder={handleCreateFolder}
            onOpenFile={handleOpenFile}
            onRenameFile={handleRenameFile}
            onRemoveTag={handleRemoveTag}
            onAddTag={handleAddTag}
            onToggleFavorite={handleToggleFavorite}
            onShowInFinder={handleShowInFinder}
            onCopyPath={handleCopyPath}
            onMoveFile={handleMoveFile}
            onBulkTag={handleBulkTag}
            onBulkMove={handleBulkMove}
            onCopySelectedPaths={handleCopySelectedPaths}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onDeleteSelected={handleDeleteSelected}
            onFileSelectionChange={handleFileSelectionChange}
            onFolderTagAll={handleFolderTagAll}
            breadcrumbSegments={breadcrumbSegments}
            onBreadcrumbNavigate={handleBreadcrumbNavigate}
            onGoBack={handleGoBack}
            canGoBack={canGoBack}
            changedPaths={changedPaths}
            removedFiles={removedFiles}
          />
        )}
      </div>

      {viewMode === "files" && files.length > 0 && (
        <AutoRenameButton
          files={filteredFiles}
          onApplyRenames={handleApplyAutoRenames}
        />
      )}
    </div>
  )
})
