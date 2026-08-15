import { memo, useRef, useEffect, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { FolderOpen, Plus, Search, X, Trash2, ArrowUp, ArrowDown, Tag, MoveRight, Loader2, LayoutList, FolderPlus, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileRow } from "@/components/project/FileRow"
import { FolderRow } from "./FolderRow"
import { Breadcrumb } from "./Breadcrumb"
import type { FileInfo, FileTag } from "@/lib/types"
import type { SortKey } from "@/hooks/useProjectFiles"
import { FILE_TAG_LABELS, FILE_TAGS } from "@/lib/fileMetadata"
import { cn } from "@/lib/utils"

export type ListItem =
  | { type: "file"; data: FileInfo; isExiting?: boolean }
  | { type: "folder"; name: string; path: string; fileCount: number; totalFileCount: number }

interface FileTreeProps {
  files: FileInfo[]
  loading: boolean
  listItems: ListItem[]
  selectedFiles: Set<string>
  searchQuery: string
  setSearchQuery: (q: string) => void
  selectedTags: FileTag[]
  setSelectedTags: (tags: FileTag[]) => void
  selectedSubfolder: string | null
  setSelectedSubfolder: (folder: string | null) => void
  sortKey: SortKey
  sortAsc: boolean
  setSortKey: (key: SortKey) => void
  setSortAsc: (asc: boolean) => void
  allSubfolders: string[]
  showBulkTagMenu: boolean
  setShowBulkTagMenu: (open: boolean) => void
  showBulkMoveMenu: boolean
  setShowBulkMoveMenu: (open: boolean) => void
  onAddFiles: () => void
  onCreateFolder?: () => void
  onOpenFile: (file: { path: string }) => void
  onRenameFile: (file: FileInfo, newName: string) => void
  onRemoveTag: (file: FileInfo, tag: FileTag) => void
  onAddTag: (file: FileInfo, tag: FileTag) => void
  onToggleFavorite: (file: FileInfo) => void
  onShowInFinder: (file: FileInfo) => void
  onCopyPath: (file: FileInfo) => void
  onMoveFile: (file: FileInfo, destSubfolder: string) => void
  onBulkTag: (tag: FileTag) => void
  onBulkMove: (destSubfolder: string) => void
  onCopySelectedPaths: () => void
  onSelectAll: () => void
  onClearSelection: () => void
  onDeleteSelected: () => void
  onFileSelectionChange: (file: FileInfo, selected: boolean) => void
  onFolderTagAll?: (folderPath: string, tag: FileTag) => void
  /** Breadcrumb navigation */
  breadcrumbSegments: { label: string; path: string }[]
  onBreadcrumbNavigate: (path: string) => void
  onGoBack: () => void
  canGoBack: boolean
  /** Paths of files that changed externally and should animate */
  changedPaths?: Set<string>
  /** Files that were removed externally and should animate out */
  removedFiles?: FileInfo[]
}

export const FileTree = memo(function FileTree({
  files,
  loading,
  listItems,
  selectedFiles,
  searchQuery,
  setSearchQuery,
  selectedTags,
  setSelectedTags,
  selectedSubfolder,
  setSelectedSubfolder,
  sortKey,
  sortAsc,
  setSortKey,
  setSortAsc,
  allSubfolders,
  showBulkTagMenu,
  setShowBulkTagMenu,
  showBulkMoveMenu,
  setShowBulkMoveMenu,
  onAddFiles,
  onCreateFolder,
  onOpenFile,
  onRenameFile,
  onRemoveTag,
  onAddTag,
  onToggleFavorite,
  onShowInFinder,
  onCopyPath,
  onMoveFile,
  onBulkTag,
  onBulkMove,
  onCopySelectedPaths,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
  onFileSelectionChange,
  onFolderTagAll,
  breadcrumbSegments,
  onBreadcrumbNavigate,
  onGoBack,
  canGoBack,
  changedPaths,
  removedFiles,
}: FileTreeProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hasActiveFilters = searchQuery.length > 0 || selectedTags.length > 0
  const clearFilters = () => {
    setSearchQuery("")
    setSelectedTags([])
    searchInputRef.current?.focus()
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
      </div>
    )
  }

  // Show empty state when this folder level has nothing to display (no active search/filter).
  if (listItems.length === 0 && !searchQuery && selectedTags.length === 0) {
    const hasFilesElsewhere = files.length > 0
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 text-center min-[1200px]:px-8">
        <div className="mb-5">
          <FolderOpen className="h-10 w-10 text-muted-foreground/25" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">
          {hasFilesElsewhere ? "This folder is empty" : "No files yet"}
        </p>
        <p className="text-xs text-muted-foreground mb-5 max-w-56 leading-relaxed">
          {hasFilesElsewhere
            ? "Add files here or create a new subfolder."
            : "Drag and drop files here, or select them from your computer."}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onAddFiles}>
            <Plus />
            Add files
          </Button>
          {onCreateFolder && (
            <Button variant="outline" size="sm" onClick={onCreateFolder}>
              <FolderPlus />
              New folder
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Navigation bar: breadcrumb + view toggle + sort + new folder */}
      <div className="border-t border-border/30 px-4 py-2 min-[1200px]:px-8">
        <div className="flex flex-wrap items-center gap-2">
          {/* Breadcrumb + back */}
          <Breadcrumb
            segments={breadcrumbSegments}
            onNavigate={onBreadcrumbNavigate}
            onBack={onGoBack}
            canGoBack={canGoBack}
          />

          <div className="flex-1" />

          {/* New folder */}
          {onCreateFolder && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onCreateFolder}
              title="Create new folder"
            >
              <FolderPlus />
              <span className="hidden min-[900px]:inline">New Folder</span>
            </Button>
          )}

          {/* View toggle: Folders vs All */}
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
            <Button
              variant={selectedSubfolder !== null ? "secondary" : "ghost"}
              size="icon-xs"
              onClick={() => setSelectedSubfolder("__root__")}
              aria-pressed={selectedSubfolder !== null}
              aria-label="Folder view"
              title="Folder view"
            >
              <FolderOpen />
            </Button>
            <Button
              variant={selectedSubfolder === null ? "secondary" : "ghost"}
              size="icon-xs"
              onClick={() => setSelectedSubfolder(null)}
              aria-pressed={selectedSubfolder === null}
              aria-label="All files"
              title="All files"
            >
              <LayoutList />
            </Button>
          </div>

          {/* Sort indicator */}
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSortAsc(!sortAsc)}
              title={`Sort ${sortAsc ? "descending" : "ascending"}`}
              aria-label={`Sort ${sortAsc ? "descending" : "ascending"}`}
            >
              {sortAsc ? <ArrowUp /> : <ArrowDown />}
            </Button>
          </div>
        </div>

        {/* Search and tag filters */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <Input
              ref={searchInputRef}
              type="search"
              placeholder="Search files..."
              aria-label="Search files"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <span className="hidden items-center gap-1 text-caption text-muted-foreground/60 min-[900px]:inline-flex">
            <kbd className="rounded border border-border/60 bg-background/45 px-1 font-mono text-[10px] text-foreground/70">
              /
            </kbd>
            search
          </span>
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSearchQuery("")}
              aria-label="Clear file search"
            >
              <X />
            </Button>
          )}
          <div className="mx-0.5 h-4 w-px bg-border/40" />
          {FILE_TAGS.filter((tag) => tag !== "other").map((tag) => (
            <Button
              key={tag}
              variant={selectedTags.includes(tag) ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setSelectedTags(
                selectedTags.includes(tag)
                  ? selectedTags.filter(t => t !== tag)
                  : [...selectedTags, tag]
              )}
              aria-pressed={selectedTags.includes(tag)}
            >
              {FILE_TAG_LABELS[tag]}
            </Button>
          ))}
          {selectedTags.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSelectedTags([])}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Selection bar */}
      {selectedFiles.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-accent/20 px-4 py-2.5 min-[1200px]:gap-3 min-[1200px]:px-8">
          <span className="text-xs font-medium">{selectedFiles.size} selected</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={onSelectAll}
            title="Select all visible files (Ctrl/Cmd+A)"
          >
            Select All
          </Button>
          <Button variant="ghost" size="xs" onClick={onClearSelection}>
            Clear
          </Button>
          <span className="hidden items-center gap-1 text-caption text-muted-foreground/60 min-[900px]:inline-flex">
            <kbd className="rounded border border-border/60 bg-background/45 px-1 font-mono text-[10px] text-foreground/70">
              Esc
            </kbd>
            clears
          </span>
          <Button variant="ghost" size="xs" onClick={onCopySelectedPaths}>
            <Copy />
            Copy Paths
          </Button>

          {/* Bulk tag */}
          <Popover
            open={showBulkTagMenu}
            onOpenChange={(open) => {
              setShowBulkTagMenu(open)
              if (open) setShowBulkMoveMenu(false)
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
              >
                <Tag />
                Tag
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-36 gap-1 p-1">
              {FILE_TAGS.map((tag) => (
                <Button
                  variant="ghost"
                  size="xs"
                  key={tag}
                  onClick={() => { void onBulkTag(tag); setShowBulkTagMenu(false) }}
                  className="w-full justify-start"
                >
                  {FILE_TAG_LABELS[tag]}
                </Button>
              ))}
            </PopoverContent>
          </Popover>

          {/* Bulk move */}
          <Popover
            open={showBulkMoveMenu}
            onOpenChange={(open) => {
              setShowBulkMoveMenu(open)
              if (open) setShowBulkTagMenu(false)
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
              >
                <MoveRight />
                Move
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-40 gap-1 p-1">
              {allSubfolders.map((folder) => {
                const displayName = folder.split("/").pop() ?? folder
                return (
                  <Button
                    variant="ghost"
                    size="xs"
                    key={folder}
                    onClick={() => { void onBulkMove(folder); setShowBulkMoveMenu(false) }}
                    className="w-full justify-start"
                  >
                    {displayName}
                  </Button>
                )
              })}
            </PopoverContent>
          </Popover>

          <div className="flex-1" />
          <Button
            variant="destructive"
            size="xs"
            onClick={onDeleteSelected}
          >
            <Trash2 />
            Delete
          </Button>
        </div>
      )}

      {listItems.length === 0 && hasActiveFilters ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-12 text-center min-[1200px]:px-8">
          <Search className="mb-4 h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
          <p className="mb-1 text-sm font-medium text-foreground">
            No matching files
          </p>
          <p className="mb-5 max-w-64 text-xs leading-relaxed text-muted-foreground">
            Try a different file name or remove the active tag filters.
          </p>
          <Button variant="secondary" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>

      {/* Column header */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border/60 bg-muted/30 text-caption text-muted-foreground min-[1200px]:px-6">
        <div className="w-6 shrink-0" />
        <div className="w-8 shrink-0" />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            if (sortKey === "name") setSortAsc(!sortAsc)
            else { setSortKey("name"); setSortAsc(true) }
          }}
          aria-sort={sortKey === "name" ? (sortAsc ? "ascending" : "descending") : "none"}
          className="min-w-0 flex-1 justify-start"
        >
          Name
          {sortKey === "name" && (sortAsc ? <ArrowUp /> : <ArrowDown />)}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            if (sortKey === "modified") setSortAsc(!sortAsc)
            else { setSortKey("modified"); setSortAsc(true) }
          }}
          aria-sort={sortKey === "modified" ? (sortAsc ? "ascending" : "descending") : "none"}
          className="w-28 shrink-0 justify-start"
        >
          Date
          {sortKey === "modified" && (sortAsc ? <ArrowUp /> : <ArrowDown />)}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            if (sortKey === "size") setSortAsc(!sortAsc)
            else { setSortKey("size"); setSortAsc(true) }
          }}
          aria-sort={sortKey === "size" ? (sortAsc ? "ascending" : "descending") : "none"}
          className="w-20 shrink-0 justify-start"
        >
          Size
          {sortKey === "size" && (sortAsc ? <ArrowUp /> : <ArrowDown />)}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            if (sortKey === "extension") setSortAsc(!sortAsc)
            else { setSortKey("extension"); setSortAsc(true) }
          }}
          aria-sort={sortKey === "extension" ? (sortAsc ? "ascending" : "descending") : "none"}
          className="w-16 shrink-0 justify-start"
        >
          Type
          {sortKey === "extension" && (sortAsc ? <ArrowUp /> : <ArrowDown />)}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            if (sortKey === "tags") setSortAsc(!sortAsc)
            else { setSortKey("tags"); setSortAsc(true) }
          }}
          aria-sort={sortKey === "tags" ? (sortAsc ? "ascending" : "descending") : "none"}
          className="w-24 shrink-0 justify-start"
        >
          Tags
          {sortKey === "tags" && (sortAsc ? <ArrowUp /> : <ArrowDown />)}
        </Button>
        <div className="w-8 shrink-0" />
      </div>

      {/* File list — virtualized */}
      <VirtualFileList
        listItems={listItems}
        selectedFiles={selectedFiles}
        onOpenFile={onOpenFile}
        onRenameFile={onRenameFile}
        onRemoveTag={onRemoveTag}
        onAddTag={onAddTag}
        onToggleFavorite={onToggleFavorite}
        onShowInFinder={onShowInFinder}
        onCopyPath={onCopyPath}
        onMoveFile={onMoveFile}
        onFileSelectionChange={onFileSelectionChange}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
        onFocusSearch={() => searchInputRef.current?.focus()}
        allSubfolders={allSubfolders}
        onFolderClick={setSelectedSubfolder}
        onFolderTagAll={onFolderTagAll}
        changedPaths={changedPaths}
        removedFiles={removedFiles}
      />
        </>
      )}

    </>
  )
})

