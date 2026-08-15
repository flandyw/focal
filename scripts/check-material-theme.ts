import assert from "node:assert/strict"
import { createMaterialTheme, normalizeHexColor } from "../src/lib/materialTheme.ts"
import { hexToHsv, hsvToHex } from "../src/lib/color.ts"

assert.equal(normalizeHexColor("6750A4"), "#6750a4")
assert.equal(normalizeHexColor("#abc"), "#aabbcc")
assert.equal(normalizeHexColor("nope"), null)

for (const color of ["#6750a4", "#006a6a", "#ffffff", "#000000"]) {
  assert.equal(hsvToHex(hexToHsv(color)), color)
}

const light = createMaterialTheme("#6750a4", false)
const dark = createMaterialTheme("#6750a4", true)
assert.match(light["--primary"], /^#[0-9a-f]{6}$/)
assert.notEqual(light["--background"], dark["--background"])
assert.notEqual(light["--primary"], dark["--primary"])
assert.equal(Object.keys(light).length, Object.keys(dark).length)

console.warn("Material theme self-check passed")
