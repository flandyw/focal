import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Link, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AssessmentForm } from "@/components/project/AssessmentForm"
import type { DeadlineType, Project, Subject, Unit } from "@/lib/types"

interface ProjectDialogProps {
  project?: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit?: (data: {
    name: string
    description?: string
    icon?: string
    subjectId?: string
    unit?: Unit
    deadline?: string
    deadlineType?: DeadlineType
  }) => void
  onSubmitEdit?: (id: string, data: {
    name: string
    description?: string
    icon?: string
    subjectId?: string
    unit?: Unit
    deadline?: string
    deadlineType?: DeadlineType
    isFavorite?: boolean
    isArchived?: boolean
    isFinished?: boolean
  }) => void
  onChangeFolder?: (projectId: string) => void
  customSubjects?: Subject[]
  availableSubjects?: Subject[]
}

export function ProjectDialog({
  project,
  open,
  onOpenChange,
  onSubmit,
  onSubmitEdit,
  onChangeFolder,
  customSubjects = [],
  availableSubjects,
}: ProjectDialogProps) {
  const isEditMode = Boolean(project)
  const existingProject = isEditMode ? project! : null

  const handleSubmit = (values: {
    name: string
    description?: string
    icon?: string
    subjectId?: string
    unit?: Unit
    deadline?: string
    deadlineType?: DeadlineType
    isFavorite?: boolean
    isArchived?: boolean
    isFinished?: boolean
  }) => {
    if (existingProject && onSubmitEdit) {
      const { id } = existingProject
      onSubmitEdit(id, values)
    } else {
      onSubmit?.(values)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:max-w-xl sm:p-0">
        <DialogHeader className="gap-0 border-b py-2.5 pl-4 pr-12">
          <DialogTitle className="text-sm">{isEditMode ? "Assessment details" : "New assessment"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEditMode ? "Edit the subject, date and status for this assessment." : "Create a SAC, test, exam or assignment folder to organise your files."}
          </DialogDescription>
        </DialogHeader>
        <AssessmentForm
          key={`${isEditMode ? `edit-${existingProject?.id}` : `new-${open ? "open" : "closed"}`}`}
          customSubjects={customSubjects}
          availableSubjects={availableSubjects}
          initialValues={existingProject ? {
            name: existingProject.name,
            description: existingProject.description,
            icon: existingProject.icon,
            subjectId: existingProject.subjectId,
            unit: existingProject.unit,
            deadline: existingProject.deadline,
            deadlineType: existingProject.deadlineType,
            isFavorite: existingProject.isFavorite,
            isArchived: existingProject.isArchived,
            isFinished: existingProject.isFinished,
          } : undefined}
          submitLabel={isEditMode ? "Save" : "Create"}
          showStatusControls={isEditMode}
          onCancel={() => onOpenChange(false)}
          onSubmit={handleSubmit}
        >
          {existingProject && (
            <div className="grid gap-1">
              <span className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
                Folder{existingProject.isLinked ? " · linked, files stay in place" : ""}
              </span>
              <div className="flex items-center gap-2">
                {existingProject.isLinked && <Link className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs font-mono" title={existingProject.folder_path}>
                  {existingProject.folder_path}
                </code>
                {onChangeFolder && (
                  <Button type="button" variant="outline" size="xs" className="shrink-0" onClick={() => onChangeFolder(existingProject.id)}>
                    <FolderOpen />Change
                  </Button>
                )}
              </div>
            </div>
          )}
        </AssessmentForm>
      </DialogContent>
    </Dialog>
  )
}
