/**
 * Offline action queue for the technician app.
 *
 * Every field action (accept, arrive, resolve, GPS ping, photo…) is recorded here first, in order, then replayed to the
 * server. The server stays the source of truth: an item is only ever "Server confirmed" after the server said so.
 *
 *   Locally recorded  ->  Pending synchronization  ->  Server confirmed
 *                                  \->  Rejected by server (with the server's reason)
 */
import { ApiError, api } from './api'
import type { JobStatus } from './types'

export type ActionType = 'accept' | 'reject' | 'start_journey' | 'arrive' | 'start_work' | 'hold' | 'resume' | 'resolve' | 'ping'
export type ItemType = ActionType | 'photo'
export type ItemState = 'local' | 'pending' | 'confirmed' | 'rejected'

export const STATE_LABEL: Record<ItemState, string> = {
  local: 'Locally recorded',
  pending: 'Pending synchronization',
  confirmed: 'Server confirmed',
  rejected: 'Rejected by server',
}

export const TYPE_LABEL: Record<ItemType, string> = {
  accept: 'Accept job', reject: 'Reject job', start_journey: 'Start journey', arrive: 'Mark arrived', start_work: 'Start work',
  hold: 'Put on hold', resume: 'Resume work', resolve: 'Submit resolution', ping: 'GPS position', photo: 'Photo',
}

export interface QueueItem {
  id: string
  type: ItemType
  job_id?: string
  payload: Record<string, unknown>
  /** device time when the technician did it (ISO) */
  occurred_at: string
  state: ItemState
  attempts: number
  error?: string
  code?: number
  /** informational: e.g. a ping the server received but did not store ("throttled") */
  note?: string
  photo?: { key: string; kind: string; name: string; size: number }
}

export interface SyncAction { client_id: string; type: ActionType; job_id?: string; occurred_at: string; payload: Record<string, unknown> }
export interface SyncResult { client_id: string | null; status: 'confirmed' | 'rejected'; error?: string; code?: number; replayed?: boolean; accepted?: boolean; reason?: string }

export interface Transport {
  sync(actions: SyncAction[]): Promise<SyncResult[]>
  uploadPhoto(jobId: string, kind: string, blob: Blob, name: string): Promise<void>
}
export interface ItemStore { load(): QueueItem[]; save(items: QueueItem[]): void }
export interface BlobStore { put(key: string, blob: Blob): Promise<void>; get(key: string): Promise<Blob | undefined>; del(key: string): Promise<void> }

export interface SyncOutcome { sent: number; stopped: null | 'offline' | 'auth' | 'server' }
export interface QueueDeps {
  store: ItemStore; blobs: BlobStore; transport: Transport
  now?: () => Date; newId?: () => string
  maxBatch?: number; maxAttempts?: number; keepConfirmed?: number; maxPings?: number
}

const isUnsynced = (i: QueueItem) => i.state === 'local' || i.state === 'pending'

export class OfflineQueue {
  private items: QueueItem[]
  private listeners = new Set<() => void>()
  private running: Promise<SyncOutcome> | null = null
  private rerun = false
  private version = 0
  private d: Required<QueueDeps>

  constructor(deps: QueueDeps) {
    this.d = {
      now: () => new Date(), newId: defaultId, maxBatch: 50, maxAttempts: 8, keepConfirmed: 30, maxPings: 200, ...deps,
    }
    this.items = this.d.store.load()
  }

  // ---- observable state (useSyncExternalStore friendly) ----
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  getVersion = () => this.version
  getItems = (): readonly QueueItem[] => this.items
  isSyncing = () => this.running !== null
  private touch() { this.version++; this.d.store.save(this.items); this.listeners.forEach((l) => l()) }

  unsynced = () => this.items.filter(isUnsynced)
  forJob = (jobId: string) => this.items.filter((i) => i.job_id === jobId)
  find = (id: string) => this.items.find((i) => i.id === id)

  enqueue(a: { type: ActionType; job_id?: string; payload?: Record<string, unknown>; occurred_at?: string }): QueueItem {
    const item: QueueItem = {
      id: this.d.newId(), type: a.type, job_id: a.job_id, payload: a.payload ?? {},
      occurred_at: a.occurred_at ?? this.d.now().toISOString(), state: 'local', attempts: 0,
    }
    this.items = [...this.items, item]
    if (a.type === 'ping') this.capPings()
    this.touch()
    return item
  }

  async enqueuePhoto(jobId: string, kind: string, blob: Blob, name: string): Promise<QueueItem> {
    const key = this.d.newId()
    await this.d.blobs.put(key, blob) // blob first: never record a photo we cannot send
    const item: QueueItem = {
      id: this.d.newId(), type: 'photo', job_id: jobId, payload: {}, occurred_at: this.d.now().toISOString(), state: 'local', attempts: 0,
      photo: { key, kind, name, size: blob.size },
    }
    this.items = [...this.items, item]
    this.touch()
    return item
  }

