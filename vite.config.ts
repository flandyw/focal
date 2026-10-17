import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { handleMistakesPdf } from './server/mistakes-pdf.js'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
let commitHash = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
if (!commitHash) {
  try {
    commitHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    commitHash = 'unknown'
  }
}

function mistakesPdfPlugin(): Plugin {
  return {
    name: 'mistakes-pdf',
    configureServer(server) {
      server.middlewares.use('/api/mistakes-pdf', async (request, response) => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        const headers = new Headers()
        for (const [name, value] of Object.entries(request.headers)) {
          for (const item of Array.isArray(value) ? value : value ? [value] : []) headers.append(name, item)
        }
        const result = await handleMistakesPdf(new Request('http://localhost/api/mistakes-pdf', {
          method: request.method,
          headers,
          body: new Uint8Array(Buffer.concat(chunks)),
        }))
        response.statusCode = result.status
        result.headers.forEach((value, name) => response.setHeader(name, value))
        response.end(new Uint8Array(await result.arrayBuffer()))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    "import.meta.env.VITE_DESKTOP": JSON.stringify(mode === "desktop"),
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
    "import.meta.env.VITE_COMMIT_HASH": JSON.stringify(commitHash.slice(0, 7)),
  },
  clearScreen: false,
  server: { port: mode === "desktop" ? 1420 : 5173, strictPort: true, host: process.env.TAURI_DEV_HOST ?? false },
  plugins: [react(), tailwindcss(), mistakesPdfPlugin()],
  resolve: {
    dedupe: ['react', 'react-dom', 'katex'],
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    assetsInlineLimit: 4096,
    // ponytail: no manualChunks. Forcing vendor chunks made ai/charts/markdown
    // (~1.4MB) static imports of the entry; natural splitting keeps them lazy.
  },
}))
