import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useOnline } from '../../lib/hooks'
import { useRealtime } from '../../lib/realtime'
import { getQueue, pendingForJob, startAutoSync, STATE_LABEL, type ActionType, type OfflineQueue, type QueueItem } from '../../lib/offline'
import { createTracker, type Tracker, type TrackerState } from '../../lib/gps'
import { playOnce, showNative, startAlarm, stopAlarm, unlockAudio } from '../../lib/alerts'
import type { Job, ShiftOut, Tracking } from '../../lib/types'
import { useToast } from '../../components/ui'

export type Outcome = 'confirmed' | 'rejected' | 'pending' | 'saved'

interface MobileCtx {
  online: boolean
  jobs: Job[] | null
  jobsLoading: boolean
  jobsError: string | null
  /** true when the list shown is the copy saved on this device because the server could not be reached */
  stale: boolean
  jobsVersion: number
  reloadJobs: () => Promise<void>
  queue: OfflineQueue
  items: readonly QueueItem[]
  syncing: boolean
  unsynced: number
  syncNow: () => Promise<void>
  perform: (type: ActionType, jobId: string, payload?: Record<string, unknown>) => Promise<Outcome>
  addPhoto: (jobId: string, kind: string, blob: Blob, name: string) => Promise<Outcome>
  tracker: Tracker
  trackerState: TrackerState
  tracking: Tracking | null
  shift: ShiftOut | null
  refreshTracking: () => Promise<void>
  /** jobs waiting for the technician's accept/reject that have no local answer yet */
  awaiting: Job[]
}

const Ctx = createContext<MobileCtx | null>(null)
export const useMobile = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useMobile must be used inside MobileProvider')
  return c
}

const ANSWER: ActionType[] = ['accept', 'reject']

