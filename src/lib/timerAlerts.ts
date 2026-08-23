import { sendNativeNotification } from "@/lib/nativeNotifications"

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  try {
    if (!audioContext) {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!AudioCtor) return null
      audioContext = new AudioCtor()
    }
    if (audioContext.state === "suspended") void audioContext.resume()
    return audioContext
  } catch {
    return null
  }
}

function playTone(
  context: AudioContext,
  frequency: number,
  startOffset: number,
  duration: number,
  volume: number,
) {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = "sine"
  oscillator.frequency.value = frequency
  const start = context.currentTime + startOffset
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.05)
}

/**
 * Best-effort chime so the user notices a block ended even with the app in
 * another window. Uses the Web Audio API — no audio assets needed.
 */
export function playTimerChime(kind: "focus" | "break") {
  const context = getAudioContext()
  if (!context) return
  try {
    if (kind === "focus") {
      // Ascending C-E-G: time to rest.
      playTone(context, 523.25, 0, 0.4, 0.18)
      playTone(context, 659.25, 0.15, 0.4, 0.18)
      playTone(context, 783.99, 0.3, 0.6, 0.18)
    } else {
      // Gentle G-E: break is over.
      playTone(context, 783.99, 0, 0.35, 0.14)
      playTone(context, 659.25, 0.15, 0.5, 0.14)
    }
  } catch {
    // Sound is best-effort; never break the timer over audio.
  }
}

/** Native desktop notification when a block ends. Silent in the browser build. */
export async function notifyTimerBlock(title: string, body: string) {
  await sendNativeNotification({ title, body })
}
