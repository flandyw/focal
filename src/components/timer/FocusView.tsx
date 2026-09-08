import { useEffect, useMemo, useRef, type RefObject } from "react";
import {
  BookOpen,
  Check,
  Coffee,
  Flame,
  ArrowUpRight,
  Target,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        <div className="flex min-h-full w-full flex-col px-5 py-6 sm:px-8 lg:px-[clamp(2rem,4vw,6rem)] lg:py-8">
          <header className="flex items-center justify-between gap-4 border-b border-border/60 pb-5">
            <div className="flex items-center gap-3">
              <span className={cn("flex size-10 items-center justify-center rounded-2xl", isFocus ? "bg-primary/10 text-primary" : "bg-success/10 text-success")}>
                {isFocus ? <Target className="size-5" /> : <Coffee className="size-5" />}
              </span>
              <div>
                <h1 className="font-heading text-lg font-medium tracking-tight">Focus space</h1>
                <p className="text-xs text-muted-foreground">One thing at a time.</p>
              </div>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">Cycle {cycles + 1}</span>
          </header>

          <div className="grid flex-1 items-center gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_clamp(20rem,28vw,30rem)] lg:gap-[clamp(2rem,4vw,5rem)] lg:py-8">
            <section aria-label="Session timer" className="flex min-w-0 flex-col items-center text-center">
              <div className={cn("mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium", isFocus ? "border-primary/20 bg-primary/5 text-primary" : "border-success/20 bg-success/5 text-success")}>
                <span className={cn("size-1.5 rounded-full", running ? "bg-current" : "border border-current")} />
                {modeLabel}{!running && activeSessionId && " · Paused"}
              </div>

              <div className="relative isolate flex aspect-square w-full max-w-[360px] items-center justify-center sm:max-w-[440px] lg:max-w-[min(100%,clamp(20rem,calc(100dvh-30rem),54rem))] [container-type:inline-size]">
                <div aria-hidden="true" className={cn("absolute inset-8 -z-10 rounded-full blur-3xl", isFocus ? "bg-primary/5" : "bg-success/5")} />
                <svg
                  viewBox="0 0 400 400"
                  className="absolute inset-0 size-full -rotate-90"
                  role={isStudyOvertime ? "img" : "progressbar"}
                  aria-label={isStudyOvertime ? "Open-ended session" : `${modeLabel} progress`}
                  aria-valuemin={isStudyOvertime ? undefined : 0}
                  aria-valuemax={isStudyOvertime ? undefined : 100}
                  aria-valuenow={isStudyOvertime ? undefined : progressPercent}
                >
                  <circle cx="200" cy="200" r="190" fill="none" stroke="currentColor" strokeWidth="1" className="text-border" />
                  <circle cx="200" cy="200" r="176" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="1 8" className="text-border" />
                  <circle cx="200" cy="200" r="190" fill="none" stroke="currentColor" strokeWidth="4" pathLength="100" strokeDasharray="100" strokeDashoffset={isStudyOvertime ? 0 : 100 - progressPercent} strokeLinecap="round" className={cn("transition-[stroke-dashoffset] duration-1000 motion-reduce:transition-none", isFocus ? "text-primary" : "text-success")} />
                </svg>
                <div className="max-w-[80%]">
                  <p className="mb-[3cqw] text-[clamp(10px,2cqw,16px)] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    {isStudyOvertime && isFocus ? "Time focused" : "Time remaining"}
                  </p>
                  <p className="font-sans text-[25cqw] font-light leading-none tabular-nums tracking-[-0.065em]" aria-label={`${isStudyOvertime && isFocus ? "Time focused" : "Time remaining"}: ${timeDisplay}`}>
                    {timeDisplay}
                  </p>
                  <p className="mt-[4cqw] text-[clamp(12px,2.5cqw,18px)] text-muted-foreground">
                    {isFreeStudy
                      ? running ? "Find your own rhythm" : `Study time ${studyTimeDisplay}`
                      : isStudyOvertime ? "A little further, at your pace"
                      : running ? `Finishes at ${projectedFinish}` : `${Math.ceil(totalSeconds / 60)} minutes to ${isFocus ? "make room for progress" : "recharge"}`}
                  </p>
                </div>
              </div>

              <div className="mt-8 w-full">
              {isFocus ? (
                <div
                  className="flex w-full flex-wrap justify-center gap-2"
                >
                  <Button
                    ref={primaryButtonRef}
                    size="lg"
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
                    onClick={onToggle}
                    disabled={saving || (!activeSessionId && !canStartFocus)}
                  >
                    {running ? <Pause /> : <Play />}
                    {timerActionLabel}
                  </Button>
                  {!activeSessionId && (
                    <Button
                      size="lg"
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
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
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
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
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
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
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
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
                <div className="flex w-full flex-wrap justify-center gap-2">
                  <Button
                    ref={primaryButtonRef}
                    size="lg"
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
                    onClick={onToggle}
                    disabled={saving}
                  >
                    <Play />
                    Continue
                  </Button>
                  <Button
                    size="lg"
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
                    variant="outline"
                    onClick={onFinish}
                    disabled={saving}
                  >
                    <Check />
                    Finish &amp; save
                  </Button>
                </div>
              ) : (
                <div className="flex w-full flex-wrap justify-center gap-2">
                  <Button
                    ref={primaryButtonRef}
                    size="lg"
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
                    onClick={onToggle}
                    disabled={saving}
                  >
                    {running ? <Pause /> : <Coffee />}
                    {running ? "Pause" : "Resume"}
                  </Button>
                  {activeSessionId ? (
                    <Button
                      size="lg"
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
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
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base"
                      variant="outline"
                      onClick={onStartStudyOvertime}
                      disabled={saving || !canStartFocus}
                    >
                      <BookOpen />
                      Keep focusing
                    </Button>
                  )}
                  <Button size="lg"
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base" variant="outline" disabled={saving} onClick={onAddTime}>
                    <Plus />
                    5 min
                  </Button>
                  <Button size="lg"
                    className="h-12 rounded-full px-5 xl:h-14 xl:px-7 xl:text-base" variant="outline" disabled={saving} onClick={onSkipBreak}>
                    <SkipForward />
                    Skip
                  </Button>
                </div>
              )}

              </div>
              <div className="mt-4 flex min-h-8 items-center justify-center">
                {!activeSessionId ? (
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onReset} disabled={saving}>
                    <RotateCcw className="size-3.5" /> Reset timer
                  </Button>
                ) : (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={cn("size-1.5 rounded-full", running && isFocus ? "bg-success" : "bg-muted-foreground")} />
                    {status}
                  </p>
                )}
              </div>
            </section>

            <aside aria-label="Session details" className="min-w-0 space-y-8 border-t border-border/60 pt-8 lg:border-t-0 lg:border-l lg:pl-[clamp(2rem,3vw,4rem)] lg:pt-0 2xl:py-6 2xl:space-y-10">
              <section>
                <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  <BookOpen className="size-3.5" /> {activeFocus ? "In focus" : isFocus ? "Set your intention" : "Take a breather"}
                </p>
                {!activeSessionId && isFocus ? (
                  <div className="space-y-6">
                    <div>
                      <label htmlFor="focus-intent" className="mb-5 block font-heading text-2xl leading-snug tracking-tight 2xl:text-4xl">
                        What will you make progress on?
                      </label>
                      <Input
                        id="focus-intent"
                        className="h-12 bg-card 2xl:h-14 xl:text-base"
                        value={intent}
                        onChange={(event) => onIntentChange(event.target.value)}
                        placeholder="e.g. Finish practice questions"
                        maxLength={MAX_FOCUS_INTENT_LENGTH}
                        disabled={saving}
                      />
                      <p className="mt-2 text-right text-[10px] tabular-nums text-muted-foreground">{intent.length}/{MAX_FOCUS_INTENT_LENGTH}</p>
                    </div>
                    <SubjectPicker
                      variant="focus"
                      subjects={subjects}
                      selectedSubjectIds={selectedSubjectIds}
                      activeSessionId={null}
                      disabled={saving}
                      onSubjectClick={onSubjectClick}
                      onManageSubjects={onManageSubjects}
                    />
                    {projectLabel && <p className="break-words text-xs text-muted-foreground">{projectLabel}</p>}
                    {!canStartFocus && <p className="text-xs text-muted-foreground">Choose a subject to begin your session.</p>}
                  </div>
                ) : (
                  <div>
                    <h2 className="break-words font-heading text-2xl leading-snug tracking-tight 2xl:text-4xl">
                      {isFocus ? headerTitle : "A little space to reset."}
                    </h2>
                    <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">
                      {isFocus ? headerDescription : "Step away, stretch, or grab some water. Your next block can wait."}
                    </p>
                    {!isFocus && activeSessionId && <p className="mt-3 text-xs text-warning">Your focus session still needs to be saved. Use Retry save below the timer.</p>}
                  </div>
                )}
              </section>

              <section className="border-t border-border/60 pt-6" aria-label="Today's progress">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"><Flame className="size-3.5" /> Today’s progress</p>
                  {goalReached && <Check className="size-4 text-success" aria-label="Daily goal reached" />}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-3xl font-light tabular-nums tracking-tight xl:text-4xl">{todayBlocks}<span className="ml-1 text-base text-muted-foreground">{dailyGoal > 0 ? `/ ${dailyGoal}` : ""}</span></p>
                    <p className="mt-1 text-xs text-muted-foreground">Blocks completed</p>
                  </div>
                  <div>
                    <p className="text-3xl font-light tabular-nums tracking-tight xl:text-4xl">{formatFocusTime(todaySeconds)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Time focused</p>
                  </div>
                </div>
                {dailyGoal > 0 && (
                  <div className="mt-5">
                    <div role="progressbar" aria-label="Daily goal progress" aria-valuemin={0} aria-valuemax={dailyGoal} aria-valuenow={Math.min(todayBlocks, dailyGoal)} className="h-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", goalReached ? "bg-success" : "bg-primary")} style={{ width: `${Math.round(goalProgress * 100)}%` }} />
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {goalReached ? "Daily goal reached. Nicely done." : `${dailyGoal - todayBlocks} more ${dailyGoal - todayBlocks === 1 ? "block" : "blocks"} to your daily goal.`}
                    </p>
                  </div>
                )}
              </section>
              <p className="border-t border-border/60 pt-5 text-xs leading-relaxed text-muted-foreground">
                {isFocus ? "Small steps count. Give this moment your attention." : "Rest is part of the work, too."}
              </p>
            </aside>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span><kbd className="mr-1.5 rounded border px-1.5 py-0.5 font-sans">Space</kbd>{running ? "Pause" : "Start / resume"}</span>
              {!isStudyOvertime && <span><kbd className="mr-1 rounded border px-1 py-0.5 font-sans">A</kbd> +{EXTRA_BREAK_MINUTES} min</span>}
              {!isFocus && !isFreeStudy && <span><kbd className="mr-1 rounded border px-1 py-0.5 font-sans">S</kbd> Skip break</span>}
              {activeSessionId && <span><kbd className="mr-1 rounded border px-1 py-0.5 font-sans">F</kbd> Finish</span>}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="gap-2 text-xs text-muted-foreground">
              Back to workspace <ArrowUpRight className="size-3.5" />
              <kbd className="rounded border px-1 py-0.5 font-sans text-[10px]">Esc</kbd>
            </Button>
          </footer>
        </div>
      </main>

      <span className="sr-only" aria-live="polite">
        {status}. {modeLabel}.
      </span>
    </div>
  );
}