const ESTIMATED_ROW_HEIGHT = 48

interface VirtualFileListProps {
  listItems: ListItem[]
  selectedFiles: Set<string>
  onOpenFile: (file: { path: string }) => void
  onRenameFile: (file: FileInfo, newName: string) => void
  onRemoveTag: (file: FileInfo, tag: FileTag) => void
  onAddTag: (file: FileInfo, tag: FileTag) => void
  onToggleFavorite: (file: FileInfo) => void
  onShowInFinder: (file: FileInfo) => void
  onCopyPath: (file: FileInfo) => void
  onMoveFile: (file: FileInfo, destFolder: string) => void
  onFileSelectionChange: (file: FileInfo, selected: boolean) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onFocusSearch: () => void
  onFolderTagAll?: (folderPath: string, tag: FileTag) => void
  allSubfolders: string[]
  onFolderClick: (folder: string) => void
  changedPaths?: Set<string>
  removedFiles?: FileInfo[]
}

const VirtualFileList = memo(function VirtualFileList({
  listItems,
  selectedFiles,
  onOpenFile,
  onRenameFile,
  onRemoveTag,
  onAddTag,
  onToggleFavorite,
  onShowInFinder,
  onCopyPath,
  onMoveFile,
  onFileSelectionChange,
  onSelectAll,
  onClearSelection,
  onFocusSearch,
  onFolderTagAll,
  allSubfolders,
  onFolderClick,
  changedPaths,
  removedFiles: _removedFiles,
}: VirtualFileListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const focusedIndexRef = useRef(focusedIndex)

  // Keep ref in sync with state for the keyboard listener
  useEffect(() => {
    focusedIndexRef.current = focusedIndex
  }, [focusedIndex])

  // Clamp focusedIndex when listItems changes (e.g. filtering, sorting)
  useEffect(() => {
    setFocusedIndex((prev) => {
      if (prev >= listItems.length) {
        return listItems.length > 0 ? listItems.length - 1 : -1
      }
      return prev
    })
  }, [listItems])

  const virtualizer = useVirtualizer({
    count: listItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 5,
  })

  // Refs to avoid re-registering the keyboard listener on every data change
  const listItemsRef = useRef(listItems)
  const selectedFilesRef = useRef(selectedFiles)
  const onOpenFileRef = useRef(onOpenFile)
  const onFolderClickRef = useRef(onFolderClick)
  const onFileSelectionChangeRef = useRef(onFileSelectionChange)
  const onMoveFileRef = useRef(onMoveFile)
  const onSelectAllRef = useRef(onSelectAll)
  const onClearSelectionRef = useRef(onClearSelection)
  const onFocusSearchRef = useRef(onFocusSearch)

  listItemsRef.current = listItems
  selectedFilesRef.current = selectedFiles
  onOpenFileRef.current = onOpenFile
  onFolderClickRef.current = onFolderClick
  onFileSelectionChangeRef.current = onFileSelectionChange
  onMoveFileRef.current = onMoveFile
  onSelectAllRef.current = onSelectAll
  onClearSelectionRef.current = onClearSelection
  onFocusSearchRef.current = onFocusSearch

  // Keyboard navigation — uses refs for values that change frequently
  // so the listener is only registered once.
  useEffect(() => {
    const el = parentRef.current
    if (!el) return

    const onKeyDown = (e: KeyboardEvent) => {
      // ponytail: ignore events from input/textarea — the user is typing, not
      // navigating the file list.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return
      const items = listItemsRef.current
      if (items.length === 0) return
      const currentFocused = focusedIndexRef.current

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault()
        onSelectAllRef.current()
      } else if (e.key === "/") {
        e.preventDefault()
        onFocusSearchRef.current()
      } else if (e.key === "Escape" && selectedFilesRef.current.size > 0) {
        e.preventDefault()
        onClearSelectionRef.current()
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const next = prev < items.length - 1 ? prev + 1 : prev
          virtualizer.scrollToIndex(next, { align: "auto" })
          return next
        })
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : prev
          virtualizer.scrollToIndex(next, { align: "auto" })
          return next
        })
      } else if (e.key === "Enter") {
        if (currentFocused >= 0 && currentFocused < items.length) {
          const item = items[currentFocused]
          if (item.type === "file") {
            onOpenFileRef.current(item.data)
          } else {
            onFolderClickRef.current(item.path)
          }
        }
      } else if (e.key === " ") {
        e.preventDefault()
        if (currentFocused >= 0 && currentFocused < items.length) {
          const item = items[currentFocused]
          if (item.type === "file") {
            onFileSelectionChangeRef.current(item.data, !selectedFilesRef.current.has(item.data.path))
          }
        }
      } else if (e.key === "Home") {
        e.preventDefault()
        if (items.length > 0) {
          setFocusedIndex(0)
          virtualizer.scrollToIndex(0, { align: "start" })
        }
      } else if (e.key === "End") {
        e.preventDefault()
        if (items.length > 0) {
          const last = items.length - 1
          setFocusedIndex(last)
          virtualizer.scrollToIndex(last, { align: "end" })
        }
      }
    }

    el.addEventListener("keydown", onKeyDown)
    return () => el.removeEventListener("keydown", onKeyDown)
  }, [virtualizer])

  const items = virtualizer.getVirtualItems()

  return (
    <ScrollArea
      viewportRef={parentRef}
      className="min-h-0 flex-1 outline-none [&:has(:focus-visible)]:ring-2 [&:has(:focus-visible)]:ring-inset [&:has(:focus-visible)]:ring-ring/25"
    >
      <div
        tabIndex={0}
        role="listbox"
        aria-label="Files and folders"
        aria-activedescendant={focusedIndex >= 0 ? `file-item-${focusedIndex}` : undefined}
        className="outline-none"
      >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${items[0]?.start ?? 0}px)`,
          }}
        >
          {items.map((virtualItem) => {
            const item = listItems[virtualItem.index]
            const path = item.type === "file" ? item.data.path : item.path
            const isChanged = changedPaths?.has(path) ?? false
            const isExiting = item.type === "file" && item.isExiting
            const isFocused = virtualItem.index === focusedIndex
            return (
              <div
                key={virtualItem.key}
                id={`file-item-${virtualItem.index}`}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className={cn(
                  isChanged && "animate-file-row-glow",
                  isExiting && "animate-file-row-exit",
                )}
                role="option"
                aria-selected={item.type === "file" ? selectedFiles.has(item.data.path) : undefined}
                onMouseDown={() => setFocusedIndex(virtualItem.index)}
              >
                {item.type === "folder" ? (
                  <FolderRow
                    name={item.name}
                    fileCount={item.fileCount}
                    totalFileCount={item.totalFileCount}
                    onClick={() => onFolderClickRef.current(item.path)}
                    onTagAll={onFolderTagAll ? (tag) => onFolderTagAll(item.path, tag) : undefined}
                    isFocused={isFocused}
                    onFileDrop={(filePath: string) => {
                      const fileItem = listItemsRef.current.find(
                        (i) => i.type === "file" && i.data.path === filePath,
                      )
                      if (fileItem?.type === "file") {
                        onMoveFileRef.current(fileItem.data, item.path)
                      }
                    }}
                  />
                ) : (
                  <FileRow
                    file={item.data}
                    onOpen={onOpenFileRef.current}
                    onRename={onRenameFile}
                    onRemoveTag={onRemoveTag}
                    onAddTag={onAddTag}
                    onToggleFavorite={onToggleFavorite}
                    onShowInFinder={onShowInFinder}
                    onCopyPath={onCopyPath}
                    onMoveFile={onMoveFileRef.current}
                    isSelected={selectedFiles.has(item.data.path)}
                    onSelectionChange={onFileSelectionChangeRef.current}
                    subfolders={allSubfolders}
                    selectionMode={selectedFiles.size > 0}
                    isFocused={isFocused}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      </div>
    </ScrollArea>
  )
})
