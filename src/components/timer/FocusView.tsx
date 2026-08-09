import { useEffect, useMemo, useRef, type RefObject } from "react";
import {
  BookOpen,
  Check,
  Coffee,
  Minimize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Timer,
} from "lucide-react";
import { TitleBar } from "@/components/shell/TitleBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface FocusViewProps {
  running: boolean;
  mode: "work" | "break" | "long-break";
  isStudyOvertime: boolean;
  isFreeStudy: boolean;
  secondsLeft: number;
  totalSeconds: number;
  progress: number;
  timeDisplay: string;
  studyTimeDisplay: string;
  modeLabel: string;
  timerActionLabel: string;
  canStartFocus: boolean;
  saving: boolean;
  cycles: number;
  activeSessionId: string | null;
  subjectLabel: string;
  projectLabel?: string;
  intent: string;
  onIntentChange: (value: string) => void;
  onSearch?: () => void;
  onSettings?: () => void;
  onToggle: () => void;
  onFinish: () => void;
  onReset: () => void;
  onReturnToBreak: () => void;
  onSkipBreak: () => void;
  onStartStudyOvertime: () => void;
  onStartFreeStudy: () => void;
  onMoreBreakTime: () => void;
  onClose: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

function finishTime(secondsLeft: number) {
  return new Date(Date.now() + secondsLeft * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

// eslint-disable-next-line react-refresh/only-export-components -- used by the runnable timer self-check
export function isTimerShortcutTarget(target: EventTarget | null) {
  const tagName = (target as { tagName?: string } | null)?.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "BUTTON";
}

export function FocusView({
  running,
  mode,
  isStudyOvertime,
  isFreeStudy,
  secondsLeft,
  totalSeconds,
  progress,
  timeDisplay,
  studyTimeDisplay,
  modeLabel,
  timerActionLabel,
  canStartFocus,
  saving,
  cycles,
  activeSessionId,
  subjectLabel,
  projectLabel,
  intent,
  onIntentChange,
  onSearch,
  onSettings,
  onToggle,
  onFinish,
  onReset,
  onReturnToBreak,
  onSkipBreak,
  onStartStudyOvertime,
  onStartFreeStudy,
  onMoreBreakTime,
  onClose,
  closeButtonRef,
}: FocusViewProps) {
  const fallbackCloseRef = useRef<HTMLButtonElement | null>(null);
  const resolvedCloseRef = closeButtonRef ?? fallbackCloseRef;
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const isFocus = mode === "work" || (isStudyOvertime && (!isFreeStudy || running));
  const safeProgress = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  const progressPercent = Math.round(safeProgress * 100);
  const projectedFinish = useMemo(
    () => finishTime(isStudyOvertime ? 0 : secondsLeft),
    [isStudyOvertime, secondsLeft],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const focusTimeout = window.setTimeout(() => primaryButtonRef.current?.focus(), 50);
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(focusTimeout);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.code !== "Space" || isTimerShortcutTarget(event.target) || saving) return;
      event.preventDefault();
      onToggle();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, onToggle, saving]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${running || !activeSessionId ? timeDisplay : "Paused"} · ${subjectLabel} · Focal`;
    return () => {
      document.title = previousTitle;
    };
  }, [activeSessionId, running, subjectLabel, timeDisplay]);

  const status = activeSessionId
    ? running
      ? "Logging to calendar"
      : "Paused — calendar stopped"
    : isFocus
      ? "Ready to start"
      : "Break — not logged";

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="Focus timer"
    >
      <TitleBar onSearch={onSearch} onSettings={onSettings}>
        <Button
          ref={resolvedCloseRef}
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Exit focus view"
          title="Exit focus view"
        >
          <Minimize2 />
        </Button>
      </TitleBar>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid min-h-full w-full max-w-5xl place-items-center p-3 sm:p-6 lg:p-10">
          <Card className="w-full max-w-3xl gap-0 py-0">
            <CardHeader className="border-b px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-left">
                  <CardTitle className="truncate font-heading">
                    {subjectLabel}
                  </CardTitle>
                  <CardDescription className="truncate">
                    {projectLabel ?? `${modeLabel} session`}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={activeSessionId ? "success" : "secondary"}>
                    <Timer />
                    {status}
                  </Badge>
                  <Badge variant="outline">Cycle {cycles + 1}</Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col items-center px-5 py-10 text-center sm:px-10 sm:py-14 lg:py-16">
              {!activeSessionId && isFocus && (
                <div className="mb-7 w-full max-w-xl text-left">
                  <label htmlFor="focus-intent" className="mb-2 block text-sm font-medium">
                    Focus outcome
                  </label>
                  <Input
                    id="focus-intent"
                    value={intent}
                    onChange={(event) => onIntentChange(event.target.value)}
                    placeholder="What will be different when this block ends?"
                  />
                </div>
              )}
              <p className="text-sm font-medium text-muted-foreground">
                {modeLabel}
              </p>
              <h1 className="mt-2 font-heading text-7xl font-semibold leading-none tabular-nums tracking-[-0.05em] sm:text-8xl lg:text-9xl">
                {timeDisplay}
              </h1>

              <div className="mt-8 w-full max-w-xl">
                <div
                  role="progressbar"
                  aria-label={`${modeLabel} progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-1000 motion-reduce:transition-none",
                      isFocus ? "bg-primary" : "bg-success",
                    )}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
                  <span>
                    {isFreeStudy
                      ? running
                        ? "Open-ended session"
                        : `Study time ${studyTimeDisplay}`
                      : `${progressPercent}% complete`}
                  </span>
                  <span className="text-right">
                    {isFreeStudy
                      ? running
                        ? "No time limit"
                        : "Break in progress"
                      : isStudyOvertime
                        ? "Open-ended focus"
                      : running
                        ? `Finishes ${projectedFinish}`
                        : `${Math.ceil(totalSeconds / 60)} min block`}
                  </span>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex-col gap-3 p-4 sm:p-5">
              {isFocus ? (
                <div
                  className={cn(
                    "grid w-full grid-cols-1 gap-2",
                    !activeSessionId && "sm:grid-cols-2",
                    activeSessionId && !isStudyOvertime && "sm:grid-cols-2",
                    activeSessionId && isStudyOvertime && !isFreeStudy && "sm:grid-cols-3",
                    activeSessionId && isFreeStudy && "sm:grid-cols-2",
                  )}
                >
                  <Button
                    ref={primaryButtonRef}
                    size="lg"
                    onClick={onToggle}
                    disabled={saving || (!activeSessionId && !canStartFocus)}
                  >
                    {running ? <Pause /> : <Play />}
                    {timerActionLabel}
                  </Button>
                  {!activeSessionId && (
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={onStartFreeStudy}
                      disabled={saving || !canStartFocus}
                    >
                      <Timer />
                      Free study
                    </Button>
                  )}
                  {activeSessionId && (
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={onFinish}
                      disabled={saving}
                    >
                      <Check />
                      Finish &amp; save
                    </Button>
                  )}
                  {isStudyOvertime && !isFreeStudy && (
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={onReturnToBreak}
                      disabled={saving}
                    >
                      <Coffee />
                      Return to break
                    </Button>
                  )}
                </div>
              ) : isFreeStudy ? (
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    ref={primaryButtonRef}
                    size="lg"
                    onClick={onToggle}
                    disabled={saving}
                  >
                    <Play />
                    Continue studying
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={onFinish}
                    disabled={saving}
                  >
                    <Check />
                    Finish &amp; save
                  </Button>
                </div>
              ) : (
                <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button
                    ref={primaryButtonRef}
                    size="lg"
                    onClick={onToggle}
                    disabled={saving}
                  >
                    {running ? <Pause /> : <Coffee />}
                    {running ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={onStartStudyOvertime}
                    disabled={saving || !!activeSessionId || !canStartFocus}
                  >
                    <BookOpen />
                    Keep focusing
                  </Button>
                  <Button size="lg" variant="outline" onClick={onMoreBreakTime}>
                    <Plus />
                    5 min
                  </Button>
                  <Button size="lg" variant="outline" onClick={onSkipBreak}>
                    <SkipForward />
                    Skip
                  </Button>
                </div>
              )}

              <div
                className={cn(
                  "flex w-full flex-col items-center gap-2 border-t pt-3 sm:flex-row",
                  activeSessionId ? "sm:justify-end" : "sm:justify-between",
                )}
              >
                {!activeSessionId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={onReset}
                    disabled={saving}
                  >
                    <RotateCcw />
                    Reset timer
                  </Button>
                )}
                <p className="text-center text-xs text-muted-foreground sm:text-right">
                  Space to{" "}
                  {running
                    ? "pause"
                    : activeSessionId
                      ? isFreeStudy
                        ? "continue studying"
                        : "resume"
                      : isFocus
                        ? "start"
                        : "resume break"}{" "}
                  · Esc to exit
                </p>
              </div>
            </CardFooter>
          </Card>
        </div>
      </main>

      <span className="sr-only" aria-live="polite">
        {status}. {timeDisplay} {isFreeStudy ? "elapsed" : "remaining"}.
      </span>
    </div>
  );
}
