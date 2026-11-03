/// <reference types="node" />
import { execFileSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

if (process.platform !== "darwin") throw new Error("The macOS widget requires Xcode on macOS.")

const root = fileURLToPath(new URL("../src-tauri/", import.meta.url))
const config = JSON.parse(await readFile(join(root, "tauri.conf.json"), "utf8")) as { version: string }
if (!/^\d+\.\d+\.\d+$/.test(config.version)) throw new Error("The widget requires a numeric app version.")

const triple = process.env.TAURI_ENV_TARGET_TRIPLE
  ?? execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim()
const architectures: Record<string, string[]> = {
  "aarch64-apple-darwin": ["arm64"],
  "x86_64-apple-darwin": ["x86_64"],
  "universal-apple-darwin": ["arm64", "x86_64"],
}
const targets = architectures[triple]
if (!targets) throw new Error(`Unsupported macOS widget target: ${triple}`)

const output = join(root, "target/widget/FocalWidget.appex")
await rm(output, { recursive: true, force: true })
await mkdir(join(output, "Contents/MacOS"), { recursive: true })
const sdk = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" }).trim()
const binary = join(output, "Contents/MacOS/FocalWidget")
const helper = join(root, "target/widget/focal-widget-publisher")
// Match Xcode's extension entry point; using Swift's main directly crashes WidgetKit at startup.
for (const arch of targets) {
  execFileSync("xcrun", [
    "swiftc", "-sdk", sdk, "-target", `${arch}-apple-macos14.0`,
    "-parse-as-library", "-application-extension", "-O", "-module-name", "FocalWidget",
    "-Xlinker", "-e", "-Xlinker", "_NSExtensionMain",
    join(root, "widgets/WidgetData.swift"), join(root, "widgets/FocalWidget.swift"), "-o", `${binary}-${arch}`,
  ], { stdio: "inherit" })
  execFileSync("xcrun", [
    "swiftc", "-sdk", sdk, "-target", `${arch}-apple-macos14.0`, "-parse-as-library", "-O",
    join(root, "widgets/WidgetData.swift"), join(root, "widgets/WidgetPublisher.swift"), "-o", `${helper}-${arch}`,
  ], { stdio: "inherit" })
}
execFileSync("xcrun", ["lipo", "-create", ...targets.map((arch) => `${binary}-${arch}`), "-output", binary], { stdio: "inherit" })
execFileSync("xcrun", ["lipo", "-create", ...targets.map((arch) => `${helper}-${arch}`), "-output", helper], { stdio: "inherit" })
await Promise.all(targets.flatMap((arch) => [rm(`${binary}-${arch}`), rm(`${helper}-${arch}`)]))
execFileSync("codesign", ["--force", "--sign", "-", "--options", "runtime", helper], { stdio: "inherit" })

// ponytail: compile with the installed Swift toolchain instead of maintaining an Xcode project.
// Both executables use ad-hoc signatures without provisioning profiles.
await writeFile(join(output, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.andy.focal.widget</string>
  <key>CFBundleName</key><string>FocalWidget</string>
  <key>CFBundleDisplayName</key><string>Focal Widgets</string>
  <key>CFBundleExecutable</key><string>FocalWidget</string>
  <key>CFBundlePackageType</key><string>XPC!</string>
  <key>CFBundleShortVersionString</key><string>${config.version}</string>
  <key>CFBundleVersion</key><string>${config.version}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSExtension</key><dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string>
  </dict>
</dict></plist>
`)
execFileSync("codesign", [
  "--force", "--sign", "-", "--entitlements", join(root, "widgets/Entitlements.plist"), output,
], { stdio: "inherit" })
console.log(`Built ad-hoc signed Focal widget (${targets.join(", ")}, v${config.version}).`)
