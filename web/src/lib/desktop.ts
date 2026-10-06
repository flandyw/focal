import { readRecords } from "../../../src/lib/storage/database"
import type { StudySession } from "../../../src/lib/types"
import { isTauri } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { openPath, openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { examHost } from "./host"
import { setSupabaseClient } from "./supabase"
import { supabase } from "../../../src/lib/supabase/client"

setSupabaseClient(supabase)

if (isTauri()) {
  // Keep local-only history readable without rewriting the retired desktop database.
  examHost.studySessions = async () => {
    const records = await readRecords("study_sessions")
    return records.filter((value): value is StudySession => {
      if (!value || typeof value !== "object") throw new Error("Saved desktop study history is unreadable.")
      const session = value as StudySession
      if (session.deleted_at) return false
      const validBlock = (block: { start: string; end?: string }) => block && Number.isFinite(Date.parse(block.start)) && (block.end === undefined || Number.isFinite(Date.parse(block.end)))
      if (session.schemaVersion !== 2 || typeof session.id !== "string" || typeof session.title !== "string" ||
          !Array.isArray(session.subjectIds) || !session.subjectIds.every((subject) => typeof subject === "string") ||
          !Array.isArray(session.schedule?.blocks) || !session.schedule.blocks.length || !session.schedule.blocks.every(validBlock) ||
          !session.execution || !["planned", "in-progress", "completed"].includes(session.execution.state) ||
          !Array.isArray(session.execution.intervals) || !session.execution.intervals.every(validBlock)) {
        throw new Error("Saved desktop study history is unreadable. The original data has been kept.")
      }
      return true
    })
  }
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

if (isTauri()) {
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null
    if (!(link instanceof HTMLAnchorElement) || link.target !== "_blank") return
    const url = new URL(link.href)
    if (url.protocol !== "https:" && url.protocol !== "http:") return
    event.preventDefault()
    void openUrl(url.href).catch((error) => toast.error(`Could not open link: ${String(error)}`))
  }, true)
}