  getPhotoBlob = (item: QueueItem) => (item.photo ? this.d.blobs.get(item.photo.key) : Promise.resolve(undefined))

  /** Remove an item the technician no longer wants (only rejected or never-sent items). */
  async discard(id: string) {
    const it = this.find(id)
    if (!it || it.state === 'confirmed') return
    if (it.photo) await this.d.blobs.del(it.photo.key)
    this.items = this.items.filter((i) => i.id !== id)
    this.touch()
  }

  private capPings() {
    const pings = this.items.filter((i) => i.type === 'ping' && isUnsynced(i))
    const extra = pings.length - this.d.maxPings
    if (extra > 0) {
      const drop = new Set(pings.slice(0, extra).map((p) => p.id))
      this.items = this.items.filter((i) => !drop.has(i.id))
    }
  }

  /** Replay everything not yet confirmed, strictly in the order it was recorded. Concurrent calls share one run. */
  sync(): Promise<SyncOutcome> {
    if (this.running) { this.rerun = true; return this.running }
    this.running = this.run().finally(() => {
      this.running = null
      this.touch()
      if (this.rerun) { this.rerun = false; void this.sync() }
    })
    this.touch() // announce "syncing"
    return this.running
  }

  private async run(): Promise<SyncOutcome> {
    const out: SyncOutcome = { sent: 0, stopped: null }
    for (;;) {
      const first = this.items.find(isUnsynced)
      if (!first) break
      const stop = first.type === 'photo' ? await this.sendPhoto(first, out) : await this.sendBatch(first, out)
      if (stop) { out.stopped = stop; break }
    }
    this.prune()
    return out
  }

  private async sendBatch(first: QueueItem, out: SyncOutcome): Promise<SyncOutcome['stopped']> {
    const start = this.items.indexOf(first)
    const batch: QueueItem[] = []
    for (let i = start; i < this.items.length && batch.length < this.d.maxBatch; i++) {
      const it = this.items[i]
      if (!isUnsynced(it) || it.type === 'photo') break
      batch.push(it)
    }
    this.mutate(batch, (i) => { i.state = 'pending'; i.attempts++ })
    let results: SyncResult[]
    try {
      results = await this.d.transport.sync(batch.map((i) => ({
        client_id: i.id, type: i.type as ActionType, job_id: i.job_id, occurred_at: i.occurred_at, payload: i.payload,
      })))
    } catch (e) {
      return this.failed(batch, e)
    }
    const byId = new Map(results.map((r) => [r.client_id, r]))
    let missing = false
    for (const it of batch) {
      const r = byId.get(it.id)
      if (!r) { missing = true; continue }
      this.mutate([it], (i) => {
        if (r.status === 'confirmed') {
          i.state = 'confirmed'; i.error = undefined; i.code = undefined
          if (r.accepted === false) i.note = `Not stored: ${r.reason ?? 'refused'}`
          out.sent++
        } else {
          i.state = 'rejected'; i.error = r.error ?? 'Refused'; i.code = r.code
        }
      })
    }
    return missing ? 'server' : null
  }

  private async sendPhoto(it: QueueItem, out: SyncOutcome): Promise<SyncOutcome['stopped']> {
    this.mutate([it], (i) => { i.state = 'pending'; i.attempts++ })
    const blob = await this.getPhotoBlob(it)
    if (!blob || !it.photo || !it.job_id) {
      this.mutate([it], (i) => { i.state = 'rejected'; i.error = 'Photo data is no longer on this device' })
      return null
    }
    try {
      await this.d.transport.uploadPhoto(it.job_id, it.photo.kind, blob, it.photo.name)
    } catch (e) {
      return this.failed([it], e)
    }
    await this.d.blobs.del(it.photo.key)
    this.mutate([it], (i) => { i.state = 'confirmed'; i.error = undefined })
    out.sent++
    return null
  }

