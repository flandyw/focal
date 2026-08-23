import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { join } from "@tauri-apps/api/path"
import { toast } from "sonner"
import type { AssessmentResult, Project, ProjectChecklistItem, ProjectPlanningSettings, ProjectTemplate, StudyCard, DeadlineType, Unit } from "@/lib/types"
import { sanitiseFolderName, generateId, sortProjectsByDeadline, isRecord, safeString, safeStringOpt, safeBool, safeBoolOpt, safeDateMeta, safeStringArray } from "@/lib/utils"
import { DEFAULT_SUBFOLDERS } from "@/lib/types"
import { usePersistedData } from "@/lib/hooks/usePersistedData"
import { useLatestRef } from "@/lib/hooks/useLatestRef"
import { recordLocalSoftDelete, recordLocalUpsert } from "@/lib/sync/engine"
import { copyFileMetadataPrefix, moveFileMetadataPrefix } from "@/lib/fileMetadata"
import { setCachedPreference } from "@/lib/storage/preferences"

export type ProjectSortKey = "deadline" | "name" | "created-newest" | "created-oldest" | "fileCount"

export function sortProjects(projects: Project[], sortKey: ProjectSortKey, fileCounts: Record<string, number>): Project[] {
  const sorted = [...projects]
  switch (sortKey) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name))
      break
    case "created-newest":
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      break
    case "created-oldest":
      sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      break
    case "fileCount":
      sorted.sort((a, b) => (fileCounts[b.id] ?? 0) - (fileCounts[a.id] ?? 0))
      break
    case "deadline":
    default:
      return sortProjectsByDeadline(projects)
  }
  return sorted
}

const TEMPLATES_KEY = "focal-project-templates"

function getStoredTemplates(): ProjectTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is ProjectTemplate => typeof t === "object" && t !== null && typeof (t as ProjectTemplate).id === "string") : []
  } catch {
    return []
  }
}

function saveTemplates(templates: ProjectTemplate[]) {
  setCachedPreference(TEMPLATES_KEY, JSON.stringify(templates), false)
}

const VALID_UNITS: readonly string[] = ["1", "2", "3", "4"]
const VALID_DEADLINE_TYPES: readonly string[] = ["sac", "exam", "assignment"]

function normalisePlanning(value: unknown): ProjectPlanningSettings | undefined {
  if (!isRecord(value)) return undefined
  const estimatedMinutes = Number(value.estimatedMinutes)
  const sessionMinutes = Number(value.sessionMinutes)
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return undefined
  return {
    estimatedMinutes: Math.min(1_000_000, Math.round(estimatedMinutes)),
    sessionMinutes: Number.isFinite(sessionMinutes) && sessionMinutes >= 15
      ? Math.min(180, Math.round(sessionMinutes))
      : 45,
  }
}

