import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <ErrorScreen
        error={this.state.error}
        onReset={this.handleReset}
        onReload={this.handleReload}
      />
    );
  }
}

function ErrorScreen({
  error,
  onReset,
  onReload,
}: {
  error?: Error;
  onReset: () => void;
  onReload: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyDetails = async () => {
    if (!error?.message) return;
    try {
      await navigator.clipboard.writeText(error.stack ?? error.message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background px-6 text-center" role="alert" aria-live="assertive">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The app hit an unexpected error. You can try again, or reload if it persists.
        </p>
        {error?.message && (
          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={() => setShowDetails((current) => !current)} aria-expanded={showDetails}>
              {showDetails ? "Hide technical details" : "Show technical details"}
            </Button>
            {showDetails && (
              <>
                <ScrollArea className="mt-2 max-h-40 rounded-md border bg-muted">
                  <pre className="p-3 text-left font-mono text-xs text-muted-foreground">
                    {error.message}
                  </pre>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => void copyDetails()}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy details"}
                </Button>
              </>
            )}
          </div>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={onReset}>
            Try again
          </Button>
          <Button size="sm" onClick={onReload}>
            <RefreshCw className="h-3.5 w-3.5" />
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}
