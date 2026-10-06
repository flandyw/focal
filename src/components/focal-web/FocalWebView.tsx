import { useEffect } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { openPath, openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { examHost } from "../../../web/src/lib/host"
import ExamsApp from "../../../web/src/App"
import { AppErrorBoundary } from "../../../web/src/components/error-boundary"
import { setSupabaseClient } from "../../../web/src/lib/supabase"
import { supabase } from "@/lib/supabase/client"

setSupabaseClient(supabase)

if (isTauri()) {
  examHost.download = async (blob, name) => {
    const path = await save({ defaultPath: name })
    if (!path) return false
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    return true
  }
  examHost.report = async (html) => {
    const path = await save({ defaultPath: "exam-progress.html", filters: [{ name: "HTML report", extensions: ["html"] }] })
    if (!path) return
    await writeFile(path, new TextEncoder().encode(html))
    await openPath(path)
  }
}

export function FocalWebView() {
  useEffect(() => {
    if (!isTauri()) return
    const openExternal = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!(link instanceof HTMLAnchorElement) || link.target !== "_blank") return
      const url = new URL(link.href)
      if (url.protocol !== "https:" && url.protocol !== "http:") return
      event.preventDefault()
      void openUrl(url.href).catch((error) => toast.error(`Could not open link: ${String(error)}`))
    }
    document.addEventListener("click", openExternal, true)
    return () => document.removeEventListener("click", openExternal, true)
  }, [])
  return (
    <div className="h-full overflow-auto">
      <AppErrorBoundary>
        <ExamsApp embedded />
      </AppErrorBoundary>
    </div>
  )
}
