import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  Bell, BellOff, BookOpenCheck, Check, ChevronUp, Coffee, Flag, GraduationCap, LayoutGrid, Pause, Play, Plus,
  RotateCcw, SkipForward, Square, Timer, Volume2, VolumeX, X, Zap,
} from "lucide-react"

import "./eclair-home.css"
import { useTickingNow } from "../hooks/use-ticking-now"
import { TIMER_PRESETS, formatFocusTime, type TimerSettings } from "../lib/study-timer"

export interface EclairPlan { id: string; title: string; detail: string; start: () => void }

export interface EclairHomeProps {
  display: string
  mode: string
  status: string
  running: boolean
  /** 0-100 through the block, or null when the run has no end (free study). */
  progress: number | null
  elapsedSeconds: number
  onBreak: boolean
  free: boolean
  /** Mode and preset are locked mid-block, exactly as on the regular page. */
  locked: boolean
  busy: boolean
  subject: string
  intent: string
  subjects: string[]
  /** A synced session owns the clock, so subject and rhythm are not editable here. */
  shared: boolean
  settings: TimerSettings
  focusSeconds: number
  blocks: number
  plans: EclairPlan[]
  planBlocked: string
  actions: {
    toggle: () => void
    reset: () => void
    finish: () => void
    skipBreak: () => void
    addTime: (minutes: number) => void
    selectMode: (mode: "free" | "work") => void
    preset: (preset: (typeof TIMER_PRESETS)[number]) => void
    setting: (patch: Partial<TimerSettings>) => void
    notifications: () => void
    subject: (value: string) => void
    intent: (value: string) => void
    paper: () => void
    exit: () => void
  }
}

type Tone = "green" | "orange" | "red" | "blue" | "grey" | "teal" | "purple"

/** The Eclair homescreen icon: a glossy tile and a dark pill label. */
function App({ icon, label, tone, onClick, disabled, active }: {
  icon: ReactNode; label: string; tone: Tone; onClick: () => void; disabled?: boolean; active?: boolean
}) {
  return (
    <button aria-pressed={active} className="ecl-app" data-tone={tone} disabled={disabled} onClick={onClick} type="button">
      <span className="ecl-tile">{icon}</span>
      <span className="ecl-label">{label}</span>
    </button>
  )
}

/** Android's stock dialog: dark body, a title rule, a list with radio marks. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="ecl-scrim" onClick={onClose}>
      <div aria-label={title} aria-modal="true" className="ecl-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
        <h2>{title}</h2>
        <div className="ecl-dialog-body">{children}</div>
        <button className="ecl-dialog-cancel" onClick={onClose} type="button">Cancel</button>
      </div>
    </div>
  )
}

function Widget({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return <section className={`ecl-widget ${className}`}>{title ? <h3>{title}</h3> : null}{children}</section>
}

function Toggle({ on, label, icon, onClick }: { on: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button aria-label={label} aria-pressed={on} className="ecl-power" onClick={onClick} type="button">
      {icon}<i data-on={on} />
    </button>
  )
}

const SIGNAL = [4, 7, 10, 13]

function StatusBar({ now, running }: { now: Date; running: boolean }) {
  return (
    <header className="ecl-status">
      <span className="ecl-status-left">{running ? <Timer aria-label="Study timer running" /> : null}</span>
      <svg aria-hidden className="ecl-3g" viewBox="0 0 24 14"><rect height="12" rx="2" width="14" x="0" y="1" /><text x="2" y="10.5">3G</text></svg>
      <svg aria-hidden className="ecl-bars" viewBox="0 0 17 14">{SIGNAL.map((h, i) => <rect height={h} key={h} width="3" x={i * 4.4} y={14 - h} />)}</svg>
      <svg aria-hidden className="ecl-battery" viewBox="0 0 20 14"><rect height="12" rx="2" width="17" x="0" y="1" /><rect height="6" width="2.5" x="17.5" y="4" /><rect className="ecl-charge" height="8" rx="1" width="12" x="2.5" y="3" /></svg>
      <time>{now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })}</time>
    </header>
  )
}

/** The lake: gradients only, so it follows the theme and weighs nothing. */
function Wallpaper() {
  return (
    <svg aria-hidden className="ecl-wallpaper" preserveAspectRatio="xMidYMid slice" viewBox="0 0 360 540">
      <defs>
        <linearGradient id="ecl-sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--ecl-sky-top)" /><stop offset="1" stopColor="var(--ecl-sky-low)" /></linearGradient>
        <linearGradient id="ecl-water" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--ecl-water-top)" /><stop offset=".35" stopColor="var(--ecl-water-mid)" /><stop offset="1" stopColor="var(--ecl-water-deep)" /></linearGradient>
        <linearGradient id="ecl-hills" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--ecl-hill)" /><stop offset="1" stopColor="var(--ecl-hill-low)" /></linearGradient>
      </defs>
      <rect fill="url(#ecl-sky)" height="250" width="360" />
      <rect fill="url(#ecl-water)" height="300" width="360" y="240" />
      <path d="M0 242 L22 236 L58 238 L92 230 L124 240 L170 242 Z" fill="url(#ecl-hills)" />
      <path d="M232 243 L262 240 L296 243 L328 240 L360 242 L360 244 L232 244 Z" fill="url(#ecl-hills)" opacity=".7" />
      <rect fill="var(--ecl-haze)" height="14" opacity=".55" width="360" y="238" />
    </svg>
  )
}

