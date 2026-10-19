import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, Bell, BellOff, Coffee, Flag, Home, LogOut, Menu, Pause, Play, RotateCcw, Search, Settings, SkipForward, Square, Timer, Volume2, VolumeX } from "lucide-react"

import "./eclair-home.css"
import { useTickingNow } from "../hooks/use-ticking-now"
import { TIMER_PRESETS, formatFocusTime, type TimerSettings } from "../lib/study-timer"

export interface EclairPlan { id: string; title: string; detail: string; start: () => void }

export interface EclairHomeProps {
  display: string
  mode: string
  status: string
  running: boolean
  /** The number on the readout: seconds left, or seconds counted up. */
  seconds: number
  /** Length of the block, or null when the run counts up (free study, overtime). */
  totalSeconds: number | null
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

/* ------------------------------------------------------------------ */
/* icon art: drawn in the 2.x style, lit from above, one shared palette */
/* ------------------------------------------------------------------ */

function Defs() {
  const linear = (id: string, ...stops: string[]) => (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      {stops.map((color, index) => <stop key={index} offset={index / (stops.length - 1)} stopColor={color} />)}
    </linearGradient>
  )
  return (
    <svg aria-hidden className="ecl-defs">
      <defs>
        {linear("e-chrome", "#ffffff", "#c9cdd1", "#8d9398", "#e4e7e9")}
        {linear("e-steel", "#8e959a", "#3c4247")}
        {linear("e-green", "#c6f06a", "#5fae12", "#2e6b00")}
        {linear("e-orange", "#ffd98a", "#f68a0f", "#b44a00")}
        {linear("e-red", "#ff9d8f", "#e0302a", "#8c1010")}
        {linear("e-blue", "#b9e1ff", "#3a8ee0", "#0c4a91")}
        {linear("e-paper", "#ffffff", "#dcdcd8")}
        {linear("e-wood", "#e2ad73", "#8a5424")}
        {linear("e-glass", "#e9f6ff", "#9cc9e6")}
        {linear("e-sand", "#ffd479", "#e08a1e")}
        {linear("e-cover", "#7fd04b", "#2b7a13")}
        {linear("e-cover2", "#6fb2ff", "#1c4f9c")}
        {linear("e-mug", "#ffffff", "#c9ccce")}
        {linear("e-shine", "rgba(255,255,255,.8)", "rgba(255,255,255,0)")}
        <radialGradient cx=".5" cy=".38" id="e-face" r=".62"><stop offset="0" stopColor="#ffffff" /><stop offset=".8" stopColor="#eef0f1" /><stop offset="1" stopColor="#c4c9cc" /></radialGradient>
        <radialGradient cx=".38" cy=".3" id="e-tomato" r=".75"><stop offset="0" stopColor="#ff9a7a" /><stop offset=".45" stopColor="#e5321c" /><stop offset="1" stopColor="#7d0c04" /></radialGradient>
        <pattern height="6" id="e-check" patternUnits="userSpaceOnUse" width="6"><rect fill="#fafafa" height="6" width="6" /><rect fill="#1c1c1c" height="3" width="3" /><rect fill="#1c1c1c" height="3" width="3" x="3" y="3" /></pattern>
      </defs>
    </svg>
  )
}

type IconName = "start" | "pause" | "finish" | "reset" | "subject" | "pomodoro" | "free" | "paper" | "plus" | "coffee" | "calendar" | "settings" | "preset"

const GEAR = (() => {
  const points: string[] = []
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2, r = i % 4 < 2 ? 19 : 14.5
    points.push(`${(24 + Math.sin(angle) * r).toFixed(2)},${(24 - Math.cos(angle) * r).toFixed(2)}`)
  }
  return points.join(" ")
})()

