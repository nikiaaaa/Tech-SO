/**
 * New-assignment alerting for the technician PWA: Web Audio beeps, vibration, and a Notification when permitted.
 * Limits, stated plainly: this only works while the app is open. There is no background push (FCM) and no Android
 * notification channel in a web app; the phone's Do Not Disturb and the browser's autoplay rules still apply.
 */
let ctx: AudioContext | null = null

/** Browsers only allow sound after a user gesture; call this from any tap. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch { /* no Web Audio */ }
}

function tone(freq: number, startMs: number, ms: number, vol = 0.5) {
  if (!ctx) return
  const t0 = ctx.currentTime + startMs / 1000
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(vol, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + ms / 1000)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + ms / 1000)
}

export type AlertLevel = 'urgent' | 'normal'
export function playOnce(level: AlertLevel = 'urgent') {
  unlockAudio()
  if (level === 'urgent') { tone(880, 0, 160); tone(880, 220, 160); tone(1175, 440, 320) } else tone(660, 0, 300, 0.35)
  try { navigator.vibrate?.(level === 'urgent' ? [250, 120, 250, 120, 400] : [200]) } catch { /* not supported */ }
}

let timer: ReturnType<typeof setInterval> | null = null
let timerMs = 0
/** Repeat until stopAlarm(). `repeatMs` comes from the tenant's notification rules (60 s until they are loaded). */
export function startAlarm(level: AlertLevel = 'urgent', repeatMs = 60000) {
  if (timer && timerMs === repeatMs) return
  if (timer) clearInterval(timer); else playOnce(level)
  timerMs = repeatMs
  timer = setInterval(() => playOnce(level), repeatMs)
}
export function stopAlarm() {
  if (timer) { clearInterval(timer); timer = null }
  try { navigator.vibrate?.(0) } catch { /* ignore */ }
}
export const alarmRunning = () => timer !== null

export async function askNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'default') return Notification.requestPermission()
  return Notification.permission
}

export function showNative(title: string, body: string, tag: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body, tag, icon: '/icon-192.png', requireInteraction: true })
  } catch { /* some Android browsers only allow notifications through a service worker */ }
}
