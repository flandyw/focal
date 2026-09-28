import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")

// The layout rules this app depends on are CSS classes, so the only way a
// regression shows up is as text in the source. These assertions fail the build
// if someone reintroduces a page-level cap or moves the tablet breakpoint.
test("page frames stay fluid: no max-width wrapper survives", () => {
  const frames = [
    "src/components/workspace-layout.tsx",
    "src/components/sac-timer.tsx",
    "src/components/mistake-alternative-deck.tsx",
  ]
  for (const path of frames) {
    const pageWrapper = read(path)
      .split("\n")
      .filter((line) => /<div className="(mx-auto )?grid w-full/.test(line) || /grid w-full min-w-0/.test(line))
    expect(pageWrapper.length).toBeGreaterThan(0)
    for (const line of pageWrapper) expect(line).not.toContain("max-w-")
  }
})

test("tablets use the navigation sheet so content keeps the full width", () => {
  expect(read("src/hooks/use-mobile.ts")).toContain("const MOBILE_BREAKPOINT = 1024")
})

test("running text is capped at a readable measure instead of the page", () => {
  const css = read("src/index.css")
  expect(css).toContain("[data-slot=\"card-description\"]")
  expect(css).toMatch(/max-width: 68ch/)
})