function Glyph({ name, text }: { name: IconName; text?: string }) {
  const stopwatch = (inner: ReactNode) => (
    <>
      <rect fill="url(#e-chrome)" height="6" rx="1.5" stroke="#6b7176" strokeWidth=".8" width="9" x="19.5" y="2.5" />
      <rect fill="url(#e-steel)" height="4" width="4" x="22" y="7.5" />
      <rect fill="url(#e-chrome)" height="5" rx="1.2" stroke="#6b7176" strokeWidth=".8" transform="rotate(40 38 11)" width="6" x="35" y="8.5" />
      <circle cx="24" cy="27" fill="url(#e-chrome)" r="19" stroke="#5d6368" strokeWidth="1" />
      <circle cx="24" cy="27" fill="url(#e-face)" r="15" stroke="#9aa0a4" strokeWidth=".8" />
      {inner}
      <ellipse cx="24" cy="18" fill="url(#e-shine)" opacity=".7" rx="12" ry="6" />
    </>
  )
  switch (name) {
    case "start": return stopwatch(<path d="M19 18.5 L33 27 L19 35.5 Z" fill="url(#e-green)" stroke="#245500" strokeLinejoin="round" strokeWidth="1" />)
    case "pause": return stopwatch(<><rect fill="url(#e-orange)" height="16" rx="1.5" stroke="#8a3a00" strokeWidth="1" width="5.5" x="17.5" y="19" /><rect fill="url(#e-orange)" height="16" rx="1.5" stroke="#8a3a00" strokeWidth="1" width="5.5" x="25" y="19" /></>)
    case "preset": return stopwatch(<text className="ecl-glyph-text" fill="#30363a" fontSize="12" textAnchor="middle" x="24" y="31.5">{text}</text>)
    case "finish": return (
      <>
        <rect fill="url(#e-steel)" height="40" rx="1.2" width="3.2" x="9" y="6" />
        <circle cx="10.6" cy="5.5" fill="url(#e-chrome)" r="3" stroke="#5d6368" strokeWidth=".8" />
        <path d="M12.2 8 C20 4 26 12 41 7.5 L41 26 C26 30.5 20 22.5 12.2 26.5 Z" fill="url(#e-check)" stroke="#222" strokeWidth="1" />
        <path d="M12.2 8 C20 4 26 12 41 7.5 L41 15 C26 19.5 20 11.5 12.2 15.5 Z" fill="url(#e-shine)" opacity=".55" />
      </>
    )
    case "reset": return (
      <>
        <circle cx="24" cy="24" fill="url(#e-blue)" r="20" stroke="#0a3a73" strokeWidth="1" />
        <path d="M33.5 24 A9.5 9.5 0 1 1 30.7 17.3" fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="4.2" />
        <path d="M27 11.5 L35.5 13.5 L32 21.5 Z" fill="#fff" />
        <ellipse cx="24" cy="13" fill="url(#e-shine)" opacity=".75" rx="14" ry="8" />
      </>
    )
    case "subject": return (
      <>
        <path d="M6 33 L28 27 L42 33 L20 40 Z" fill="url(#e-paper)" stroke="#8b8b85" strokeWidth=".8" />
        <path d="M6 33 L20 40 L20 44 L6 37 Z" fill="url(#e-cover2)" stroke="#123a75" strokeWidth=".8" />
        <path d="M20 40 L42 33 L42 37 L20 44 Z" fill="#e9e9e4" stroke="#8b8b85" strokeWidth=".8" />
        <path d="M7 20 L29 13 L43 20 L21 27 Z" fill="url(#e-cover)" stroke="#1d5a0b" strokeWidth=".9" />
        <path d="M7 20 L21 27 L21 32 L7 25 Z" fill="#2b7a13" stroke="#1d5a0b" strokeWidth=".8" />
        <path d="M21 27 L43 20 L43 25 L21 32 Z" fill="#f4f4ef" stroke="#8b8b85" strokeWidth=".8" />
        <path d="M23 28.5 L42 22.5 M23 30.3 L42 24.2" stroke="#c5c5be" strokeWidth=".6" />
        <path d="M13 19.5 L28 15 L33 17.5 L18 22 Z" fill="url(#e-shine)" opacity=".6" />
      </>
    )
    case "pomodoro": return (
      <>
        <ellipse cx="24" cy="28" fill="url(#e-tomato)" rx="19" ry="16" stroke="#6b0a02" strokeWidth="1" />
        <path d="M24 13 L27 17 L33 15.5 L29 19.5 L32 23 L26.5 21 L24 25 L21.5 21 L16 23 L19 19.5 L15 15.5 L21 17 Z" fill="url(#e-green)" stroke="#245500" strokeLinejoin="round" strokeWidth=".8" />
        <path d="M24 13 C24 9 26 7 28 6" fill="none" stroke="#2e6b00" strokeLinecap="round" strokeWidth="2.4" />
        <ellipse cx="16" cy="25" fill="#fff" opacity=".45" rx="4" ry="2.6" transform="rotate(-30 16 25)" />
      </>
    )
    case "free": return (
      <>
        <rect fill="url(#e-wood)" height="5" rx="1.5" stroke="#5c3412" strokeWidth=".8" width="30" x="9" y="3" />
        <rect fill="url(#e-wood)" height="5" rx="1.5" stroke="#5c3412" strokeWidth=".8" width="30" x="9" y="40" />
        <path d="M13 8 C13 18 22 20 22 24 C22 28 13 30 13 40 L35 40 C35 30 26 28 26 24 C26 20 35 18 35 8 Z" fill="url(#e-glass)" opacity=".9" stroke="#6b8aa0" strokeWidth=".9" />
        <path d="M16.5 14 L31.5 14 C30 18 25 20 24.5 23 L23.5 23 C23 20 18 18 16.5 14 Z" fill="url(#e-sand)" />
        <path d="M24 24 L24 36 M15 40 C16 35 21 33 24 33 C27 33 32 35 33 40 Z" fill="url(#e-sand)" stroke="#e08a1e" strokeWidth="1" />
        <rect fill="url(#e-wood)" height="34" rx="1" width="2.2" x="9.5" y="7" /><rect fill="url(#e-wood)" height="34" rx="1" width="2.2" x="36.3" y="7" />
      </>
    )
    case "paper": return (
      <>
        <path d="M9 4 L31 4 L39 12 L39 44 L9 44 Z" fill="url(#e-paper)" stroke="#8b8b85" strokeWidth=".9" />
        <path d="M31 4 L31 12 L39 12" fill="#d6d6d0" stroke="#8b8b85" strokeWidth=".9" />
        <path d="M13 17 H34 M13 22 H34 M13 27 H30 M13 32 H33 M13 37 H25" stroke="#9ab2c8" strokeWidth="1.4" />
        <g transform="rotate(38 33 30)">
          <rect fill="url(#e-sand)" height="26" stroke="#94590c" strokeWidth=".8" width="6" x="30" y="14" />
          <rect fill="#f2a1a8" height="4" stroke="#a8505a" strokeWidth=".8" width="6" x="30" y="10" />
          <rect fill="url(#e-chrome)" height="2.5" width="6" x="30" y="13" />
          <path d="M30 40 L33 46 L36 40 Z" fill="#f1d3a6" stroke="#94590c" strokeWidth=".8" /><path d="M32.2 44.3 L33 46 L33.8 44.3 Z" fill="#333" />
        </g>
      </>
    )
    case "plus": return (
      <>
        <circle cx="22" cy="24" fill="url(#e-chrome)" r="18" stroke="#5d6368" strokeWidth="1" />
        <circle cx="22" cy="24" fill="url(#e-face)" r="14.5" />
        {Array.from({ length: 12 }, (_, i) => <line key={i} stroke="#555" strokeWidth={i % 3 ? 1 : 2} transform={`rotate(${i * 30} 22 24)`} x1="22" x2="22" y1="11" y2={i % 3 ? 13 : 14.5} />)}
        <path d="M22 24 L22 14.5 M22 24 L29 27" stroke="#222" strokeLinecap="round" strokeWidth="2.2" />
        <circle cx="35" cy="35" fill="url(#e-green)" r="10" stroke="#245500" strokeWidth="1" />
        <text className="ecl-glyph-text" fill="#fff" fontSize="10" textAnchor="middle" x="35" y="38.6">+5</text>
      </>
    )
    case "coffee": return (
      <>
        <ellipse cx="22" cy="41" fill="url(#e-mug)" rx="18" ry="4.5" stroke="#8b8f92" strokeWidth=".9" />
        <path d="M9 18 L35 18 L33 38 C32 41 12 41 11 38 Z" fill="url(#e-mug)" stroke="#8b8f92" strokeWidth=".9" />
        <path d="M34.5 22 C43 21 43 33 33.4 33" fill="none" stroke="#b9bdc0" strokeWidth="3.4" />
        <ellipse cx="22" cy="18" fill="#6b3b17" rx="13" ry="3.2" stroke="#8b8f92" strokeWidth=".9" />
        <path d="M17 13 C15 10 19 8 17 4 M23 13 C21 10 25 8 23 4 M29 13 C27 10 31 8 29 4" fill="none" opacity=".75" stroke="#fff" strokeLinecap="round" strokeWidth="1.8" />
      </>
    )
    case "calendar": return (
      <>
        <rect fill="url(#e-paper)" height="38" rx="3" stroke="#77776f" strokeWidth=".9" width="38" x="5" y="6" />
        <path d="M5 9 A3 3 0 0 1 8 6 L40 6 A3 3 0 0 1 43 9 L43 17 L5 17 Z" fill="url(#e-red)" stroke="#7a0e0e" strokeWidth=".9" />
        <rect fill="url(#e-steel)" height="8" rx="1.5" width="3" x="13" y="2.5" /><rect fill="url(#e-steel)" height="8" rx="1.5" width="3" x="32" y="2.5" />
        <text className="ecl-glyph-text" fill="#2b2b2b" fontSize="19" textAnchor="middle" x="24" y="38">{text}</text>
      </>
    )
    case "settings": return (
      <>
        <polygon fill="url(#e-chrome)" points={GEAR} stroke="#4d5358" strokeLinejoin="round" strokeWidth="1" />
        <circle cx="24" cy="24" fill="url(#e-steel)" r="6.5" stroke="#2c3135" strokeWidth="1" />
        <ellipse cx="24" cy="14" fill="url(#e-shine)" opacity=".6" rx="11" ry="5" />
      </>
    )
  }
}

