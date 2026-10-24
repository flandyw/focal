import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './index.css'
import { AppErrorBoundary } from './components/error-boundary.tsx'
import { applyAppearance } from './lib/appearance.ts'
import App from './App.tsx'
import { registerPwa } from './lib/pwa.ts'

// A chunk from a previous deploy is gone; reload once to pick up the new index.html.
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('chunk-reload')) {
    sessionStorage.setItem('chunk-reload', '1')
    location.reload()
  }
})

// Set before the first render so the chosen accent never flashes in from the default.
applyAppearance()
if (import.meta.env.VITE_DESKTOP) await import("./lib/desktop")
else void registerPwa()

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
