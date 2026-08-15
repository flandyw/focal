import { strict as assert } from "node:assert"
import { getSearchNavigationIndex } from "../src/lib/searchNavigation.ts"

assert.equal(getSearchNavigationIndex("ArrowDown", -1, 8), 0)
assert.equal(getSearchNavigationIndex("ArrowDown", 7, 8), 0)
assert.equal(getSearchNavigationIndex("ArrowUp", 0, 8), 7)
assert.equal(getSearchNavigationIndex("Home", 5, 8), 0)
assert.equal(getSearchNavigationIndex("End", 1, 8), 7)
assert.equal(getSearchNavigationIndex("PageDown", 2, 8), 7)
assert.equal(getSearchNavigationIndex("PageUp", 7, 8), 2)
assert.equal(getSearchNavigationIndex("ArrowDown", 0, 0), null)
assert.equal(getSearchNavigationIndex("Enter", 0, 8), null)

process.stdout.write("UI navigation checks passed\n")