/** A home-screen shortcut: free-standing art over a small dark label, like the stock launcher. */
function App({ icon, text, label, onClick, disabled, active }: {
  icon: IconName; text?: string; label: string; onClick: () => void; disabled?: boolean; active?: boolean
}) {
  return (
    <button aria-pressed={active} className="ecl-app" disabled={disabled} onClick={onClick} type="button">
      <svg aria-hidden className="ecl-icon" viewBox="0 0 48 48"><Glyph name={icon} text={text} /></svg>
      <span className="ecl-label">{label}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* system chrome                                                       */
/* ------------------------------------------------------------------ */

function StatusBar({ now, running, planned, onShade, onBack, onHome, onMenu }: {
  now: Date; running: boolean; planned: boolean; onShade: () => void; onBack: () => void; onHome: () => void; onMenu: () => void
}) {
  return (
    <header className="ecl-status">
      <button aria-label="Open notifications" className="ecl-status-shade" onClick={onShade} type="button">
        {running ? <Timer aria-hidden /> : null}
        {planned ? <svg aria-hidden className="ecl-status-cal" viewBox="0 0 14 14"><rect height="11" rx="1.5" width="12" x="1" y="2" /><rect className="ecl-status-cal-top" height="3.5" width="12" x="1" y="2" /></svg> : null}
      </button>
      <nav aria-label="Soft keys" className="ecl-softkeys">
        <button aria-label="Back" onClick={onBack} type="button"><ArrowLeft /></button>
        <button aria-label="Menu" onClick={onMenu} type="button"><Menu /></button>
        <button aria-label="Home" onClick={onHome} type="button"><Home /></button>
      </nav>
      <span aria-hidden className="ecl-sys">
        <svg className="ecl-3g" viewBox="0 0 18 14"><rect height="13" rx="2" width="18" y=".5" /><text x="2.2" y="10.6">3G</text></svg>
        <svg className="ecl-bars" viewBox="0 0 17 14">{[4, 7, 10, 13].map((h, i) => <rect height={h} key={h} rx=".5" width="3.2" x={i * 4.5} y={14 - h} />)}</svg>
        <svg className="ecl-battery" viewBox="0 0 22 14"><rect height="12" rx="1.5" width="18" x=".5" y="1" /><rect height="5" rx="1" width="3" x="18.5" y="4.5" /><rect className="ecl-charge" height="9" rx=".8" width="15" x="2" y="2.5" /></svg>
      </span>
      <time>{now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })}</time>
    </header>
  )
}

