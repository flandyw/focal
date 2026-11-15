import { readRecords } from "./storage/database"
import type { StudySession } from "./types"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { openPath, openUrl } from "@tauri-apps/plugin-opener"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { toast } from "sonner"
import { examHost } from "./host"
import { setSupabaseClient } from "./supabase"
import { supabase } from "./supabase/client"
import { getUpdateState, readOvernightInstall, setUpdateState, updateActions } from "./update-store"

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
    await invoke("stop_chatgpt_sidecar")
    await pending.install()
    await relaunch()
  } catch (error) {
    let message = String(error)
    try {
      await invoke("start_chatgpt_sidecar")
    } catch (restartError) {
      message += `; could not restart the ChatGPT service: ${String(restartError)}`
    }
    setUpdateState({ status: "error", error: message })
  }
}

let lastActivity = Date.now()
for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => { lastActivity = Date.now() }, { capture: true, passive: true })

async function backgroundUpdate() {
  if (getUpdateState().status !== "ready") {
    if (["checking", "downloading", "installing"].includes(getUpdateState().status)) return
    await updateActions.check!()
    if (!pending) return
    await updateActions.download!()
    if (getUpdateState().status !== "ready") return
    toast(`Focal ${pending.version} is ready`, {
      description: readOvernightInstall() ? "It installs overnight, or restart now." : "Restart to finish updating.",
      action: { label: "Restart", onClick: () => void updateActions.install!() },
    })
  }
  // Opt-in: install 2–5 am local time, only after 30 idle minutes, so no one is mid-exam or mid-edit.
  const hour = new Date().getHours()
  if (readOvernightInstall() && hour >= 2 && hour < 5 && Date.now() - lastActivity > 30 * 60_000) await updateActions.install!()
}

if (isTauri() && !import.meta.env.DEV) {
  void backgroundUpdate()
  // Hourly so the 3-hour quiet window is never skipped; once downloaded, ticks make no network request.
  setInterval(() => void backgroundUpdate(), 60 * 60_000)
}
