import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { downloadAppData, loadAppData } from "@/lib/storage"

type ErrorBoundaryProps = { children: ReactNode }
type ErrorBoundaryState = { error: Error | null }

export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  private exportBackup = () => {
    try {
      downloadAppData(loadAppData())
    } catch (exportError) {
      console.error(exportError)
    }
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="grid min-h-dvh place-content-center gap-4 p-6 text-center">
        <div className="grid gap-2">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            ExamTrack hit an unexpected error. Your data is stored locally and is safe — you can export a backup before reloading.
          </p>
          <pre className="max-w-md overflow-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">{this.state.error.message}</pre>
        </div>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={this.exportBackup}>Export backup</Button>
          <Button onClick={this.reload}>Reload</Button>
        </div>
      </div>
    )
  }
}