/** The lake: gradients only, so it follows the theme and weighs nothing. */
function Wallpaper() {
  return (
    <svg aria-hidden className="ecl-wallpaper" preserveAspectRatio="xMidYMid slice" viewBox="0 0 480 640">
      <defs>
        <linearGradient id="ecl-sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--ecl-sky-top)" /><stop offset=".7" stopColor="var(--ecl-sky-mid)" /><stop offset="1" stopColor="var(--ecl-sky-low)" /></linearGradient>
        <linearGradient id="ecl-water" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--ecl-water-top)" /><stop offset=".3" stopColor="var(--ecl-water-mid)" /><stop offset="1" stopColor="var(--ecl-water-deep)" /></linearGradient>
        <linearGradient id="ecl-hills" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--ecl-hill)" /><stop offset="1" stopColor="var(--ecl-hill-low)" /></linearGradient>
        <radialGradient cx=".5" cy=".5" id="ecl-glare" r=".5"><stop offset="0" stopColor="var(--ecl-haze)" stopOpacity=".7" /><stop offset="1" stopColor="var(--ecl-haze)" stopOpacity="0" /></radialGradient>
      </defs>
      <rect fill="url(#ecl-sky)" height="300" width="480" />
      <g className="ecl-stars">{[[40, 40], [120, 90], [210, 30], [300, 70], [380, 25], [440, 110], [90, 160], [260, 140], [350, 180]].map(([x, y]) => <circle cx={x} cy={y} fill="#fff" key={`${x}`} r=".9" />)}</g>
      <rect fill="url(#ecl-water)" height="350" width="480" y="290" />
      <ellipse cx="240" cy="296" fill="url(#ecl-glare)" rx="260" ry="26" />
      <path d="M0 293 L18 286 L40 285 L66 278 L90 283 L118 281 L150 289 L190 292 L0 294 Z" fill="url(#ecl-hills)" />
      <path d="M0 294 L190 292 L150 296 L118 300 L66 302 L18 299 Z" fill="var(--ecl-hill-low)" opacity=".35" />
      <path d="M330 292 L362 288 L392 290 L420 286 L452 289 L480 288 L480 293 Z" fill="url(#ecl-hills)" opacity=".75" />
      {[[300, 318, 6], [345, 330, 3.5], [410, 326, 2.5], [120, 340, 4]].map(([x, y, r]) => (
        <g key={x}><ellipse cx={x} cy={y} fill="var(--ecl-rock)" opacity=".7" rx={r} ry={r * 0.3} /><ellipse cx={x} cy={y + r * 0.45} fill="var(--ecl-rock)" opacity=".25" rx={r * 1.2} ry={r * 0.18} /></g>
      ))}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* the timer widget                                                    */
