import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"
import { initializeSettingsStorage } from "@/lib/settings"

const root = ReactDOM.createRoot(document.getElementById("root")!)

function renderApp() {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

function renderStartupError(error: unknown) {
  root.render(
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="max-w-md space-y-3 rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="font-display text-lg font-semibold">Focal could not open its local data</h1>
        <p className="text-sm text-muted-foreground">
          Your existing data has not been removed. Restart Focal, and if the problem continues, export the app logs before reinstalling.
        </p>
        <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      </section>
    </main>,
  )
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("design-preview")) {
  if (new URLSearchParams(window.location.search).get("theme") !== "light") {
    document.documentElement.classList.add("dark")
  }
  void import("@/DesignPreview").then(
    ({ DesignPreview }) => root.render(<DesignPreview />),
    renderStartupError,
  )
} else {
  void initializeSettingsStorage().then(renderApp, renderStartupError)
}
