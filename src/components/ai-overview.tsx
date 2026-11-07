import { lazy, Suspense, useContext } from "react"
import { AIOverviewContext, useOverviewSettings } from "../lib/ai-overview-state"
import type { OverviewArea } from "../lib/ai-overview"

const AIOverviewContent = lazy(() => import("./ai-overview-content").then((module) => ({ default: module.AIOverviewContent })))

export function AIOverview(props: { area: OverviewArea; subject?: string; fingerprint: string }) {
  const { userId } = useContext(AIOverviewContext)
  const settings = useOverviewSettings()
  if (!userId || !settings.enabled) return null
  return <Suspense fallback={null}><AIOverviewContent key={`${userId}:${props.area}:${props.subject ?? "all"}`} {...props} settings={settings} /></Suspense>
}