export function MobileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const toast = useToast()
  const online = useOnline()
  const uid = user!.id
  const queue = useMemo(() => getQueue(uid), [uid])
  useSyncExternalStore(queue.subscribe, queue.getVersion)
  const items = queue.getItems()

  const cacheKey = `techso.m.jobs.${uid}`
  const [jobs, setJobs] = useState<Job[] | null>(() => {
    try { return (JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as { jobs: Job[] } | null)?.jobs ?? null } catch { return null }
  })
  const [stale, setStale] = useState(jobs !== null)
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [jobsVersion, setJobsVersion] = useState(0)
  const [tracking, setTracking] = useState<Tracking | null>(null)
  const [shift, setShift] = useState<ShiftOut | null>(null)

  const reloadJobs = useCallback(async () => {
    setJobsLoading(true)
    try {
      const j = await api.get<Job[]>('/me/jobs', { scope: 'active' })
      setJobs(j); setStale(false); setJobsError(null); setJobsVersion((v) => v + 1)
      try { localStorage.setItem(cacheKey, JSON.stringify({ jobs: j, at: Date.now() })) } catch { /* storage full */ }
    } catch (e) {
      setJobsError(errorMessage(e)); setStale(true)
    } finally { setJobsLoading(false) }
  }, [cacheKey])

  // ---- GPS tracker: created once; it only runs while the server says tracking is authorized
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const tracker = useMemo(() => createTracker({
    geo: typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null,
    secure: typeof window !== 'undefined' && window.isSecureContext,
    isOnline: () => navigator.onLine,
    sendPing: (p) => api.post<{ accepted: boolean; reason?: string }>('/me/location', p),
    enqueuePing: (p) => { queue.enqueue({ type: 'ping', occurred_at: p.recorded_at, payload: { lat: p.lat, lon: p.lon, accuracy_m: p.accuracy_m, ...(p.job_id ? { job_id: p.job_id } : {}) } }) },
    onNotAuthorized: () => { void refreshRef.current() },
  }), [queue])
  const trackerState = useSyncExternalStore(tracker.subscribe, tracker.getState)

  const refreshTracking = useCallback(async () => {
    try {
      const r = await api.get<{ shift: ShiftOut | null; tracking: Tracking }>('/me/shift')
      setShift(r.shift); setTracking(r.tracking)
      if (r.tracking.active) tracker.start({ minIntervalS: r.tracking.policy.min_interval_s, reason: r.tracking.reason, retentionDays: r.tracking.policy.retention_days, jobId: r.tracking.job_id })
      else tracker.stop()
    } catch { /* offline: keep tracking as it is until we can ask again */ }
  }, [tracker])
  refreshRef.current = refreshTracking

  const syncNow = useCallback(async () => {
    const out = await queue.sync()
    if (out.sent > 0) { await reloadJobs(); await refreshTracking() }
  }, [queue, reloadJobs, refreshTracking])

  const perform = useCallback(async (type: ActionType, jobId: string, payload: Record<string, unknown> = {}): Promise<Outcome> => {
    unlockAudio()
    const it = queue.enqueue({ type, job_id: jobId, payload })
    if (!navigator.onLine) { toast('info', 'Saved on this device. It will be sent when you are online.'); return 'saved' }
    await syncNow()
    const now = queue.find(it.id)
    if (now?.state === 'confirmed') { toast('success', STATE_LABEL.confirmed); return 'confirmed' }
    if (now?.state === 'rejected') { toast('error', `${STATE_LABEL.rejected}: ${now.error}`); return 'rejected' }
    toast('info', `${STATE_LABEL.pending}. It stays on this device until the server confirms.`)
    return 'pending'
  }, [queue, syncNow, toast])

  const addPhoto = useCallback(async (jobId: string, kind: string, blob: Blob, name: string): Promise<Outcome> => {
    const it = await queue.enqueuePhoto(jobId, kind, blob, name)
    if (!navigator.onLine) { toast('info', 'Photo saved on this device. It will upload when you are online.'); return 'saved' }
    await syncNow()
    const now = queue.find(it.id)
    if (now?.state === 'confirmed') { toast('success', 'Photo uploaded. Server confirmed.'); return 'confirmed' }
    if (now?.state === 'rejected') { toast('error', `${STATE_LABEL.rejected}: ${now.error}`); return 'rejected' }
    toast('info', `Photo: ${STATE_LABEL.pending}.`)
    return 'pending'
  }, [queue, syncNow, toast])

  // ---- lifecycle
  useEffect(() => { void reloadJobs(); void refreshTracking() }, [reloadJobs, refreshTracking])
  useEffect(() => startAutoSync(queue), [queue])
  useEffect(() => {
    const t = setInterval(() => { if (navigator.onLine) { void reloadJobs(); void refreshTracking() } }, 60000)
    return () => clearInterval(t)
  }, [reloadJobs, refreshTracking])
  useEffect(() => { if (online) { void reloadJobs(); void refreshTracking() } }, [online, reloadJobs, refreshTracking])
  useEffect(() => { document.addEventListener('pointerdown', unlockAudio, { once: true }) }, [])
  useEffect(() => () => { stopAlarm(); tracker.stop() }, [tracker])

  useRealtime((e) => {
    if (e.type === 'assignment.new' || e.type === 'assignment.removed' || e.type === 'job.updated' || (e.type === 'notification' && e.job_id)) {
      void reloadJobs(); void refreshTracking()
    }
  })

  // ---- new assignments that still need an answer
  const awaiting = useMemo(
    () => (jobs ?? []).filter((j) => j.status === 'NOTIFIED' && !pendingForJob(items, j.id).some((i) => ANSWER.includes(i.type as ActionType))),
    [jobs, items],
  )
  const alerted = useRef(new Set<string>())
  const urgent = awaiting.some((j) => j.priority === 'critical' || j.priority === 'high')
  // the alarm repeats at the tenant's configured interval (never faster than every 15 s)
  const [repeatMs, setRepeatMs] = useState(60000)
  useEffect(() => {
    api.get<{ repeat_interval_min: number }>('/settings/notification_rules')
      .then((r) => setRepeatMs(Math.max(15000, r.repeat_interval_min * 60000))).catch(() => { /* offline: keep 60 s */ })
  }, [])
  useEffect(() => {
    if (urgent) startAlarm('urgent', repeatMs); else stopAlarm()
    awaiting.forEach((j) => {
      if (alerted.current.has(j.id)) return
      alerted.current.add(j.id)
      if (!(j.priority === 'critical' || j.priority === 'high')) playOnce('normal')
      showNative(`New ${j.priority} job ${j.code}`, `${j.device?.code ?? ''} ${j.device?.address ?? ''}`.trim(), j.id)
    })
  }, [awaiting, urgent, repeatMs])

  const value: MobileCtx = {
    online, jobs, jobsLoading, jobsError, stale, jobsVersion, reloadJobs, queue, items, syncing: queue.isSyncing(),
    unsynced: queue.unsynced().length, syncNow, perform, addPhoto, tracker, trackerState, tracking, shift, refreshTracking, awaiting,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
