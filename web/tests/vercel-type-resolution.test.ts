import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

test("Vercel's temporary TS7 config resolves API types outside the project", () => {
  const web = resolve(import.meta.dir, "..")
  const temp = mkdtempSync(join(tmpdir(), "focal-vercel-ts-"))
  try {
    const config = join(temp, "tsconfig.json")
    // Match Vercel's executable emitter: the config extends ours from an unrelated directory.
    writeFileSync(config, JSON.stringify({
      extends: join(web, "tsconfig.json"),
      compilerOptions: { noEmit: true, noCheck: true },
      files: [join(web, "api/chatgpt.ts"), join(web, "api/mistakes-pdf.ts")],
      include: [],
      exclude: [],
    }))
    const result = spawnSync(process.execPath, [join(web, "node_modules/typescript/bin/tsc"), "--project", config], { encoding: "utf8" })
    if (result.error) throw result.error
    expect(`${result.stdout}${result.stderr}`).toBe("")
    expect(result.status).toBe(0)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
