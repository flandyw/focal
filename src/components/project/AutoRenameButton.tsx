import { useState, useCallback, useEffect, useRef } from "react"
import { Wand2, Loader2, X, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileTypeIcon } from "@/components/FileTypeIcon"
import type { FileInfo } from "@/lib/types"
import { cn } from "@/lib/utils"
import { getAutoRenameUseFileContent, setAutoRenameUseFileContent } from "@/lib/settings"
import { getActiveProvider, getEffectiveModel } from "@/lib/providers"
import { generateRenames, getFileContentPreviews, normalizeRename } from "@/lib/autoRename"
import { describeAiError } from "@/lib/aiAssistant"

interface RenameEntry {
  file: FileInfo
  newName: string
  approved: boolean
  error?: string
}

interface AutoRenameButtonProps {
  files: FileInfo[]
  onApplyRenames: (renames: { filePath: string; newName: string }[]) => Promise<{ filePath: string; newName: string }[]>
}

export function AutoRenameButton({ files, onApplyRenames }: AutoRenameButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [entries, setEntries] = useState<RenameEntry[]>([])
  const [error, setError] = useState<{ message: string; hint: string | null } | null>(null)
  const [useFileContent, setUseFileContent] = useState(() => getAutoRenameUseFileContent())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const renameAbortRef = useRef<AbortController | null>(null)
  const providerMissing = !getActiveProvider().isConfigured()

  const handleOpen = useCallback(() => {
    setSelectedPaths(new Set(files.map((f) => f.path)))
    setEntries([])
    setUseFileContent(getAutoRenameUseFileContent())
    setError(null)
    setOpen(true)
  }, [files])

  const toggleSelected = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(files.map((f) => f.path)))
  }, [files])

  const deselectAll = useCallback(() => {
    setSelectedPaths(new Set())
  }, [])

  const cancelRename = useCallback(() => {
    renameAbortRef.current?.abort()
    renameAbortRef.current = null
  }, [])

  useEffect(() => () => cancelRename(), [cancelRename])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && applying) return
    if (!nextOpen) cancelRename()
    setOpen(nextOpen)
  }, [applying, cancelRename])

  const handleGenerate = useCallback(async () => {
    const provider = getActiveProvider()
    if (!provider.isConfigured()) {
      setError({
        message: `${provider.displayName} is not configured.`,
        hint: "Open Settings \u2192 AI to choose and configure a provider.",
      })
      return
    }
    const selectedFiles = files.filter((f) => selectedPaths.has(f.path))
    if (selectedFiles.length === 0) {
      setError({ message: "No files selected. Select at least one file to rename.", hint: null })
      return
    }
    renameAbortRef.current = new AbortController()
    setLoading(true)
    setError(null)
    try {
      const fileContentPreviews = useFileContent
        ? await getFileContentPreviews(selectedFiles)
        : new Map<string, string>()
      const results = await generateRenames(
        selectedFiles,
        getEffectiveModel(),
        fileContentPreviews,
        renameAbortRef.current.signal,
      )
      const newEntries: RenameEntry[] = results.map((result, index) => {
        const file = selectedFiles[index]
        return { file, newName: result.renamed, approved: result.renamed !== file.name }
      })
      setEntries(newEntries)
    } catch (e) {
      const { message, hint, cancelled } = describeAiError(e)
      if (cancelled) return
      setError({ message, hint })
    } finally {
      renameAbortRef.current = null
      setLoading(false)
    }
  }, [files, selectedPaths, useFileContent])

  const toggleApproved = useCallback((index: number) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, approved: !e.approved, error: undefined } : e)),
    )
  }, [])

  const updateEntryName = useCallback((index: number, newName: string) => {
    setEntries((prev) => prev.map((entry, i) => (
      i === index
        ? { ...entry, newName, approved: newName.trim() !== entry.file.name, error: undefined }
        : entry
    )))
  }, [])

  const normalizeEntryName = useCallback((index: number) => {
    setEntries((prev) => prev.map((entry, i) => {
      if (i !== index) return entry
      const newName = normalizeRename(entry.file.name, entry.newName)
      return { ...entry, newName, approved: newName !== entry.file.name, error: undefined }
    }))
  }, [])

  const handleApply = useCallback(async () => {
    const toApply = entries.flatMap((entry) => {
      if (!entry.approved) return []
      const newName = normalizeRename(entry.file.name, entry.newName)
      return newName === entry.file.name ? [] : [{ filePath: entry.file.path, newName }]
    })
    if (toApply.length === 0) return

    setApplying(true)
    setError(null)
    try {
      const failed = await onApplyRenames(toApply)
      if (failed.length > 0) {
        const failedPaths = new Set(failed.map((rename) => rename.filePath))
        setEntries((current) => current.filter((entry) => failedPaths.has(entry.file.path)))
        setApplying(false)
        return
      }
    } catch (e) {
      setError({ message: describeAiError(e).message, hint: null })
      setApplying(false)
      return
    }

    setApplying(false)
    setOpen(false)
  }, [entries, onApplyRenames])

  const changedCount = entries.filter((e) => e.newName !== e.file.name).length
  const approvedCount = entries.filter((e) => e.approved && e.newName !== e.file.name).length
  const selectedCount = selectedPaths.size

  if (files.length === 0) return null

  return (
    <>
      <Button
        onClick={handleOpen}
        size="sm"
        className="fixed bottom-6 right-6 z-40"
      >
        <Wand2 className="h-4 w-4" />
        <span className="text-sm font-medium">Auto Rename</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          aria-busy={loading || applying}
          className="flex h-[min(86dvh,44rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0 sm:w-[calc(100vw-2rem)] sm:max-w-3xl"
        >
          <div className="shrink-0 border-b px-5 pb-4 pt-5">
            <DialogHeader>
              <DialogTitle>Auto Rename Files</DialogTitle>
              <DialogDescription>
                Use AI to clean up and standardize file names for this assessment.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-4">
            {providerMissing && (
              <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                {`${getActiveProvider().displayName} is not configured. Go to `}
                <span className="font-medium">Settings</span> in the sidebar to set it up.
              </p>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0">
                  <p>{error.message}</p>
                  {error.hint && (
                    <p className="mt-0.5 text-destructive/70">{error.hint}</p>
                  )}
                </div>
              </div>
            )}

            <label className="flex shrink-0 cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-accent/20 focus-within:ring-2 focus-within:ring-ring/40">
              <div className="min-w-0">
                <p className="text-xs font-medium">Use file content context</p>
                <p className="text-caption text-muted-foreground/70">
                  Reads up to 1,000 characters per supported file. Content is sent to your selected AI provider.
                </p>
              </div>
              <Checkbox
                checked={useFileContent}
                onCheckedChange={(checked) => {
                  const enabled = checked === true
                  setUseFileContent(enabled)
                  setAutoRenameUseFileContent(enabled)
                }}
              />
            </label>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {loading && (
                <Button
                  onClick={cancelRename}
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 rounded-xl text-xs"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
              <Button
                onClick={handleGenerate}
                disabled={loading || providerMissing || selectedCount === 0}
                className="gap-1.5"
                size="sm"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {loading ? "Generating..." : "Generate Renames"}
              </Button>
              {entries.length === 0 && selectedCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {selectedCount} of {files.length} file{files.length !== 1 ? "s" : ""} selected
                </span>
              )}
              {entries.length > 0 && (
                <>
                  <span className="text-xs text-muted-foreground">
                    {changedCount} change{changedCount !== 1 ? "s" : ""} suggested
                    {approvedCount !== changedCount ? ` · ${approvedCount} approved` : ""}
                  </span>
                  <div className="flex-1" />
                  {changedCount > 0 && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={() =>
                          setEntries((prev) => prev.map((e) => ({ ...e, approved: true, error: undefined })))
                        }
                        variant="ghost"
                        size="xs"
                      >
                        Approve all
                      </Button>
                      <Button
                        type="button"
                        onClick={() =>
                          setEntries((prev) =>
                            prev.map((e) => ({
                              ...e,
                              approved: false,
                              error: undefined,
                            })),
                          )
                        }
                        variant="ghost"
                        size="xs"
                      >
                        Reject all
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* File selection list (before generation) */}
            {entries.length === 0 && (
              <>
                <div className="flex shrink-0 items-center gap-3">
                  <Button
                    type="button"
                    onClick={selectAll}
                    variant="ghost"
                    size="xs"
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    onClick={deselectAll}
                    variant="ghost"
                    size="xs"
                  >
                    Deselect all
                  </Button>
                </div>
                <ScrollArea className="min-h-32 flex-1 rounded-lg border">
                  <div className="grid grid-cols-1 gap-px bg-border/30 md:grid-cols-2">
                    {files.map((file) => {
                      const isSelected = selectedPaths.has(file.path)
                      return (
                        <Button
                          type="button"
                          key={file.path}
                          aria-pressed={isSelected}
                          aria-label={`${isSelected ? "Deselect" : "Select"} ${file.name}`}
                          variant="ghost"
                          className={cn("h-auto min-w-0 justify-start rounded-none px-3 py-2 text-left whitespace-normal", !isSelected && "opacity-40")}
                          onClick={() => toggleSelected(file.path)}
                        >
                          <FileTypeIcon
                            extension={file.extension}
                            className="size-7 shrink-0 rounded-md"
                            iconClassName="size-3.5"
                          />
                          <div
                            className={cn(
                              "shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                              isSelected
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-muted-foreground/30"
                            )}
                          >
                            {isSelected && <Check className="h-2.5 w-2.5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate leading-tight">
                              {file.name}
                            </p>
                          </div>
                        </Button>
                      )
                    })}
                  </div>
                </ScrollArea>
              </>
            )}

            {/* Rename review list (after generation) */}
            {entries.length > 0 && (
              <ScrollArea className="min-h-32 flex-1 rounded-lg border">
                <div className="grid grid-cols-1 gap-px bg-border/30 md:grid-cols-2">
                  {entries.map((entry, i) => {
                    const isChanged = entry.newName !== entry.file.name
                    return (
                      <div
                        key={entry.file.path}
                        className={cn(
                          "flex min-w-0 items-center gap-2.5 bg-background px-3 py-2",
                          !isChanged && "opacity-40"
                        )}
                      >
                        <FileTypeIcon
                          extension={entry.file.extension}
                          className="size-7 shrink-0 rounded-md"
                          iconClassName="size-3.5"
                        />
                        <Checkbox
                          onCheckedChange={() => isChanged && toggleApproved(i)}
                          disabled={!isChanged}
                          aria-label={entry.approved ? `Reject rename for ${entry.file.name}` : `Approve rename for ${entry.file.name}`}
                          checked={entry.approved && isChanged}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-caption text-muted-foreground/50 truncate line-through leading-tight">
                            {entry.file.name}
                          </p>
                          <Input
                            value={entry.newName}
                            onChange={(event) => updateEntryName(i, event.target.value)}
                            onBlur={() => normalizeEntryName(i)}
                            onFocus={(event) => event.currentTarget.select()}
                            aria-label={`New filename for ${entry.file.name}`}
                            spellCheck={false}
                            className="h-6 min-w-0 px-1 text-xs"
                          />
                          {entry.error && (
                            <p className="text-micro text-destructive mt-0.5">{entry.error}</p>
                          )}
                        </div>
                        {isChanged && (
                          <Button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEntries((prev) =>
                                prev.map((e, idx) =>
                                  idx === i
                                    ? { ...e, newName: e.file.name, approved: false, error: undefined }
                                    : e,
                                ),
                              )
                            }}
                            aria-label={`Keep original filename for ${entry.file.name}`}
                            variant="ghost"
                            size="icon-xs"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          {entries.length > 0 && (
            <DialogFooter className="m-0 shrink-0 rounded-none border-t px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={applying}>
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={approvedCount === 0 || applying}
                className="gap-1.5"
                size="sm"
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {applying ? "Applying..." : `Apply ${approvedCount} Rename${approvedCount !== 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