function normaliseResults(value: unknown): AssessmentResult[] | undefined {
  if (!Array.isArray(value)) return undefined
  const results = value.flatMap((item): AssessmentResult[] => {
    if (!isRecord(item)) return []
    const score = Number(item.score)
    const maxScore = Number(item.maxScore)
    if (!safeStringOpt(item, "id") || !Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return []
    return [{
      id: safeString(item, "id", ""),
      title: safeString(item, "title", "Result"),
      score: Math.min(maxScore, Math.max(0, score)),
      maxScore,
      completedAt: safeString(item, "completedAt", new Date().toISOString()),
      topics: safeStringArray(item, "topics") ?? [],
      feedback: safeStringOpt(item, "feedback"),
    }]
  })
  return results.length > 0 ? results : undefined
}

function normaliseStudyCards(value: unknown): StudyCard[] | undefined {
  if (!Array.isArray(value)) return undefined
  const cards = value.flatMap((item): StudyCard[] => {
    if (!isRecord(item) || !safeStringOpt(item, "id") || !safeStringOpt(item, "question") || !safeStringOpt(item, "answer")) return []
    const reviewCount = Math.max(0, Math.round(Number(item.reviewCount) || 0))
    return [{
      id: safeString(item, "id", ""),
      question: safeString(item, "question", ""),
      answer: safeString(item, "answer", ""),
      topics: safeStringArray(item, "topics") ?? [],
      sourcePath: safeString(item, "sourcePath", ""),
      sourceName: safeString(item, "sourceName", "Study material"),
      createdAt: safeString(item, "createdAt", new Date().toISOString()),
      reviewCount,
      correctCount: Math.min(reviewCount, Math.max(0, Math.round(Number(item.correctCount) || 0))),
      intervalDays: Math.min(60, Math.max(0, Math.round(Number(item.intervalDays) || 0))),
      dueAt: safeString(item, "dueAt", new Date().toISOString()),
      lastReviewedAt: safeStringOpt(item, "lastReviewedAt"),
    }]
  })
  return cards.length > 0 ? cards : undefined
}

function normaliseProject(raw: unknown): Project {
  const obj = isRecord(raw) ? raw : {}
  const meta = safeDateMeta(obj)
  return {
    id: safeString(obj, "id", `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`),
    name: safeString(obj, "name", "Untitled"),
    description: safeStringOpt(obj, "description"),
    icon: safeStringOpt(obj, "icon"),
    deadline: safeStringOpt(obj, "deadline"),
    folder_path: safeString(obj, "folder_path", "unknown"),
    subjectId: safeStringOpt(obj, "subjectId"),
    unit: VALID_UNITS.includes(String(obj.unit)) ? (obj.unit as Unit) : undefined,
    deadlineType: VALID_DEADLINE_TYPES.includes(String(obj.deadlineType)) ? (obj.deadlineType as DeadlineType) : undefined,
    examDate: safeStringOpt(obj, "examDate"),
    isFavorite: safeBool(obj, "isFavorite", false),
    isArchived: safeBool(obj, "isArchived", false),
    isFinished: safeBool(obj, "isFinished", false),
    isLinked: safeBoolOpt(obj, "isLinked"),
    customSubfolders: safeStringArray(obj, "customSubfolders"),
    notes: safeStringOpt(obj, "notes"),
    dependsOn: safeStringArray(obj, "dependsOn"),
    templateId: safeStringOpt(obj, "templateId"),
    planning: normalisePlanning(obj.planning),
    results: normaliseResults(obj.results),
    studyCards: normaliseStudyCards(obj.studyCards),
    checklist: Array.isArray(obj.checklist)
      ? (obj.checklist as unknown[]).filter((item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).id === "string" && typeof (item as Record<string, unknown>).text === "string"
        ).map((item) => ({ id: item.id as string, text: item.text as string, completed: Boolean(item.completed) }))
      : undefined,
    ...meta,
  }
}

export function useProjects() {
  const { data: projects, loading, error, save: saveProjects, refresh } = usePersistedData({
    fileName: "projects.json",
    normalize: normaliseProject,
    onLoad: (projects) => [...projects].filter((project) => !project.deleted_at).reverse(),
  })

  const projectsRef = useLatestRef(projects)

  const addProject = useCallback(async (name: string, description?: string, icon?: string, deadline?: string, subjectId?: string, unit?: Unit, deadlineType?: DeadlineType, examDate?: string, customSubfolders?: string[], skipDiskCreation?: boolean, folderPathOverride?: string, isLinked?: boolean) => {
    const sanitised = sanitiseFolderName(name)
    const folderPath = folderPathOverride ?? sanitised
    if (!folderPath) {
      throw new Error("Project name cannot be empty after sanitisation")
    }

    const allSubfolders = customSubfolders ? [...DEFAULT_SUBFOLDERS, ...customSubfolders] : DEFAULT_SUBFOLDERS

    const now = new Date().toISOString()
    const project: Project = {
      id: generateId(),
      name,
      description,
      icon,
      deadline,
      created_at: now,
      updated_at: now,
      folder_path: folderPath,
      subjectId,
      unit,
      deadlineType,
      examDate,
      customSubfolders,
      isLinked,
    }
    if (!skipDiskCreation) {
      try {
        await invoke("create_project_with_subfolders", {
          projectName: folderPath,
          subfolders: allSubfolders,
        })
      } catch (e) {
        console.warn("Could not create project folder on disk:", e)
        throw e
      }
    }
    const updated = [...projectsRef.current, project]
    await saveProjects(updated)
    projectsRef.current = updated
    await recordLocalUpsert("projects", project)
    return project
  }, [projectsRef, saveProjects])

  const updateProject = useCallback(async (
    id: string,
    updates: Partial<Omit<Project, "id" | "created_at">>
  ) => {
    const updated = projectsRef.current.map((p) =>
      p.id === id
        ? { ...p, ...updates, updated_at: new Date().toISOString() }
        : p
    )
    await saveProjects(updated)
    const project = updated.find((p) => p.id === id)
    if (project) await recordLocalUpsert("projects", project)
  }, [projectsRef, saveProjects])

  const renameProjectFolder = useCallback(async (id: string, newName: string) => {
    const current = projectsRef.current.find((p) => p.id === id)
    if (!current) throw new Error("Project not found")

    const sanitised = sanitiseFolderName(newName)
    if (!sanitised) throw new Error("Invalid folder name")
    if (sanitised === current.folder_path) return

    try {
      await invoke("rename_project_folder", {
        oldName: current.folder_path,
        newName: sanitised,
      })
    } catch (e) {
      console.warn("Failed to rename project folder on disk:", e)
      throw e
    }

    try {
      const projectsDir = await invoke<string>("get_projects_directory")
      await moveFileMetadataPrefix(
        await join(projectsDir, current.folder_path),
        await join(projectsDir, sanitised),
      )
    } catch (metadataError) {
      console.warn("Project folder renamed but file metadata could not be moved:", metadataError)
      toast.warning("Assessment folder renamed, but some file tags or favorites may need to be restored.")
    }

    const updated = projectsRef.current.map((p) =>
      p.id === id
        ? { ...p, folder_path: sanitised, updated_at: new Date().toISOString() }
        : p
    )
    await saveProjects(updated)
    const project = updated.find((p) => p.id === id)
    if (project) await recordLocalUpsert("projects", project)
  }, [projectsRef, saveProjects])

  const changeProjectFolder = useCallback(async (id: string, newFolderPath: string) => {
    const current = projectsRef.current.find((p) => p.id === id)
    if (!current) throw new Error("Project not found")
    if (newFolderPath === current.folder_path) return

    const updated = projectsRef.current.map((p) =>
      p.id === id
        ? { ...p, folder_path: newFolderPath, isLinked: true, updated_at: new Date().toISOString() }
        : p
    )
    await saveProjects(updated)
    const project = updated.find((p) => p.id === id)
    if (project) await recordLocalUpsert("projects", project)
  }, [projectsRef, saveProjects])

  const deleteProject = useCallback(async (id: string) => {
    const updated = projectsRef.current.filter((p) => p.id !== id)
    await recordLocalSoftDelete("projects", id)
    await saveProjects(updated)
  }, [projectsRef, saveProjects])

  const restoreProject = useCallback(async (project: Project) => {
    const exists = projectsRef.current.some((p) => p.id === project.id)
    if (exists) return
    const restored = { ...project, deleted_at: null, updated_at: new Date().toISOString() }
    const updated = [...projectsRef.current, restored]
    await saveProjects(updated)
    await recordLocalUpsert("projects", restored)
  }, [projectsRef, saveProjects])

  const linkFolderAsProject = useCallback(async (folderPath: string, isLinked = true) => {
    const rawPath = await invoke<string>("link_folder_as_project", { sourcePath: folderPath })
    const existingPaths = new Set(projectsRef.current.map((p) => p.folder_path))
    if (existingPaths.has(rawPath)) {
      throw new Error(`A project named "${rawPath}" already exists.`)
    }
    const project = await addProject(rawPath, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true, rawPath, isLinked)
    return project
  }, [projectsRef, addProject])

  const scanAndImportProjects = useCallback(async () => {
    const folderNames = await invoke<string[]>("scan_projects_root")
    const existingPaths = new Set(projectsRef.current.map((p) => p.folder_path))
    const created: string[] = []
    const skipped: string[] = []
    const failed: string[] = []
    for (const name of folderNames) {
      if (existingPaths.has(name)) {
        skipped.push(name)
        continue
      }
      try {
        await addProject(name, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true, name, false)
        created.push(name)
      } catch (e) {
        console.warn(`Failed to import project from folder "${name}":`, e)
        failed.push(name)
      }
    }
    return { created, skipped, failed }
  }, [projectsRef, addProject])

  const addCustomSubfolder = useCallback(async (id: string, folderName: string) => {
    const sanitised = sanitiseFolderName(folderName)
    if (!sanitised) {
      throw new Error("Folder name cannot be empty after sanitisation")
    }

    const project = projectsRef.current.find((p) => p.id === id)
    if (!project) {
      throw new Error("Project not found")
    }

    const existingFolders = [...DEFAULT_SUBFOLDERS, ...(project.customSubfolders ?? [])]
    if (existingFolders.includes(sanitised)) {
      throw new Error("Folder already exists")
    }

    try {
      await invoke("create_project_with_subfolders", {
        projectName: project.folder_path,
        subfolders: [sanitised],
      })
    } catch (e) {
      console.warn("Could not create folder on disk:", e)
    }

    const updated = projectsRef.current.map((p) =>
      p.id === id
        ? { ...p, customSubfolders: [...(p.customSubfolders ?? []), sanitised], updated_at: new Date().toISOString() }
        : p
    )
    await saveProjects(updated)
    const updatedProject = updated.find((p) => p.id === id)
    if (updatedProject) await recordLocalUpsert("projects", updatedProject)
  }, [projectsRef, saveProjects])

  const removeCustomSubfolder = useCallback(async (id: string, folderName: string) => {
    const project = projectsRef.current.find((p) => p.id === id)
    if (!project) {
      throw new Error("Project not found")
    }

    const currentSubfolders = project.customSubfolders ?? []
    if (!currentSubfolders.includes(folderName)) {
      throw new Error("Folder not found in custom subfolders")
    }

    const updated = projectsRef.current.map((p) =>
      p.id === id
        ? { ...p, customSubfolders: currentSubfolders.filter((f) => f !== folderName), updated_at: new Date().toISOString() }
        : p
    )
    await saveProjects(updated)
    const updatedProject = updated.find((p) => p.id === id)
    if (updatedProject) await recordLocalUpsert("projects", updatedProject)
  }, [projectsRef, saveProjects])

  const duplicateProject = useCallback(async (id: string) => {
    const source = projectsRef.current.find((p) => p.id === id)
    if (!source) throw new Error("Project not found")

    const baseName = `${source.name} (Copy)`
    let copyName = baseName
    let counter = 1
    const existingNames = new Set(projectsRef.current.map((p) => p.name))
    while (existingNames.has(copyName)) {
      counter++
      copyName = `${source.name} (Copy ${counter})`
    }

    const sanitised = sanitiseFolderName(copyName)
    if (!sanitised) throw new Error("Could not generate a valid folder name")

    try {
      await invoke("copy_project_folder", {
        sourceName: source.folder_path,
        destName: sanitised,
      })
    } catch (e) {
      console.warn("Could not copy project folder on disk:", e)
      throw e
    }

    try {
      const projectsDir = await invoke<string>("get_projects_directory")
      await copyFileMetadataPrefix(
        await join(projectsDir, source.folder_path),
        await join(projectsDir, sanitised),
      )
    } catch (e) {
      console.warn("Could not copy project file metadata:", e)
      toast.warning("Assessment copied, but some file tags or favorites may need to be restored.")
    }

    const now = new Date().toISOString()
    const project: Project = {
      id: generateId(),
      name: copyName,
      description: source.description,
      icon: source.icon,
      deadline: source.deadline,
      created_at: now,
      updated_at: now,
      folder_path: sanitised,
      subjectId: source.subjectId,
      unit: source.unit,
      deadlineType: source.deadlineType,
      examDate: source.examDate,
      customSubfolders: source.customSubfolders ? [...source.customSubfolders] : undefined,
      checklist: source.checklist ? source.checklist.map((item) => ({ ...item, id: generateId(), completed: false })) : undefined,
      notes: source.notes,
      dependsOn: source.dependsOn ? [...source.dependsOn] : undefined,
      planning: source.planning ? { ...source.planning } : undefined,
    }
    const updated = [...projectsRef.current, project]
    await saveProjects(updated)
    await recordLocalUpsert("projects", project)
    return project
  }, [projectsRef, saveProjects])

  const bulkArchive = useCallback(async (ids: string[]) => {
    const updated = projectsRef.current.map((p) =>
      ids.includes(p.id) ? { ...p, isArchived: true, updated_at: new Date().toISOString() } : p
    )
    await saveProjects(updated)
    await Promise.all(ids.map(async (id) => {
      const project = updated.find((p) => p.id === id)
      if (project) await recordLocalUpsert("projects", project)
    }))
  }, [projectsRef, saveProjects])

  const bulkFinish = useCallback(async (ids: string[]) => {
    const updated = projectsRef.current.map((p) =>
      ids.includes(p.id) ? { ...p, isFinished: true, isArchived: false, updated_at: new Date().toISOString() } : p
    )
    await saveProjects(updated)
    await Promise.all(ids.map(async (id) => {
      const project = updated.find((p) => p.id === id)
      if (project) await recordLocalUpsert("projects", project)
    }))
  }, [projectsRef, saveProjects])

  const bulkDelete = useCallback(async (ids: string[]) => {
    const updated = projectsRef.current.filter((p) => !ids.includes(p.id))
    await Promise.all(ids.map((id) => recordLocalSoftDelete("projects", id)))
    await saveProjects(updated)
  }, [projectsRef, saveProjects])

  const bulkUnarchive = useCallback(async (ids: string[]) => {
    const updated = projectsRef.current.map((p) =>
      ids.includes(p.id) ? { ...p, isArchived: false, updated_at: new Date().toISOString() } : p
    )
    await saveProjects(updated)
    await Promise.all(ids.map(async (id) => {
      const project = updated.find((p) => p.id === id)
      if (project) await recordLocalUpsert("projects", project)
    }))
  }, [projectsRef, saveProjects])

  const addChecklistItem = useCallback(async (projectId: string, text: string) => {
    if (!text.trim()) return
    const project = projectsRef.current.find((p) => p.id === projectId)
    if (!project) throw new Error("Project not found")
    const newItem: ProjectChecklistItem = { id: generateId(), text: text.trim(), completed: false }
    const checklist = [...(project.checklist ?? []), newItem]
    const updated = projectsRef.current.map((p) =>
      p.id === projectId ? { ...p, checklist, updated_at: new Date().toISOString() } : p
    )
    await saveProjects(updated)
    const updatedProject = updated.find((p) => p.id === projectId)
    if (updatedProject) await recordLocalUpsert("projects", updatedProject)
  }, [projectsRef, saveProjects])

  const addChecklistItems = useCallback(async (projectId: string, texts: string[]) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    if (!project) throw new Error("Project not found")

    const existingTexts = new Set(
      (project.checklist ?? []).map((item) => item.text.trim().replace(/\s+/g, " ").toLowerCase()),
    )
    const items = texts
      .map((text) => text.trim())
      .filter((text) => text.length > 0)
      .filter((text, index, values) => {
        const key = text.replace(/\s+/g, " ").toLowerCase()
        return !existingTexts.has(key) && values.findIndex((value) => value.replace(/\s+/g, " ").toLowerCase() === key) === index
      })
      .map((text) => ({ id: generateId(), text, completed: false }))
    if (items.length === 0) return 0

    const updated = projectsRef.current.map((p) =>
      p.id === projectId
        ? { ...p, checklist: [...(p.checklist ?? []), ...items], updated_at: new Date().toISOString() }
        : p,
    )
    await saveProjects(updated)
    projectsRef.current = updated
    const updatedProject = updated.find((p) => p.id === projectId)
    if (updatedProject) await recordLocalUpsert("projects", updatedProject)
    return items.length
  }, [projectsRef, saveProjects])

  const toggleChecklistItem = useCallback(async (projectId: string, itemId: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    if (!project?.checklist) return
    const checklist = project.checklist.map((item) =>
      item.id === itemId ? { ...item, completed: !item.completed } : item
    )
    const updated = projectsRef.current.map((p) =>
      p.id === projectId ? { ...p, checklist, updated_at: new Date().toISOString() } : p
    )
    await saveProjects(updated)
    const updatedProject = updated.find((p) => p.id === projectId)
    if (updatedProject) await recordLocalUpsert("projects", updatedProject)
  }, [projectsRef, saveProjects])

  const removeChecklistItem = useCallback(async (projectId: string, itemId: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    if (!project?.checklist) return
    const checklist = project.checklist.filter((item) => item.id !== itemId)
    const updated = projectsRef.current.map((p) =>
      p.id === projectId ? { ...p, checklist: checklist.length > 0 ? checklist : undefined, updated_at: new Date().toISOString() } : p
    )
    await saveProjects(updated)
    const updatedProject = updated.find((p) => p.id === projectId)
    if (updatedProject) await recordLocalUpsert("projects", updatedProject)
  }, [projectsRef, saveProjects])

  const addDependency = useCallback(async (projectId: string, dependsOnId: string) => {
    if (projectId === dependsOnId) return
    const project = projectsRef.current.find((p) => p.id === projectId)
    if (!project) throw new Error("Project not found")
    const dependsOn = project.dependsOn ?? []
    if (dependsOn.includes(dependsOnId)) return
    const updated = projectsRef.current.map((p) =>
      p.id === projectId ? { ...p, dependsOn: [...dependsOn, dependsOnId], updated_at: new Date().toISOString() } : p
    )
    await saveProjects(updated)
    const updatedProject = updated.find((p) => p.id === projectId)
    if (updatedProject) await recordLocalUpsert("projects", updatedProject)
  }, [projectsRef, saveProjects])

  const removeDependency = useCallback(async (projectId: string, dependsOnId: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    if (!project?.dependsOn) return
    const dependsOn = project.dependsOn.filter((d) => d !== dependsOnId)
    const updated = projectsRef.current.map((p) =>
      p.id === projectId ? { ...p, dependsOn: dependsOn.length > 0 ? dependsOn : undefined, updated_at: new Date().toISOString() } : p
    )
    await saveProjects(updated)
    const updatedProject = updated.find((p) => p.id === projectId)
    if (updatedProject) await recordLocalUpsert("projects", updatedProject)
  }, [projectsRef, saveProjects])

  const getDependencyProjects = useCallback((projectId: string): Project[] => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    if (!project?.dependsOn) return []
    return projectsRef.current.filter((p) => project.dependsOn!.includes(p.id))
  }, [projectsRef])

  const getDependentsOfProject = useCallback((projectId: string): Project[] => {
    return projectsRef.current.filter((p) => p.dependsOn?.includes(projectId))
  }, [projectsRef])

  const getTemplates = useCallback((): ProjectTemplate[] => {
    return getStoredTemplates()
  }, [])

  const saveAsTemplate = useCallback((projectId: string, templateName: string) => {
    const project = projectsRef.current.find((p) => p.id === projectId)
    if (!project) throw new Error("Project not found")
    const templates = getStoredTemplates()
    const template: ProjectTemplate = {
      id: generateId(),
      name: templateName || project.name,
      description: project.description,
      icon: project.icon,
      subjectId: project.subjectId,
      unit: project.unit,
      deadlineType: project.deadlineType,
      customSubfolders: project.customSubfolders,
      checklist: project.checklist?.map((item) => ({ text: item.text })),
      created_at: new Date().toISOString(),
    }
    templates.push(template)
    saveTemplates(templates)
    return template
  }, [projectsRef])

  const deleteTemplate = useCallback((templateId: string) => {
    const templates = getStoredTemplates().filter((t) => t.id !== templateId)
    saveTemplates(templates)
  }, [])

  const loadFromTemplate = useCallback(async (templateId: string) => {
    const template = getStoredTemplates().find((t) => t.id === templateId)
    if (!template) throw new Error("Template not found")
    const project = await addProject(
      template.name,
      template.description,
      template.icon,
      undefined,
      template.subjectId,
      template.unit,
      template.deadlineType,
      undefined,
      template.customSubfolders,
      false,
      undefined,
      false,
    )
    // Copy checklist items from template
    if (template.checklist && template.checklist.length > 0) {
      const checklist: ProjectChecklistItem[] = template.checklist.map((item) => ({
        id: generateId(),
        text: item.text,
        completed: false,
      }))
      const updatedProject = { ...project, checklist, updated_at: new Date().toISOString() }
      const updated = projectsRef.current.map((p) => p.id === project.id ? updatedProject : p)
      await saveProjects(updated)
      await recordLocalUpsert("projects", updatedProject)
      return updatedProject
    }
    return project
  }, [addProject, projectsRef, saveProjects])

  return {
    projects,
    loading,
    error,
    addProject,
    updateProject,
    renameProjectFolder,
    changeProjectFolder,
    deleteProject,
    restoreProject,
    duplicateProject,
    bulkArchive,
    bulkFinish,
    bulkDelete,
    bulkUnarchive,
    addCustomSubfolder,
    removeCustomSubfolder,
    addChecklistItem,
    addChecklistItems,
    toggleChecklistItem,
    removeChecklistItem,
    addDependency,
    removeDependency,
    getDependencyProjects,
    getDependentsOfProject,
    getTemplates,
    saveAsTemplate,
    deleteTemplate,
    loadFromTemplate,
    scanAndImportProjects,
    linkFolderAsProject,
    refresh,
  }
}
