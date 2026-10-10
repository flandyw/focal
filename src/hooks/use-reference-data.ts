import { useCallback, useEffect, useState } from "react"

import type { AssessmentReference } from "../lib/exam-data"
import type { ScalingReference } from "../lib/scaling"
import { isTimetable, type Timetable } from "../lib/timetable"
import type { VcaaStudyResources } from "../lib/vcaa-resources"

export type ResourceStatus = "loading" | "ready" | "error"

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url} request failed with ${response.status}`)
  return response.json() as Promise<T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * The fetched JSON is a trust boundary. Every consumer calls `.toLowerCase()`
 * on these names, and a render that throws is not a degraded page, it is a
 * white screen — so a row missing a name is dropped here, once, rather than
 * guarded at each of its dozen call sites.
 */
function usableReferences(value: unknown): AssessmentReference[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is AssessmentReference =>
    isRecord(entry) &&
    text(entry.id) && text(entry.studyName) && text(entry.name) &&
    typeof entry.year === "number" && typeof entry.maxScore === "number" &&
    Array.isArray(entry.gradeBands))
}

function usableStudies(value: unknown): VcaaStudyResources[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is VcaaStudyResources =>
    isRecord(entry) && text(entry.studyName) && Array.isArray(entry.resources))
}

function usableScaling(value: unknown): ScalingReference[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is ScalingReference =>
    isRecord(entry) &&
    text(entry.id) && text(entry.studyName) && typeof entry.year === "number")
}

async function loadTimetableWithStatus(signal: AbortSignal): Promise<Timetable | null> {
  if (typeof fetch === "undefined") return null
  return fetch("/vce-2026-timetable.json", { signal })
    .then((response) => (response.ok ? response.json() : null))
    .then((value: unknown) => (isTimetable(value) ? value : null))
}

export function useReferenceData(needScaling = false) {
  const [reloadToken, setReloadToken] = useState(0)
  const [scalingRequested, setScalingRequested] = useState(needScaling)
  const [references, setReferences] = useState<AssessmentReference[]>([])
  const [referencesGeneratedAt, setReferencesGeneratedAt] = useState<string | null>(null)
  const [referencesStatus, setReferencesStatus] = useState<ResourceStatus>("loading")
  const [resourceStudies, setResourceStudies] = useState<VcaaStudyResources[]>([])
  const [resourcesGeneratedAt, setResourcesGeneratedAt] = useState<string | null>(null)
  const [studiesStatus, setStudiesStatus] = useState<ResourceStatus>("loading")
  const [scalingReferences, setScalingReferences] = useState<ScalingReference[]>([])
  const [scalingStatus, setScalingStatus] = useState<ResourceStatus>("loading")
  const [timetable, setTimetable] = useState<Timetable | null>(null)
  const [timetableStatus, setTimetableStatus] = useState<ResourceStatus>("loading")
  // Latch the first visit so leaving the predictor never aborts or repeats its request.
  if (needScaling && !scalingRequested) setScalingRequested(true)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    // Exams-critical data first: grade distributions unblock the
    // exams/library/VCAA views. Everything else is fetched after idle so
    // first paint + interaction are not blocked parsing ~3MB of JSON.
    const fetchDeferred = (task: () => void) => {
      const win = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }
      if (typeof win.requestIdleCallback === "function") {
        win.requestIdleCallback(task, { timeout: 1500 })
      } else {
        window.setTimeout(task, 0)
      }
    }

    void fetchJson<{ generatedAt?: string; assessments?: AssessmentReference[] }>(
      "/vcaa-grade-distributions.json",
      controller.signal,
    ).then((result) => {
      if (!active) return
      setReferences(usableReferences(result.assessments))
      setReferencesGeneratedAt(typeof result.generatedAt === "string" ? result.generatedAt : null)
      setReferencesStatus("ready")
    }).catch(() => {
      if (active) setReferencesStatus("error")
    })

    fetchDeferred(() => {
      if (!active) return
      void fetchJson<{ generatedAt?: string; studies?: VcaaStudyResources[] }>(
        "/vcaa-exam-resources.json",
        controller.signal,
      ).then((result) => {
        if (!active) return
        setResourceStudies(usableStudies(result.studies))
        setResourcesGeneratedAt(typeof result.generatedAt === "string" ? result.generatedAt : null)
        setStudiesStatus("ready")
      }).catch(() => {
        if (active) setStudiesStatus("error")
      })
    })

    void loadTimetableWithStatus(controller.signal).then((result) => {
      if (!active) return
      setTimetable(result)
      setTimetableStatus(result ? "ready" : "error")
    }).catch(() => {
      if (active) setTimetableStatus("error")
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [reloadToken])

  useEffect(() => {
    if (!scalingRequested) return
    const controller = new AbortController()
    // Keep the result when navigating away so returning needs no fetch or parse.
    void fetchJson<{ references?: ScalingReference[] }>("/vtac-scaling-reports.json", controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setScalingReferences(usableScaling(result.references))
        setScalingStatus("ready")
      }).catch(() => {
        if (!controller.signal.aborted) setScalingStatus("error")
      })
    return () => controller.abort()
  }, [scalingRequested, reloadToken])

  const reload = useCallback(() => {
    setReferencesStatus("loading")
    setStudiesStatus("loading")
    setScalingStatus("loading")
    setTimetableStatus("loading")
    setReloadToken((token) => token + 1)
  }, [])

  return {
    references,
    referencesGeneratedAt,
    referencesStatus,
    resourceStudies,
    resourcesGeneratedAt,
    studiesStatus,
    scalingReferences,
    scalingStatus,
    timetable,
    timetableStatus,
    reload,
  }
}
