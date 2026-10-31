import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "./ui/button"
import { downloadAppData, loadAppData } from "../lib/storage"

type ErrorBoundaryProps = { children: ReactNode }
type ErrorBoundaryState = { error: Error | null; backupError: string | null }

export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, backupError: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, backupError: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  private exportBackup = () => {
    try {
      downloadAppData(loadAppData())
      this.setState({ backupError: null })
    } catch (exportError) {
      console.error(exportError)
      this.setState({ backupError: "Could not export your backup. Try again before reloading." })
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
          <h1 className="text-lg font-semibold">{loadError ? "This page couldn't load" : "Something went wrong"}</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {loadError
              ? "Focal may have been updated, or your connection was interrupted. Check your connection, then reload to get the latest version. You can export your saved data below."
              : "Focal hit an unexpected error. Your data is stored locally and is safe — you can export a backup before reloading."}
          </p>
          {!loadError ? <pre className="max-w-md overflow-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">{this.state.error.message}</pre> : null}
        </div>
        {this.state.backupError ? <p role="alert" className="text-sm text-destructive">{this.state.backupError}</p> : null}
        <div className="flex flex-wrap justify-center gap-2">
          {!loadError ? <Button variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button> : null}
          <Button variant="outline" onClick={this.exportBackup}>Export backup</Button>
          <Button onClick={this.reload}>Reload</Button>
        </div>
      </div>
    )
  }
}