  /** Classify a failed request: stay pending for transient problems, reject for permanent ones (no endless retries). */
  private failed(batch: QueueItem[], e: unknown): SyncOutcome['stopped'] {
    const status = e instanceof ApiError ? e.status : (e as { status?: number })?.status
    const network = e instanceof ApiError ? e.network : (e as { network?: boolean })?.network
    if (network) return 'offline'
    if (status === 401) return 'auth'
    const message = e instanceof Error ? e.message : 'Request failed'
    if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
      this.mutate(batch, (i) => { i.state = 'rejected'; i.error = message; i.code = status })
      return null
    }
    const exhausted = batch.filter((i) => i.attempts >= this.d.maxAttempts)
    if (exhausted.length) this.mutate(exhausted, (i) => { i.state = 'rejected'; i.error = `Server kept failing: ${message}` })
    return 'server'
  }

  private mutate(items: QueueItem[], fn: (i: QueueItem) => void) {
    const ids = new Set(items.map((i) => i.id))
    this.items = this.items.map((i) => { if (!ids.has(i.id)) return i; const c = { ...i }; fn(c); return c })
    items.forEach((_, k) => { items[k] = this.items.find((i) => i.id === items[k].id)! })
    this.touch()
  }

  private prune() {
    const confirmed = this.items.filter((i) => i.state === 'confirmed')
    const drop = new Set(confirmed.slice(0, Math.max(0, confirmed.length - this.d.keepConfirmed)).map((i) => i.id))
    if (drop.size) { this.items = this.items.filter((i) => !drop.has(i.id)); this.touch() }
  }
}

// ---------------------------------------------------------------- status projection (so follow-up actions can be queued offline)
const NEXT: Partial<Record<ActionType, [JobStatus[], JobStatus]>> = {
  accept: [['NOTIFIED'], 'ACCEPTED'],
  reject: [['NOTIFIED'], 'REJECTED'],
  start_journey: [['ACCEPTED'], 'EN_ROUTE'],
  arrive: [['EN_ROUTE'], 'ARRIVED'],
  start_work: [['ARRIVED'], 'IN_PROGRESS'],
  hold: [['IN_PROGRESS'], 'ON_HOLD'],
  resume: [['ON_HOLD'], 'IN_PROGRESS'],
  resolve: [['IN_PROGRESS'], 'VERIFICATION'],
}

/**
 * What the job status WOULD be once the not-yet-confirmed actions are accepted. UI only: it enables the next legal button while
 * offline. It is never shown as the real status; the server may still refuse any of those actions.
 */
export function projectStatus(server: JobStatus, items: readonly QueueItem[]): JobStatus {
  let s = server
  for (const it of items) {
    if (!isUnsynced(it)) continue
    const rule = NEXT[it.type as ActionType]
    if (rule && rule[0].includes(s)) s = rule[1]
  }
  return s
}

export const pendingForJob = (items: readonly QueueItem[], jobId: string) => items.filter((i) => i.job_id === jobId && isUnsynced(i))

// ---------------------------------------------------------------- persistence (device)
function defaultId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID() // only exists in secure contexts (https/localhost)
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export const localStorageItems = (key: string): ItemStore => ({
  load() {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]') as QueueItem[] } catch { return [] }
  },
  save(items) { try { localStorage.setItem(key, JSON.stringify(items)) } catch { /* storage full: the in-memory queue keeps working */ } },
})

export function indexedDbBlobs(dbName = 'techso-offline'): BlobStore {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(dbName, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('photos')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction('photos', mode)
      const req = fn(t.objectStore('photos'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      t.oncomplete = () => db.close()
    })
  }
  return {
    put: async (k, b) => { await tx('readwrite', (s) => s.put(b, k)) },
    get: (k) => tx<Blob | undefined>('readonly', (s) => s.get(k)),
    del: async (k) => { await tx('readwrite', (s) => s.delete(k)) },
  }
}

export const memoryBlobs = (): BlobStore => {
  const m = new Map<string, Blob>()
  return { put: async (k, b) => { m.set(k, b) }, get: async (k) => m.get(k), del: async (k) => { m.delete(k) } }
}

export const apiTransport: Transport = {
  async sync(actions) {
    return (await api.post<{ results: SyncResult[] }>('/sync', { actions })).results
  },
  async uploadPhoto(jobId, kind, blob, name) {
    const f = new FormData()
    f.append('kind', kind)
    f.append('file', blob, name)
    await api.upload(`/jobs/${jobId}/evidence`, f)
  },
}

const queues = new Map<string, OfflineQueue>()
/** One queue per user per device. Work stays on the device after sign-out and only its owner can send it. */
export function getQueue(userId: string): OfflineQueue {
  let q = queues.get(userId)
  if (!q) {
    q = new OfflineQueue({
      store: localStorageItems(`techso.queue.${userId}`),
      blobs: typeof indexedDB === 'undefined' ? memoryBlobs() : indexedDbBlobs(),
      transport: apiTransport,
    })
    queues.set(userId, q)
  }
  return q
}

/** Sync on: app start, browser 'online' event, and every `everyMs`. Returns a cleanup function. */
export function startAutoSync(q: OfflineQueue, everyMs = 30000): () => void {
  const run = () => { if (navigator.onLine && q.unsynced().length) void q.sync() }
  window.addEventListener('online', run)
  const t = setInterval(run, everyMs)
  run()
  return () => { window.removeEventListener('online', run); clearInterval(t) }
}
