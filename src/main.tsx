import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './index.css'
import { AppErrorBoundary } from './components/error-boundary.tsx'
import { applyAppearance } from './lib/appearance.ts'
import App from './App.tsx'
import { registerPwa, watchForUpdates } from './lib/pwa.ts'

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
}

// Match the phone's status bar to the current surface and light/dark theme.
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
const syncThemeColor = () => { if (themeColor) themeColor.content = getComputedStyle(document.documentElement).getPropertyValue('--background').trim() }
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

// Warm the page chunks once the app has settled, so the first visit to each tab doesn't wait on the network.
if (!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) {
  setTimeout(() => {
    const pages = import.meta.glob(['./components/*-page.tsx', './components/{exam,mistake}-sheet.tsx', '!./components/chat-page.tsx'])
    for (const load of Object.values(pages)) void load().catch(() => undefined)
  }, 3000)
}
