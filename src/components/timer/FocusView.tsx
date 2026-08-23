import { useEffect, useMemo, useRef, type RefObject } from "react";
import {
  BookOpen,
  Check,
  Coffee,
  Flame,
  Minimize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Timer,
} from "lucide-react";
import {
  EXTRA_BREAK_MINUTES,
  formatFocusTime,
  MAX_FOCUS_INTENT_LENGTH,
} from "@/features/timer/model";
import { TitleBar } from "@/components/shell/TitleBar";
import { SubjectPicker } from "@/components/timer/SubjectPicker";
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
import type { Subject } from "@/lib/types";
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
  todayBlocks: number;
  todaySeconds: number;
  dailyGoal: number;
  subjects: Subject[];
  selectedSubjectIds: string[];
  subjectLabel: string;
  projectLabel?: string;
  intent: string;
  onSubjectClick: (subjectId: string) => void;
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
  onAddTime: () => void;
  onManageSubjects?: () => void;
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
  if (!target || typeof target !== "object") return false;
  const element = target as HTMLElement;
  const tagName = typeof element.tagName === "string" ? element.tagName.toLowerCase() : "";
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    tagName === "button" ||
    tagName === "a" ||
    Boolean(element.isContentEditable) ||
    Boolean(element.closest?.('button, a, [role="button"], [role="menuitem"], [contenteditable="true"]'))
  );
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
  todayBlocks,
  todaySeconds,
  dailyGoal,
  subjects,
  selectedSubjectIds,
  subjectLabel,
  projectLabel,
  intent,
  onSubjectClick,
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
  onAddTime,
  onManageSubjects,
  onClose,
  closeButtonRef,
}: FocusViewProps) {
  const fallbackCloseRef = useRef<HTMLButtonElement | null>(null);
  const resolvedCloseRef = closeButtonRef ?? fallbackCloseRef;
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const isFocus = mode === "work" || (isStudyOvertime && (!isFreeStudy || running));
  const safeProgress = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  const progressPercent = Math.round(safeProgress * 100);
  const activeFocus = !!activeSessionId && isFocus;
  const headerTitle = activeFocus ? intent.trim() || "Focus session" : subjectLabel;
  const headerDescription = activeFocus
    ? [subjectLabel, projectLabel].filter(Boolean).join(" · ")
    : projectLabel ?? `${modeLabel} session`;
  const projectedFinish = useMemo(
    () => finishTime(isStudyOvertime ? 0 : secondsLeft),
    [isStudyOvertime, secondsLeft],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const focusTimeout = window.setTimeout(() => primaryButtonRef.current?.focus(), 50);
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(focusTimeout);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (isTimerShortcutTarget(event.target) || saving || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.code === "Space") {
        event.preventDefault();
        onToggle();
      } else if (key === "s" && !event.shiftKey && !isFocus && !isFreeStudy) {
        event.preventDefault();
        onSkipBreak();
      } else if (key === "a" && !event.shiftKey && !isStudyOvertime) {
        event.preventDefault();
        onAddTime();
      } else if (key === "f" && !event.shiftKey && activeSessionId) {
        event.preventDefault();
        onFinish();
      } else if (key === "r" && !event.shiftKey && !activeSessionId) {
        event.preventDefault();
        onReset();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeSessionId, isFocus, isFreeStudy, isStudyOvertime, onAddTime, onClose, onFinish, onReset, onSkipBreak, onToggle, saving]);

  const status = activeSessionId
    ? !isFocus
      ? "Focus save pending"
      : running
        ? "Logging to calendar"
        : "Paused — calendar stopped"
    : isFocus
      ? "Ready to start"
      : "Break — not logged";
  const goalProgress = dailyGoal > 0 ? Math.min(1, todayBlocks / dailyGoal) : 0;
  const goalReached = dailyGoal > 0 && todayBlocks >= dailyGoal;

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
                    {headerTitle}
                  </CardTitle>
                  <CardDescription className="truncate">
                    {headerDescription}
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
                <div className="mb-7 w-full max-w-xl space-y-5 text-left">
                  <SubjectPicker
                    variant="focus"
                    subjects={subjects}
                    selectedSubjectIds={selectedSubjectIds}
                    activeSessionId={null}
                    disabled={saving}
                    onSubjectClick={onSubjectClick}
                    onManageSubjects={onManageSubjects}
                  />
                  <div>
                    <label htmlFor="focus-intent" className="mb-2 block text-sm font-medium">
                      Focus outcome
                    </label>
                    <Input
                      id="focus-intent"
                      value={intent}
                      onChange={(event) => onIntentChange(event.target.value)}
                      placeholder="What will be different when this block ends?"
                      maxLength={MAX_FOCUS_INTENT_LENGTH}
                    />
                    <p className="mt-1 text-right text-micro tabular-nums text-muted-foreground">
                      {intent.length}/{MAX_FOCUS_INTENT_LENGTH}
                    </p>
                  </div>
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

              <div className="mt-6 w-full max-w-xl rounded-xl border bg-muted/40 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Flame className="h-3.5 w-3.5" />
                    Today
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {dailyGoal > 0
                      ? `${Math.min(todayBlocks, dailyGoal)} / ${dailyGoal} blocks`
                      : `${todayBlocks} ${todayBlocks === 1 ? "block" : "blocks"}`}
                    {todaySeconds >= 60 && (
                      <span className="ml-1.5">· {formatFocusTime(todaySeconds)} focused</span>
                    )}
                  </span>
                </div>
                {dailyGoal > 0 && (
                  <>
                    <div
                      role="progressbar"
                      aria-label="Daily goal progress"
                      aria-valuemin={0}
                      aria-valuemax={dailyGoal}
                      aria-valuenow={Math.min(todayBlocks, dailyGoal)}
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
                          goalReached ? "bg-success" : "bg-primary",
                        )}
                        style={{ width: `${Math.round(goalProgress * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                      {goalReached
                        ? "Daily goal reached — well done!"
                        : `${dailyGoal - todayBlocks} ${dailyGoal - todayBlocks === 1 ? "block" : "blocks"} to go`}
                    </p>
                  </>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex-col gap-3 p-4 sm:p-5">
              {isFocus ? (
                <div
                  className={cn(
                    "grid w-full grid-cols-1 gap-2",
                    !activeSessionId && "sm:grid-cols-2",
                    activeSessionId && !isStudyOvertime && "sm:grid-cols-3",
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
                  {activeSessionId && !isStudyOvertime && (
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={onAddTime}
                      disabled={saving}
                    >
                      <Plus />
                      {EXTRA_BREAK_MINUTES} min
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
                    Continue
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
                  {activeSessionId ? (
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={onFinish}
                      disabled={saving}
                    >
                      <Check />
                      Retry save
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={onStartStudyOvertime}
                      disabled={saving || !canStartFocus}
                    >
                      <BookOpen />
                      Keep focusing
                    </Button>
                  )}
                  <Button size="lg" variant="outline" onClick={onAddTime}>
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
                  Space: {" "}
                  {running
                    ? "pause"
                    : activeSessionId
                      ? isFreeStudy
                        ? "continue"
                        : "resume"
                      : isFocus
                        ? "start"
                        : "resume break"}{" "}
                  · A: +{EXTRA_BREAK_MINUTES} min
                  {!isFocus && !isFreeStudy && " · S: skip"}
                  {activeSessionId && " · F: finish"}
                  {!activeSessionId && " · R: reset"}
                  {" · Esc: exit"}
                </p>
              </div>
            </CardFooter>
          </Card>
        </div>
      </main>

      <span className="sr-only" aria-live="polite">
        {status}. {modeLabel}.
      </span>
    </div>
  );
}