function Dial({ display, mode, progress, elapsedSeconds, onToggle, label }: {
  display: string; mode: string; progress: number | null; elapsedSeconds: number; onToggle: () => void; label: string
}) {
  // Free study has no end, so its ring sweeps once an hour instead.
  const fraction = progress === null ? (elapsedSeconds % 3600) / 3600 : progress / 100
  return (
    <button aria-label={label} className="ecl-dial" onClick={onToggle} type="button">
      <svg aria-hidden viewBox="0 0 200 200">
        <circle className="ecl-face" cx="100" cy="100" r="96" />
        {Array.from({ length: 60 }, (_, i) => {
          const angle = (i * 6 * Math.PI) / 180, long = i % 5 === 0
          return <line className="ecl-tick" key={i} strokeWidth={long ? 2.2 : 1} x1={100 + Math.sin(angle) * (long ? 80 : 84)} x2={100 + Math.sin(angle) * 88} y1={100 - Math.cos(angle) * (long ? 80 : 84)} y2={100 - Math.cos(angle) * 88} />
        })}
        <circle className="ecl-ring-track" cx="100" cy="100" r="72" />
        <circle className="ecl-ring" cx="100" cy="100" pathLength="100" r="72" strokeDasharray={`${Math.max(0.01, fraction * 100)} 100`} transform="rotate(-90 100 100)" />
      </svg>
      <span className="ecl-dial-text" role="timer" aria-label={`${mode}, ${display}`}>
        <b>{display}</b>
        <small>{mode}</small>
      </span>
    </button>
  )
}

