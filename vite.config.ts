import { defineConfig, mergeConfig } from "vite"
import webConfig from "./web/vite.config.ts"

export default defineConfig(mergeConfig(webConfig, {
  root: "web",
  envDir: "..",
  define: { "import.meta.env.VITE_EMBEDDED_EXAMS": "true" },
  build: { outDir: "../dist", emptyOutDir: true },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: process.env.TAURI_DEV_HOST ?? false },
}))
