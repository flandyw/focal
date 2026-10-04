// ponytail: `tauri.conf.json` carries `// ponytail:` annotations in
// `app.security.csp` — strict `JSON.parse` rejects `//`, and round-tripping
// through `JSON.stringify` would strip them. Mirror the Cargo.toml pattern:
// read as text and regex-replace the top-level `"version"` field.
const fs = require("fs")

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
const tauriPath = "src-tauri/tauri.conf.json"
const tauriText = fs.readFileSync(tauriPath, "utf8")
const cargoTomlPath = "src-tauri/Cargo.toml"
const cargoToml = fs.readFileSync(cargoTomlPath, "utf8")

// Version is derived from the commit count: 593 commits -> 5.9.3.
// ponytail: wraps nothing — the major just keeps growing past 9 (1000 commits -> 10.0.0).
const count = Number(process.argv[2] ?? require("child_process").execSync("git rev-list --count HEAD").toString())
const newVersion = [Math.floor(count / 100), Math.floor(count / 10) % 10, count % 10].join(".")

pkg.version = newVersion

fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
fs.writeFileSync(
  tauriPath,
  // Match the first `"version"` key (top-level in tauri.conf.json).
  tauriText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${newVersion}$2`),
)
fs.writeFileSync(
  cargoTomlPath,
  cargoToml.replace(/^(version\s*=\s*")[^\"]+("\s*)$/m, `$1${newVersion}$2`),
)

console.log(newVersion)
