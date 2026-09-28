import { useCallback, useEffect, useState } from "react"

import type { AssessmentReference } from "@/lib/exam-data"
import type { ScalingReference } from "@/lib/scaling"
import { isTimetable, type Timetable } from "@/lib/timetable"
import type { VcaaStudyResources } from "@/lib/vcaa-resources"

export type ResourceStatus = "loading" | "ready" | "error"

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url} request failed with ${response.status}`)
  return response.json() as Promise<T>
}

async function loadTimetableWithStatus(signal: AbortSignal): Promise<Timetable | null> {
  if (typeof fetch === "undefined") return null
  return fetch("/vce-2026-timetable.json", { signal })
    .then((response) => (response.ok ? response.json() : null))
    .then((value: unknown) => (isTimetable(value) ? value : null))
}

export function useReferenceData() {
  const [reloadToken, setReloadToken] = useState(0)
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

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    setReferencesStatus("loading")
    setStudiesStatus("loading")
    setScalingStatus("loading")
    setTimetableStatus("loading")

    // Dashboard-critical data first: grade distributions unblock the
    // dashboard/library/VCAA views. Everything else is fetched after idle so
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
      setReferences(Array.isArray(result.assessments) ? result.assessments : [])
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
        setResourceStudies(Array.isArray(result.studies) ? result.studies : [])
        setResourcesGeneratedAt(typeof result.generatedAt === "string" ? result.generatedAt : null)
        setStudiesStatus("ready")
      }).catch(() => {
        if (active) setStudiesStatus("error")
      })

      // Scaling (~1.1MB) is only needed by the predictor, so load it last.
      // Idle first, then also wait until the predictor/view that needs it is
      // likely — here simply a second idle tick keeps startup light.
      fetchDeferred(() => {
        if (!active) return
        void fetchJson<{ references?: ScalingReference[] }>(
          "/vtac-scaling-reports.json",
          controller.signal,
        ).then((result) => {
          if (!active) return
          setScalingReferences(Array.isArray(result.references) ? result.references : [])
          setScalingStatus("ready")
        }).catch(() => {
          if (active) setScalingStatus("error")
        })
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

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

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