/* ------------------------------------------------------------------ */

/** A Time Timer face: the wedge and minute hand mark the minutes on the readout, on a 60-minute dial. */
function Dial({ seconds }: { seconds: number }) {
  const clamped = Math.min(seconds, 3599.999)
  const minute = (clamped / 3600) * 360, second = (seconds % 60) * 6
  const rad = (minute * Math.PI) / 180, r = 34
  const wedge = clamped <= 0 ? "" : `M50 50 L50 ${50 - r} A${r} ${r} 0 ${minute > 180 ? 1 : 0} 1 ${50 + Math.sin(rad) * r} ${50 - Math.cos(rad) * r} Z`
  return (
    <svg aria-hidden className="ecl-dial" viewBox="0 0 100 100">
      <circle cx="50" cy="50" fill="url(#e-chrome)" r="48" stroke="#4f555a" strokeWidth=".8" />
      <circle cx="50" cy="50" fill="url(#e-steel)" r="43.5" />
      <circle cx="50" cy="50" fill="url(#e-face)" r="42" />
      {wedge ? <path d={wedge} fill="#e5442f" opacity=".88" /> : null}
      {Array.from({ length: 60 }, (_, i) => <line key={i} stroke="#2b2b2b" strokeWidth={i % 5 ? 0.6 : 1.6} transform={`rotate(${i * 6} 50 50)`} x1="50" x2="50" y1="10" y2={i % 5 ? 12.5 : 15} />)}
      {[0, 15, 30, 45].map((n) => {
        const a = (n * 6 * Math.PI) / 180
        return <text className="ecl-glyph-text" fill="#3a3a3a" fontSize="7" key={n} textAnchor="middle" x={50 + Math.sin(a) * 29} y={52.5 - Math.cos(a) * 29}>{n}</text>
      })}
      <g style={{ transform: `rotate(${minute}deg)`, transformOrigin: "50px 50px" }}><path d="M48.6 54 L49.3 14 L50.7 14 L51.4 54 Z" fill="#1d1d1d" /></g>
      <g className="ecl-second" style={{ transform: `rotate(${second}deg)`, transformOrigin: "50px 50px" }}><path d="M50 58 L50 12" stroke="#d40000" strokeWidth=".9" /></g>
      <circle cx="50" cy="50" fill="url(#e-chrome)" r="3" stroke="#333" strokeWidth=".6" />
      <path d="M14 38 A37 37 0 0 1 86 38 A60 50 0 0 0 14 38 Z" fill="url(#e-shine)" opacity=".5" />
    </svg>
  )
}

function Bar({ value, label }: { value: number; label: string }) {
  return <div aria-label={label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(value)} className="ecl-bar" role="progressbar"><i style={{ width: `${value}%` }} /></div>
}

/* ------------------------------------------------------------------ */
/* overlays                                                            */
/* ------------------------------------------------------------------ */

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="ecl-scrim" onClick={onClose}>
      <div aria-label={title} aria-modal="true" className="ecl-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
        <h2>{title}</h2>
        <div className="ecl-dialog-body">{children}</div>
        <div className="ecl-dialog-buttons"><button className="ecl-button" onClick={onClose} type="button">Cancel</button></div>
      </div>
    </div>
  )
}

