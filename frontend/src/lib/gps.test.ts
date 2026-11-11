import { describe, expect, it, vi } from 'vitest'
import { createTracker, haversineKm, type GeoLike, type PingBody, type TrackerDeps } from './gps'

function fakeGeo() {
  let ok: (p: GeolocationPosition) => void = () => {}
  let err: (e: GeolocationPositionError) => void = () => {}
  const geo: GeoLike & { fix(lat: number, lon: number, at: number, acc?: number): void; fail(code: number): void } = {
    watchPosition: vi.fn((o, e) => { ok = o; err = e; return 7 }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn((o) => o({ coords: { latitude: -6.2, longitude: 106.8, accuracy: 9 }, timestamp: 1000 } as GeolocationPosition)),
    fix: (lat, lon, at, acc = 10) => ok({ coords: { latitude: lat, longitude: lon, accuracy: acc }, timestamp: at } as GeolocationPosition),
    fail: (code) => err({ code } as GeolocationPositionError),
  }
  return geo
}

function make(over: Partial<TrackerDeps> = {}) {
  const geo = fakeGeo()
  const sent: PingBody[] = []
  const queued: PingBody[] = []
  const deps: TrackerDeps = {
    geo, secure: true, isOnline: () => true, now: () => 5000,
    sendPing: async (p) => { sent.push(p); return { accepted: true } },
    enqueuePing: (p) => { queued.push(p) },
    ...over,
  }
  return { t: createTracker(deps), geo, sent, queued }
}
const cfg = { minIntervalS: 10, reason: 'active_shift', retentionDays: 30 }
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('tracker', () => {
  it('does nothing until started and stops cleanly', () => {
    const { t, geo } = make()
    expect(geo.watchPosition).not.toHaveBeenCalled()
    t.start(cfg)
    expect(t.getState().running).toBe(true)
    t.stop()
    expect(geo.clearWatch).toHaveBeenCalledWith(7)
    expect(t.getState().running).toBe(false)
  })

  it('refuses to track on an insecure page and says how to fix it', () => {
    const { t, geo } = make({ secure: false })
    t.start(cfg)
    expect(geo.watchPosition).not.toHaveBeenCalled()
    expect(t.getState()).toMatchObject({ running: false, error: { kind: 'insecure_context' } })
    expect(t.getState().error!.message).toContain('dev:https')
  })

  it('reports a browser without geolocation', () => {
    const { t } = make({ geo: null })
    t.start(cfg)
    expect(t.getState().error?.kind).toBe('unsupported')
  })

  it('throttles pings to the policy interval', async () => {
    const { t, geo, sent } = make()
    t.start(cfg)
    const T = 1_700_000_000_000 // real position timestamps are epoch milliseconds
    geo.fix(-6.2, 106.8, T)
    geo.fix(-6.2, 106.8, T + 5000)
    geo.fix(-6.2, 106.8, T + 12000)
    await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].recorded_at).toBe(new Date(T + 12000).toISOString())
  })

  it('includes the job id and accuracy when tracking is tied to an assignment', async () => {
    const { t, geo, sent } = make()
    t.start({ ...cfg, reason: 'active_assignment', jobId: 'job9' })
    geo.fix(-6.2, 106.8, 1000, 18)
    await flush()
    expect(sent[0]).toMatchObject({ job_id: 'job9', accuracy_m: 18, lat: -6.2, lon: 106.8 })
  })

  it('only claims server confirmation when the server stored the ping', async () => {
    let accepted = false
    const { t, geo } = make({ sendPing: async () => ({ accepted, reason: accepted ? undefined : 'throttled' }) })
    t.start(cfg)
    geo.fix(-6.2, 106.8, 0)
    await flush()
    expect(t.getState().lastFix).not.toBeNull()          // a fix exists...
    expect(t.getState().lastConfirmedAt).toBeNull()       // ...but nothing is proven yet
    expect(t.getState().lastServer).toMatchObject({ accepted: false, reason: 'throttled' })
    accepted = true
    geo.fix(-6.2, 106.8, 20000)
    await flush()
    expect(t.getState().lastConfirmedAt).toBe(5000)
  })

  it('queues pings while offline or on a network failure, instead of dropping them', async () => {
    let online = false
    const { t, geo, queued } = make({ isOnline: () => online })
    t.start(cfg)
    geo.fix(-6.2, 106.8, 0)
    expect(queued).toHaveLength(1)
    online = true
    const net = make({ sendPing: async () => { throw Object.assign(new Error('x'), { network: true }) } })
    net.t.start(cfg)
    net.geo.fix(-6.2, 106.8, 0)
    await flush()
    expect(net.queued).toHaveLength(1)
    expect(net.t.getState().queued).toBe(1)
  })

  it('re-checks authorization when the server answers 403', async () => {
    const onNotAuthorized = vi.fn()
    const { t, geo } = make({ sendPing: async () => { throw Object.assign(new Error('Tracking not authorized: no_active_shift_or_assignment'), { status: 403 }) }, onNotAuthorized })
    t.start(cfg)
    geo.fix(-6.2, 106.8, 0)
    await flush()
    expect(onNotAuthorized).toHaveBeenCalled()
    expect(t.getState().lastServer).toMatchObject({ accepted: false, reason: expect.stringContaining('not authorized') })
  })

  it('maps permission, unavailable and timeout errors, and can retry after permission is granted', () => {
    const { t, geo } = make()
    t.start(cfg)
    geo.fail(3)
    expect(t.getState().error?.kind).toBe('timeout')
    expect(t.getState().running).toBe(true)
    geo.fail(2)
    expect(t.getState().error?.kind).toBe('unavailable')
    geo.fail(1)
    expect(t.getState()).toMatchObject({ running: false, error: { kind: 'permission_denied' } })
    t.retry()
    expect(t.getState().running).toBe(true)
    expect(geo.watchPosition).toHaveBeenCalledTimes(2)
  })

  it('testOnce reads a position without sending anything to the server', async () => {
    const { t, sent } = make()
    const fix = await t.testOnce()
    expect(fix).toMatchObject({ lat: -6.2, lon: 106.8, accuracy_m: 9 })
    expect(sent).toHaveLength(0)
    expect(t.getState().lastConfirmedAt).toBeNull()
  })

  it('does not restart the watch for an identical config', () => {
    const { t, geo } = make()
    t.start(cfg)
    t.start({ ...cfg })
    expect(geo.watchPosition).toHaveBeenCalledTimes(1)
  })
})

describe('haversine', () => {
  it('matches a known distance (Monas to Bundaran HI is about 2.2 km)', () => {
    expect(haversineKm(-6.1754, 106.8272, -6.195, 106.823)).toBeGreaterThan(1.9)
    expect(haversineKm(-6.1754, 106.8272, -6.195, 106.823)).toBeLessThan(2.5)
  })
})
