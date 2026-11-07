import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './index.css'
import { AppErrorBoundary } from './components/error-boundary.tsx'
import { applyAppearance } from './lib/appearance.ts'
import App from './App.tsx'
import { registerPwa, watchForUpdates } from './lib/pwa.ts'
import { trackKeyboard } from './lib/mobile.ts'

// A chunk from a previous deploy is gone; refresh the cached shell and reload, at most once a minute to avoid a loop.
window.addEventListener('vite:preloadError', () => {
  if (Date.now() - Number(sessionStorage.getItem('chunk-reload')) > 60_000) {
    sessionStorage.setItem('chunk-reload', String(Date.now()))
    void fetch('/', { cache: 'no-store' }).catch(() => undefined).finally(() => location.reload())
  }
})

// Set before the first render so the chosen accent never flashes in from the default.
applyAppearance()
if (import.meta.env.VITE_DESKTOP) await import("./lib/desktop")
else {
  void registerPwa()
  watchForUpdates()
  trackKeyboard()
}

// Reach the database a round trip sooner on the first sync after launch.
if (import.meta.env.VITE_SUPABASE_URL) {
  document.head.append(Object.assign(document.createElement('link'), { rel: 'preconnect', href: import.meta.env.VITE_SUPABASE_URL, crossOrigin: 'anonymous' }))
}

// Match the phone's status bar to the current surface and light/dark theme.
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
const syncThemeColor = () => {
  const background = getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
  if (themeColor) themeColor.content = background
  document.documentElement.style.background = background
  try { localStorage.setItem('focal:boot-background', background) } catch { /* The next launch uses the default. */ }
}
syncThemeColor()
new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-surface'] })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light">
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)

// Give startup and sync time to settle, then warm two common next stops instead of every optional page.
const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
if (!connection?.saveData && !/2g|3g/.test(connection?.effectiveType ?? '')) {
  const pages = Object.values(import.meta.glob(['./components/calendar-page.tsx', './components/study-timer-page.tsx']))
  const idle = (next: () => void) => 'requestIdleCallback' in window ? requestIdleCallback(next) : setTimeout(next, 500)
  const warm = () => {
    if (document.hidden) return
    const load = pages.shift()
    if (load) void load().catch(() => undefined).finally(() => idle(warm))
  }
  setTimeout(() => idle(warm), 8000)
}
