import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "./ui/button"
import { downloadAppData } from "../lib/storage"

type ErrorBoundaryProps = { children: ReactNode }
type ErrorBoundaryState = { error: Error | null; backupError: string | null; exporting: boolean }

export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, backupError: null, exporting: false }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, backupError: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  private exporting = false

  private exportBackup = async () => {
    // A second click would open another save dialog while the first is still open.
    if (this.exporting) return
    this.exporting = true
    this.setState({ exporting: true })
    try {
      await downloadAppData()
      this.setState({ backupError: null })
    } catch (exportError) {
      console.error(exportError)
      this.setState({ backupError: "Couldn’t export your backup. Try again before reloading." })
    } finally {
      this.exporting = false
      this.setState({ exporting: false })
    }
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    const loadError = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk .+ failed/i.test(this.state.error.message)
    return (
      <div role="alert" className="grid min-h-dvh place-content-center gap-4 p-6 text-center">
        <div className="grid gap-2">
          <h1 className="text-lg font-semibold">{loadError ? "Couldn’t load this page" : "Something went wrong"}</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {loadError
              ? "Focal might have just updated, or your connection dropped out. Check your internet and hit Reload to grab the latest version. You can also export a backup below."
              : "Focal ran into an unexpected snag. Your study data is stored safely on this device, and you can export a backup before reloading."}
          </p>
          {!loadError ? <pre className="max-w-md overflow-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">{this.state.error.message}</pre> : null}
        </div>
        {this.state.backupError ? <p role="alert" className="text-sm text-destructive">{this.state.backupError}</p> : null}
        <div className="flex flex-wrap justify-center gap-2">
          {!loadError ? <Button variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button> : null}
          <Button variant="outline" disabled={this.state.exporting} onClick={this.exportBackup}>{this.state.exporting ? "Exporting…" : "Export backup"}</Button>
          <Button onClick={this.reload}>Reload</Button>
        </div>
      </div>
    )
  }
}