function Radio({ label, detail, checked, onClick, disabled }: { label: string; detail?: string; checked: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button aria-checked={checked} className="ecl-radio" disabled={disabled} onClick={onClick} role="radio" type="button">
      <span>{label}{detail ? <small>{detail}</small> : null}</span><i data-on={checked} />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* launcher                                                            */
/* ------------------------------------------------------------------ */

const PAGES = 3
type Overlay = null | "drawer" | "menu" | "shade" | "subject" | "rhythm"

export function EclairHome(props: EclairHomeProps) {
  const { actions, settings, busy, shared } = props
  const now = useTickingNow(1000)
  const [page, setPage] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [cleared, setCleared] = useState(false)
  const [pages, setPages] = useState<HTMLDivElement | null>(null)
  const [search, setSearch] = useState<HTMLInputElement | null>(null)

  const goTo = (index: number) => pages?.scrollTo({ left: index * pages.clientWidth, behavior: "smooth" })
  const close = () => setOverlay(null)
  const back = () => (overlay ? close() : page ? goTo(0) : actions.exit())
  const home = () => { close(); goTo(0) }
  function focusSearch() { home(); window.setTimeout(() => search?.focus(), 250) }

  // Escape is the Back key.
  const backRef = useRef(back)
  useEffect(() => { backRef.current = back })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") backRef.current() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const subjectChosen = shared || props.subject.trim() !== ""
  const start = () => (subjectChosen ? actions.toggle() : setOverlay("subject"))
  const toggleLabel = props.running ? "Pause" : shared ? "Resume" : "Start"
  const canFinish = !busy && (shared || props.seconds > 0)
  const progress = props.totalSeconds ? ((props.totalSeconds - props.seconds) / props.totalSeconds) * 100 : null
  const goal = settings.dailyGoal && !props.free ? settings.dailyGoal : 0
  const idle = !props.running && (props.totalSeconds ? props.seconds === props.totalSeconds : props.seconds === 0)
  const activePreset = TIMER_PRESETS.find((preset) => preset.workMinutes === settings.workMinutes && preset.breakMinutes === settings.breakMinutes && preset.longBreakMinutes === settings.longBreakMinutes)

  const shortcuts = (
    <>
      <App disabled={busy} icon={props.running ? "pause" : "start"} label={toggleLabel} onClick={start} />
      {props.free
        ? <App disabled={!canFinish} icon="finish" label="Finish" onClick={actions.finish} />
        : props.onBreak
          ? <App icon="coffee" label="Skip break" onClick={actions.skipBreak} />
          : <App icon="plus" label="Add 5 min" onClick={() => actions.addTime(5)} />}
      <App disabled={busy} icon="reset" label={shared ? "Discard" : "Reset"} onClick={actions.reset} />
      <App disabled={shared} icon="subject" label="Subject" onClick={() => setOverlay("subject")} />
      <App disabled={shared || props.locked || busy} icon={props.free ? "free" : "pomodoro"} label={props.free ? "Free study" : "Pomodoro"} onClick={() => actions.selectMode(props.free ? "work" : "free")} />
      <App icon="paper" label="Timed paper" onClick={actions.paper} />
      <App icon="calendar" label="Up next" onClick={() => { close(); goTo(1) }} text={String(now.getDate())} />
      <App icon="settings" label="Settings" onClick={() => { close(); goTo(2) }} />
    </>
  )

  return createPortal(
    <div aria-label="Study launcher" className="eclair" role="dialog">
      <Defs />
      <Wallpaper />
      <StatusBar now={now} onBack={back} onHome={home} onMenu={() => setOverlay(overlay === "menu" ? null : "menu")} onShade={() => setOverlay("shade")} planned={!cleared && props.plans.length > 0} running={props.running} />

      <div className="ecl-body">
        <div className="ecl-pages" onScroll={(event) => setPage(Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth))} ref={setPages}>
          <div className="ecl-page">
            <div className="ecl-cells">
              <label className="ecl-search">
                <span aria-hidden className="ecl-search-brand">focal</span>
                <input aria-label="Study intent" maxLength={120} onChange={(event) => actions.intent(event.target.value)} placeholder={props.subject || "What are you studying?"} ref={setSearch} value={props.intent} />
                <button aria-label="Choose subject" onClick={() => setOverlay("subject")} type="button"><Search /></button>
              </label>

              <section aria-label="Study timer" className="ecl-widget ecl-timer">
                <button aria-label={`${toggleLabel} timer`} className="ecl-dial-button" onClick={start} type="button"><Dial seconds={props.seconds} /></button>
                <div className="ecl-timer-info">
                  <p className="ecl-timer-mode">{props.mode} · {props.status}</p>
                  <p aria-label={`${props.mode}, ${props.display}`} className="ecl-readout" role="timer">{props.display}</p>
                  <p className="ecl-timer-subject">{props.subject ? [props.subject, props.intent].filter(Boolean).join(" — ") : "Choose a subject to begin"}</p>
                  {progress === null ? null : <Bar label="Block progress" value={progress} />}
                  <div className="ecl-transport">
                    <button aria-label={toggleLabel} disabled={busy} onClick={start} type="button">{props.running ? <Pause className="ecl-solid" /> : <Play className="ecl-solid" />}</button>
                    {props.free
                      ? <button aria-label="Finish" disabled={!canFinish} onClick={actions.finish} type="button"><Square className="ecl-solid" /></button>
                      : <button aria-label={props.onBreak ? "Skip break" : "Add 5 minutes"} onClick={() => (props.onBreak ? actions.skipBreak() : actions.addTime(5))} type="button">{props.onBreak ? <SkipForward /> : <span className="ecl-plus5">+5</span>}</button>}
                    <button aria-label={shared ? "Discard" : "Reset"} disabled={busy} onClick={actions.reset} type="button"><RotateCcw /></button>
                  </div>
                </div>
              </section>

              {shortcuts}
            </div>
          </div>

          <div className="ecl-page">
            <div className="ecl-cells ecl-cells-stack">
              <section className="ecl-widget ecl-panel">
                <h3>Today</h3>
                <div className="ecl-stats">
                  <div><b>{formatFocusTime(props.focusSeconds)}</b><small>focused</small></div>
                  <div><b>{goal ? `${props.blocks}/${goal}` : props.blocks}</b><small>{props.free ? "sessions" : "blocks"}</small></div>
                  <div><b>{settings.workMinutes}/{settings.breakMinutes}</b><small>rhythm</small></div>
                </div>
                {goal ? <Bar label="Daily goal" value={Math.min(100, (props.blocks / goal) * 100)} /> : null}
              </section>
              <section className="ecl-widget ecl-panel">
                <h3>Up next</h3>
                {props.plans.length ? <ul className="ecl-list">{props.plans.slice(0, 5).map((plan) => (
                  <li key={plan.id}>
                    <span><b>{plan.title}</b><small>{plan.detail}</small></span>
                    <button aria-label={`Start ${plan.title}`} className="ecl-button" disabled={!!props.planBlocked || busy} onClick={plan.start} type="button">Start</button>
                  </li>
                ))}</ul> : <p className="ecl-empty">Nothing planned. Plan study from the calendar.</p>}
                {props.planBlocked && props.plans.length ? <p className="ecl-empty">{props.planBlocked}</p> : null}
              </section>
            </div>
          </div>

          <div className="ecl-page">
            <div className="ecl-cells ecl-cells-stack">
              <section aria-label="Power control" className="ecl-widget ecl-power-bar">
                {[
                  { label: "Sound", on: settings.soundEnabled, icon: settings.soundEnabled ? <Volume2 /> : <VolumeX />, click: () => actions.setting({ soundEnabled: !settings.soundEnabled }) },
                  { label: "Notifications", on: settings.notificationsEnabled, icon: settings.notificationsEnabled ? <Bell /> : <BellOff />, click: actions.notifications },
                  { label: "Auto-start breaks", on: settings.autoStartBreak, icon: <Coffee />, click: () => actions.setting({ autoStartBreak: !settings.autoStartBreak }) },
                  { label: "Auto-start focus", on: settings.autoStartFocus, icon: <Flag />, click: () => actions.setting({ autoStartFocus: !settings.autoStartFocus }) },
                ].map((item) => <button aria-label={item.label} aria-pressed={item.on} className="ecl-power" key={item.label} onClick={item.click} type="button">{item.icon}<i data-on={item.on} /></button>)}
              </section>
              <section className="ecl-widget ecl-panel">
                <h3>Rhythm</h3>
                <div role="radiogroup">{TIMER_PRESETS.map((preset) => <Radio checked={preset === activePreset} detail={preset.description} disabled={shared} key={preset.id} label={preset.label} onClick={() => actions.preset(preset)} />)}</div>
              </section>
            </div>
          </div>
        </div>

        <div className={`ecl-dock${overlay === "drawer" ? " ecl-dock-open" : ""}`}>
          <span className="ecl-arrows">{Array.from({ length: page }, (_, index) => <button aria-label={`Screen ${index + 1}`} key={index} onClick={() => goTo(index)} type="button" />)}</span>
          <button aria-expanded={overlay === "drawer"} aria-label={overlay === "drawer" ? "Close applications" : "Applications"} className="ecl-handle" onClick={() => setOverlay(overlay === "drawer" ? null : "drawer")} type="button"><i /></button>
          <span className="ecl-arrows">{Array.from({ length: PAGES - 1 - page }, (_, index) => <button aria-label={`Screen ${page + index + 2}`} key={index} onClick={() => goTo(page + index + 1)} type="button" />)}</span>
        </div>

        {overlay === "drawer" ? (
          <div aria-label="Applications" className="ecl-drawer" role="dialog">
            <div className="ecl-drawer-grid">
              {shortcuts}
              {TIMER_PRESETS.map((preset) => <App disabled={shared} icon="preset" key={preset.id} label={preset.label} onClick={() => { actions.preset(preset); close() }} text={String(preset.workMinutes)} />)}
              <button className="ecl-app" onClick={actions.exit} type="button"><img alt="" className="ecl-icon ecl-icon-img" src="/focal-icon.svg" /><span className="ecl-label">Focal</span></button>
            </div>
          </div>
        ) : null}
      </div>

      {overlay === "menu" ? (
        <div className="ecl-menu-scrim" onClick={close}>
          <nav aria-label="Options" className="ecl-menu" onClick={(event) => event.stopPropagation()}>
            {[
              { label: props.free ? "Pomodoro" : "Free study", icon: <Timer />, disabled: shared || props.locked || busy, click: () => actions.selectMode(props.free ? "work" : "free") },
              { label: "Rhythm", icon: <RotateCcw />, disabled: shared, click: () => setOverlay("rhythm") },
              { label: "Notifications", icon: <Bell />, click: () => setOverlay("shade") },
              { label: "Search", icon: <Search />, click: focusSearch },
              { label: "Settings", icon: <Settings />, click: () => { close(); goTo(2) } },
              { label: "Exit", icon: <LogOut />, click: actions.exit },
            ].map((item) => <button disabled={item.disabled} key={item.label} onClick={() => { if (!item.disabled) { setOverlay(null); item.click() } }} type="button">{item.icon}<span>{item.label}</span></button>)}
          </nav>
        </div>
      ) : null}

      {overlay === "shade" ? (
        <div aria-label="Notifications" className="ecl-shade" role="dialog">
          <div className="ecl-shade-head">
            <span>Focal</span>
            <button className="ecl-button" onClick={() => setCleared(true)} type="button">Clear notifications</button>
          </div>
          <div className="ecl-shade-list">
            {!idle ? (
              <>
                <h4>Ongoing</h4>
                <button className="ecl-note" onClick={home} type="button">
                  <Timer aria-hidden /><span><b>{props.mode} · {props.display}</b><small>{props.subject || "No subject"} — {props.status}</small></span>
                </button>
              </>
            ) : null}
            <h4>Notifications</h4>
            {cleared ? <p className="ecl-shade-empty">No notifications</p> : (
              <>
                <button className="ecl-note" onClick={() => { close(); goTo(1) }} type="button">
                  <Flag aria-hidden /><span><b>{formatFocusTime(props.focusSeconds)} focused today</b><small>{goal ? `${props.blocks} of ${goal} blocks` : `${props.blocks} ${props.free ? "sessions" : "blocks"}`}</small></span>
                </button>
                {props.plans.slice(0, 3).map((plan) => (
                  <button className="ecl-note" key={plan.id} onClick={() => { close(); goTo(1) }} type="button">
                    <Bell aria-hidden /><span><b>{plan.title}</b><small>{plan.detail}</small></span>
                  </button>
                ))}
              </>
            )}
          </div>
          <button aria-label="Close notifications" className="ecl-shade-grip" onClick={close} type="button" />
        </div>
      ) : null}

      {overlay === "subject" ? (
        <Dialog onClose={close} title="Choose subject">
          <div role="radiogroup">{props.subjects.map((name) => <Radio checked={props.subject === name} key={name} label={name} onClick={() => { actions.subject(name); close() }} />)}</div>
        </Dialog>
      ) : null}
      {overlay === "rhythm" ? (
        <Dialog onClose={close} title="Rhythm">
          <div role="radiogroup">{TIMER_PRESETS.map((preset) => <Radio checked={preset === activePreset} detail={preset.description} key={preset.id} label={preset.label} onClick={() => { actions.preset(preset); close() }} />)}</div>
        </Dialog>
      ) : null}
    </div>,
    document.body,
  )
}
