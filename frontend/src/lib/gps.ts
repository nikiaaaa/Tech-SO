/**
 * Technician GPS tracker. It runs ONLY while the server says tracking is authorized (active shift or active assignment),
 * throttles to the policy interval, and records what the SERVER accepted. A position fix on the device is not the same as
 * "GPS works": the UI reads `lastConfirmedAt` (server accepted a ping) for that claim.
 */
export interface GeoLike {
  watchPosition(ok: (p: GeolocationPosition) => void, err: (e: GeolocationPositionError) => void, opts?: PositionOptions): number
  clearWatch(id: number): void
  getCurrentPosition(ok: (p: GeolocationPosition) => void, err: (e: GeolocationPositionError) => void, opts?: PositionOptions): void
}

export type GpsErrorKind = 'insecure_context' | 'unsupported' | 'permission_denied' | 'unavailable' | 'timeout'
export interface GpsError { kind: GpsErrorKind; message: string }
export interface Fix { lat: number; lon: number; accuracy_m: number; at: number }
export interface PingBody { lat: number; lon: number; accuracy_m: number; recorded_at: string; job_id?: string }
export interface PingResult { accepted: boolean; reason?: string }

export interface TrackerConfig { minIntervalS: number; reason: string; retentionDays: number; jobId?: string }
export interface TrackerState {
  running: boolean
  config: TrackerConfig | null
  lastFix: Fix | null
  error: GpsError | null
  /** the last answer from the server about a ping (accepted or why not) */
  lastServer: { at: number; accepted: boolean; reason?: string } | null
  /** last time the server actually stored a ping: the only proof that tracking works end to end */
  lastConfirmedAt: number | null
  sent: number
  queued: number
}

export interface TrackerDeps {
  geo: GeoLike | null
  secure: boolean
  sendPing(p: PingBody): Promise<PingResult>
  enqueuePing(p: PingBody): void
  isOnline(): boolean
  now?: () => number
  /** server said 403: tracking is no longer authorized, re-check /me/tracking */
  onNotAuthorized?: () => void
}

export const ERROR_TEXT: Record<GpsErrorKind, string> = {
  insecure_context: 'GPS needs a secure connection. Open the app over https:// (run "npm run dev:https" for development) or on localhost.',
  unsupported: 'This browser does not provide GPS (Geolocation).',
  permission_denied: 'Location permission is blocked. Allow location for this site in the browser settings, then press Retry.',
  unavailable: 'Your position is unavailable right now (no GPS signal or location services are off).',
  timeout: 'Waiting for a GPS fix timed out. Move to an open area and try again.',
}

const geoError = (e: { code: number }): GpsError => {
  const kind: GpsErrorKind = e.code === 1 ? 'permission_denied' : e.code === 3 ? 'timeout' : 'unavailable'
  return { kind, message: ERROR_TEXT[kind] }
}

export function createTracker(deps: TrackerDeps) {
  const now = deps.now ?? Date.now
  let state: TrackerState = { running: false, config: null, lastFix: null, error: null, lastServer: null, lastConfirmedAt: null, sent: 0, queued: 0 }
  let watchId: number | null = null
  let lastSentAt: number | null = null
  const listeners = new Set<() => void>()
  const set = (patch: Partial<TrackerState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()) }

  async function maybeSend(fix: Fix) {
    const cfg = state.config
    if (!cfg) return
    if (lastSentAt !== null && fix.at - lastSentAt < cfg.minIntervalS * 1000) return
    lastSentAt = fix.at
    const body: PingBody = { lat: fix.lat, lon: fix.lon, accuracy_m: fix.accuracy_m, recorded_at: new Date(fix.at).toISOString(), ...(cfg.jobId ? { job_id: cfg.jobId } : {}) }
    if (!deps.isOnline()) { deps.enqueuePing(body); set({ queued: state.queued + 1 }); return }
    try {
      const r = await deps.sendPing(body)
      set({
        sent: state.sent + 1,
        lastServer: { at: now(), accepted: r.accepted, reason: r.reason },
        lastConfirmedAt: r.accepted ? now() : state.lastConfirmedAt,
      })
    } catch (e) {
      const err = e as { network?: boolean; status?: number; message?: string }
      if (err.network) { deps.enqueuePing(body); set({ queued: state.queued + 1 }); return }
      set({ lastServer: { at: now(), accepted: false, reason: err.message ?? 'refused' } })
      if (err.status === 403) deps.onNotAuthorized?.()
    }
  }

  const onFix = (p: GeolocationPosition) => {
    const fix: Fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: p.coords.accuracy, at: p.timestamp || now() }
    set({ lastFix: fix, error: null })
    void maybeSend(fix)
  }
  const onErr = (e: GeolocationPositionError) => {
    const err = geoError(e)
    if (err.kind === 'permission_denied') stop(false)
    set({ error: err })
  }

  function start(cfg: TrackerConfig) {
    const same = state.running && state.config && JSON.stringify(state.config) === JSON.stringify(cfg)
    if (same) return
    if (watchId !== null) { deps.geo?.clearWatch(watchId); watchId = null }
    if (!deps.secure) { set({ running: false, config: cfg, error: { kind: 'insecure_context', message: ERROR_TEXT.insecure_context } }); return }
    if (!deps.geo) { set({ running: false, config: cfg, error: { kind: 'unsupported', message: ERROR_TEXT.unsupported } }); return }
    lastSentAt = null
    set({ running: true, config: cfg, error: null })
    watchId = deps.geo.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 })
  }

  function stop(clearConfig = true) {
    if (watchId !== null) { deps.geo?.clearWatch(watchId); watchId = null }
    set({ running: false, ...(clearConfig ? { config: null } : {}) })
  }

  /** Re-start after the user fixes permissions. */
  function retry() {
    const cfg = state.config
    if (!cfg) return
    stop(false)
    state = { ...state, config: null }
    start(cfg)
  }

  /** One-off position check for the diagnostics panel. It does not send anything to the server. */
  function testOnce(): Promise<Fix> {
    return new Promise((resolve, reject) => {
      if (!deps.secure) return reject({ kind: 'insecure_context', message: ERROR_TEXT.insecure_context } satisfies GpsError)
      if (!deps.geo) return reject({ kind: 'unsupported', message: ERROR_TEXT.unsupported } satisfies GpsError)
      deps.geo.getCurrentPosition(
        (p) => { const f = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: p.coords.accuracy, at: p.timestamp || now() }; set({ lastFix: f }); resolve(f) },
        (e) => reject(geoError(e)),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      )
    })
  }

  return {
    start, stop, retry, testOnce,
    getState: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
}
export type Tracker = ReturnType<typeof createTracker>

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a))
}

export async function geolocationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    if (!navigator.permissions) return 'unknown'
    return (await navigator.permissions.query({ name: 'geolocation' as PermissionName })).state
  } catch { return 'unknown' }
}
