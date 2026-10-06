import { readRecords } from "./storage/database"
import type { StudySession } from "./types"
import { isTauri } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { openPath, openUrl } from "@tauri-apps/plugin-opener"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { toast } from "sonner"
import { examHost } from "./host"
import { setSupabaseClient } from "./supabase"
import { supabase } from "./supabase/client"
import { setUpdateState, updateActions } from "./update-store"

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

let pending: Update | undefined

updateActions.check = async () => {
  setUpdateState({ status: "checking", error: undefined })
  try {
    pending = (await check()) ?? undefined
    setUpdateState(pending ? { status: "available", version: pending.version, downloaded: 0, total: undefined, speed: 0 } : { status: "uptodate" })
  } catch (error) {
    setUpdateState({ status: "error", error: String(error) })
  }
}

updateActions.download = async () => {
  if (!pending) return
  setUpdateState({ status: "downloading", downloaded: 0, total: undefined, speed: 0 })
  let downloaded = 0
  let last = { time: performance.now(), bytes: 0 }
  try {
    await pending.download((event) => {
      if (event.event === "Started") setUpdateState({ total: event.data.contentLength })
      if (event.event !== "Progress") return
      downloaded += event.data.chunkLength
      const now = performance.now()
      if (now - last.time < 500) return setUpdateState({ downloaded })
      setUpdateState({ downloaded, speed: ((downloaded - last.bytes) * 1000) / (now - last.time) })
      last = { time: now, bytes: downloaded }
    })
    setUpdateState({ status: "ready", speed: 0 })
  } catch (error) {
    setUpdateState({ status: "error", error: String(error) })
  }
}

updateActions.install = async () => {
  if (!pending) return
  setUpdateState({ status: "installing" })
  try {
    await pending.install()
    await relaunch()
  } catch (error) {
    setUpdateState({ status: "error", error: String(error) })
  }
}

if (isTauri() && !import.meta.env.DEV) {
  void updateActions.check().then(() => {
    if (pending) toast(`Focal ${pending.version} is available`, { description: "Download it from Settings → Updates." })
  })
}
