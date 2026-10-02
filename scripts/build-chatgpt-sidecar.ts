/// <reference types="node" />
import { execFileSync, spawnSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE
  ?? execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim()

const bunTargets: Record<string, string> = {
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "aarch64-pc-windows-msvc": "bun-windows-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
}

const bunTarget = bunTargets[targetTriple]
if (!bunTarget) {
  throw new Error(`No Bun sidecar target mapping for Rust target ${targetTriple}`)
}

await mkdir(join("src-tauri", "binaries"), { recursive: true })
const output = join(
  "src-tauri",
  "binaries",
  `focal-chatgpt-${targetTriple}${bunTarget.includes("windows") ? ".exe" : ""}`,
)
const result = spawnSync(process.execPath, [
  "build",
  "--compile",
  `--target=${bunTarget}`,
  "server/local.ts",
  "--outfile",
  output,
], { stdio: "inherit" })

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