export function EclairHome(props: EclairHomeProps) {
  const { actions, settings, busy, shared } = props
  const now = useTickingNow(1000)
  const [page, setPage] = useState(0)
  const [drawer, setDrawer] = useState(false)
  const [picking, setPicking] = useState(false)
  const pages = useRef<HTMLDivElement>(null)

  // Back button: the Escape key closes the topmost thing, then leaves the launcher.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (picking) setPicking(false)
      else if (drawer) setDrawer(false)
      else actions.exit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [actions, drawer, picking])

  const subjectChosen = shared || props.subject.trim() !== ""
  const start = () => (subjectChosen ? actions.toggle() : setPicking(true))
  const toggleLabel = props.running ? "Pause" : shared ? "Resume" : "Start"
  const icons = (
    <>
      <App disabled={busy} icon={props.running ? <Pause /> : <Play />} label={toggleLabel} onClick={start} tone={props.running ? "orange" : "green"} />
      {props.free
        ? <App disabled={busy || (!shared && props.elapsedSeconds === 0)} icon={<Square />} label="Finish" onClick={actions.finish} tone="red" />
        : props.onBreak
          ? <App icon={<SkipForward />} label="Skip break" onClick={actions.skipBreak} tone="blue" />
          : <App icon={<Plus />} label="+5 min" onClick={() => actions.addTime(5)} tone="blue" />}
      <App disabled={busy} icon={<RotateCcw />} label={shared ? "Discard" : "Reset"} onClick={actions.reset} tone="grey" />
      <App disabled={shared} icon={<BookOpenCheck />} label="Subject" onClick={() => setPicking(true)} tone="purple" />
      <App active={props.free} disabled={shared || props.locked || busy} icon={props.free ? <Zap /> : <Coffee />} label={props.free ? "Free study" : "Pomodoro"} onClick={() => actions.selectMode(props.free ? "work" : "free")} tone="teal" />
      <App icon={<GraduationCap />} label="Timed paper" onClick={actions.paper} tone="orange" />
    </>
  )

  return createPortal(
    <div aria-label="Study launcher" className="eclair" role="dialog">
      <Wallpaper />
      <StatusBar now={now} running={props.running} />

      <div className="ecl-pages" onScroll={(event) => setPage(Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth))} ref={pages}>
        <div className="ecl-page">
          <label className="ecl-search">
            <input aria-label="Study intent" maxLength={120} onChange={(event) => actions.intent(event.target.value)} placeholder={props.subject || "What are you studying?"} value={props.intent} />
            <button aria-label="Choose subject" onClick={() => setPicking(true)} type="button"><svg aria-hidden viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.5" /><path d="M15 15l6 6" /></svg></button>
          </label>
          <Dial display={props.display} elapsedSeconds={props.elapsedSeconds} label={`${toggleLabel} timer`} mode={props.mode} onToggle={start} progress={props.progress} />
          <p className="ecl-status-line">{props.subject ? `${props.subject} · ${props.status}` : "Tap Subject to begin"}</p>
          <div className="ecl-grid">{icons}</div>
        </div>

        <div className="ecl-page">
          <Widget title="Today">
            <div className="ecl-stats">
              <div><b>{formatFocusTime(props.focusSeconds)}</b><small>focused</small></div>
              <div><b>{settings.dailyGoal && !props.free ? `${props.blocks}/${settings.dailyGoal}` : props.blocks}</b><small>{props.free ? "sessions" : "blocks"}</small></div>
              <div><b>{settings.workMinutes}/{settings.breakMinutes}m</b><small>rhythm</small></div>
            </div>
            {settings.dailyGoal && !props.free ? <div aria-label="Daily goal" aria-valuemax={settings.dailyGoal} aria-valuenow={Math.min(props.blocks, settings.dailyGoal)} className="ecl-bar" role="progressbar"><i style={{ width: `${Math.min(100, (props.blocks / settings.dailyGoal) * 100)}%` }} /></div> : null}
          </Widget>
          <Widget title={`Up next · ${props.plans.length}`}>
            {props.plans.length ? <ul className="ecl-list">{props.plans.slice(0, 4).map((plan) => (
              <li key={plan.id}>
                <span><b>{plan.title}</b><small>{plan.detail}</small></span>
                <button aria-label={`Start ${plan.title}`} disabled={!!props.planBlocked || busy} onClick={plan.start} type="button"><Play /></button>
              </li>
            ))}</ul> : <p className="ecl-empty">Nothing planned. Plan study from the calendar.</p>}
            {props.planBlocked && props.plans.length ? <p className="ecl-empty">{props.planBlocked}</p> : null}
          </Widget>
        </div>

        <div className="ecl-page">
          <Widget className="ecl-power-bar">
            <Toggle icon={settings.soundEnabled ? <Volume2 /> : <VolumeX />} label="Sound" on={settings.soundEnabled} onClick={() => actions.setting({ soundEnabled: !settings.soundEnabled })} />
            <Toggle icon={settings.notificationsEnabled ? <Bell /> : <BellOff />} label="Notifications" on={settings.notificationsEnabled} onClick={actions.notifications} />
            <Toggle icon={<Coffee />} label="Auto-start breaks" on={settings.autoStartBreak} onClick={() => actions.setting({ autoStartBreak: !settings.autoStartBreak })} />
            <Toggle icon={<Flag />} label="Auto-start focus" on={settings.autoStartFocus} onClick={() => actions.setting({ autoStartFocus: !settings.autoStartFocus })} />
          </Widget>
          <Widget title="Rhythm">
            <ul className="ecl-list">{TIMER_PRESETS.map((preset) => {
              const active = preset.workMinutes === settings.workMinutes && preset.breakMinutes === settings.breakMinutes && preset.longBreakMinutes === settings.longBreakMinutes
              return (
                <li key={preset.id}>
                  <span><b>{preset.label}</b><small>{preset.description}</small></span>
                  <button aria-label={`Use ${preset.label}`} aria-pressed={active} disabled={shared} onClick={() => actions.preset(preset)} type="button">{active ? <Check /> : null}</button>
                </li>
              )
            })}</ul>
          </Widget>
        </div>
      </div>

      <nav aria-label="Home screens" className="ecl-dots">
        {[0, 1, 2].map((index) => (
          <button aria-current={page === index} aria-label={`Screen ${index + 1}`} key={index} onClick={() => pages.current?.scrollTo({ left: index * pages.current.clientWidth, behavior: "smooth" })} type="button" />
        ))}
      </nav>
      <button aria-label="Applications" className="ecl-handle" onClick={() => setDrawer(true)} type="button"><ChevronUp /></button>

      {drawer ? (
        <div aria-label="Applications" className="ecl-drawer" role="dialog">
          <div className="ecl-grid">
            {icons}
            {TIMER_PRESETS.map((preset) => <App disabled={shared} icon={<Timer />} key={preset.id} label={preset.label} onClick={() => { actions.preset(preset); setDrawer(false) }} tone="teal" />)}
            <App icon={<LayoutGrid />} label="Focal" onClick={actions.exit} tone="blue" />
          </div>
          <button aria-label="Close applications" className="ecl-handle" data-open onClick={() => setDrawer(false)} type="button"><X /></button>
        </div>
      ) : null}

      {picking ? (
        <Dialog onClose={() => setPicking(false)} title="Choose subject">
          {props.subjects.map((name) => (
            <button aria-checked={props.subject === name} className="ecl-radio" key={name} onClick={() => { actions.subject(name); setPicking(false) }} role="radio" type="button">
              <span>{name}</span><i data-on={props.subject === name} />
            </button>
          ))}
        </Dialog>
      ) : null}
    </div>,
    document.body,
  )
}
