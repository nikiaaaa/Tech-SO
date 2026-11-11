import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { OfflineQueue, STATE_LABEL, memoryBlobs, projectStatus, type ItemStore, type QueueItem, type SyncAction, type SyncResult, type Transport } from './offline'

function memStore(): ItemStore & { data: QueueItem[] } {
  const s = { data: [] as QueueItem[], load: () => JSON.parse(JSON.stringify(s.data)) as QueueItem[], save: (i: QueueItem[]) => { s.data = JSON.parse(JSON.stringify(i)) } }
  return s
}

function setup(over: Partial<Transport> = {}, extra: Record<string, unknown> = {}) {
  const calls: string[] = []
  const sent: SyncAction[][] = []
  let n = 0
  const transport: Transport = {
    async sync(actions) { calls.push('sync:' + actions.map((a) => a.type).join(',')); sent.push(actions); return actions.map((a) => ({ client_id: a.client_id, status: 'confirmed' as const })) },
    async uploadPhoto(jobId, kind) { calls.push(`photo:${jobId}:${kind}`) },
    ...over,
  }
  const store = memStore()
  const blobs = memoryBlobs()
  const q = new OfflineQueue({ store, blobs, transport, newId: () => `id${++n}`, now: () => new Date('2025-01-01T10:00:00Z'), ...extra })
  return { q, calls, sent, store, blobs, transport }
}
const J = 'job1'

describe('state labels', () => {
  it('use the exact wording the spec requires', () => {
    expect(STATE_LABEL).toEqual({
      local: 'Locally recorded', pending: 'Pending synchronization', confirmed: 'Server confirmed', rejected: 'Rejected by server',
    })
  })
  it('a new item is only "Locally recorded", never confirmed', () => {
    const { q } = setup()
    const it = q.enqueue({ type: 'accept', job_id: J })
    expect(STATE_LABEL[q.find(it.id)!.state]).toBe('Locally recorded')
  })
})

describe('ordering and batching', () => {
  it('replays strictly in recorded order, batching consecutive actions around photos', async () => {
    const { q, calls } = setup()
    q.enqueue({ type: 'accept', job_id: J })
    q.enqueue({ type: 'start_journey', job_id: J })
    q.enqueue({ type: 'arrive', job_id: J })
    await q.enqueuePhoto(J, 'before', new Blob(['x']), 'b.jpg')
    q.enqueue({ type: 'start_work', job_id: J })
    await q.enqueuePhoto(J, 'after', new Blob(['y']), 'a.jpg')
    q.enqueue({ type: 'resolve', job_id: J, payload: { resolution: 'repaired' } })
    const out = await q.sync()
    expect(calls).toEqual(['sync:accept,start_journey,arrive', `photo:${J}:before`, 'sync:start_work', `photo:${J}:after`, 'sync:resolve'])
    expect(out).toEqual({ sent: 7, stopped: null })
    expect(q.getItems().every((i) => i.state === 'confirmed')).toBe(true)
  })

  it('sends the device time as occurred_at and the item id as client_id', async () => {
    const { q, sent } = setup()
    const it = q.enqueue({ type: 'hold', job_id: J, payload: { reason_code: 'site_access_delay' }, occurred_at: '2025-01-01T09:00:00.000Z' })
    await q.sync()
    expect(sent[0][0]).toMatchObject({ client_id: it.id, type: 'hold', job_id: J, occurred_at: '2025-01-01T09:00:00.000Z', payload: { reason_code: 'site_access_delay' } })
  })

  it('caps a batch and continues with the rest', async () => {
    const { q, sent } = setup({}, { maxBatch: 2 })
    for (let i = 0; i < 5; i++) q.enqueue({ type: 'ping', payload: { lat: 1, lon: 1 } })
    await q.sync()
    expect(sent.map((b) => b.length)).toEqual([2, 2, 1])
  })
})

describe('offline and replay', () => {
  it('keeps items "Pending synchronization" when offline and resends the SAME client ids later (idempotent replay)', async () => {
    let offline = true
    const seen: string[][] = []
    const { q } = setup({
      async sync(actions) {
        seen.push(actions.map((a) => a.client_id))
        if (offline) throw new ApiError(0, null, true)
        return actions.map((a) => ({ client_id: a.client_id, status: 'confirmed' as const }))
      },
    })
    const a = q.enqueue({ type: 'accept', job_id: J })
    const b = q.enqueue({ type: 'start_journey', job_id: J })
    expect(await q.sync()).toEqual({ sent: 0, stopped: 'offline' })
    expect(q.getItems().map((i) => STATE_LABEL[i.state])).toEqual(['Pending synchronization', 'Pending synchronization'])
    offline = false
    expect(await q.sync()).toEqual({ sent: 2, stopped: null })
    expect(seen).toEqual([[a.id, b.id], [a.id, b.id]])
    expect(q.getItems().map((i) => i.state)).toEqual(['confirmed', 'confirmed'])
  })

  it('survives an app restart: a new queue on the same store still holds the unsent work', () => {
    const { q, store } = setup()
    q.enqueue({ type: 'accept', job_id: J })
    const reopened = new OfflineQueue({ store, blobs: memoryBlobs(), transport: setup().transport })
    expect(reopened.unsynced()).toHaveLength(1)
    expect(reopened.getItems()[0].type).toBe('accept')
  })

  it('shares one run between concurrent sync calls', async () => {
    const { q, calls } = setup()
    q.enqueue({ type: 'accept', job_id: J })
    const [x, y] = [q.sync(), q.sync()]
    await Promise.all([x, y])
    await q.sync()
    expect(calls.filter((c) => c.startsWith('sync')).length).toBe(1)
  })
})

describe('rejections', () => {
  it('shows the server reason on the refused item and keeps going with the others', async () => {
    const { q } = setup({
      async sync(actions) {
        return actions.map((a): SyncResult => (a.type === 'arrive'
          ? { client_id: a.client_id, status: 'rejected', error: 'Cannot mark arrival: job is ACCEPTED', code: 409 }
          : { client_id: a.client_id, status: 'confirmed' }))
      },
    })
    q.enqueue({ type: 'accept', job_id: J })
    q.enqueue({ type: 'arrive', job_id: J })
    await q.sync()
    const [ok, bad] = q.getItems()
    expect(ok.state).toBe('confirmed')
    expect(bad).toMatchObject({ state: 'rejected', error: 'Cannot mark arrival: job is ACCEPTED', code: 409 })
    expect(STATE_LABEL[bad.state]).toBe('Rejected by server')
  })

  it('does not retry a whole-request 4xx forever', async () => {
    let n = 0
    const { q } = setup({ async sync() { n++; throw new ApiError(403, 'Technician-only endpoint') } })
    q.enqueue({ type: 'accept', job_id: J })
    await q.sync()
    await q.sync()
    expect(n).toBe(1)
    expect(q.getItems()[0]).toMatchObject({ state: 'rejected', code: 403 })
  })

  it('treats 5xx as transient, then gives up after maxAttempts', async () => {
    const { q } = setup({ async sync() { throw new ApiError(503, 'down') } }, { maxAttempts: 3 })
    q.enqueue({ type: 'accept', job_id: J })
    expect((await q.sync()).stopped).toBe('server')
    expect(q.getItems()[0].state).toBe('pending')
    await q.sync()
    await q.sync()
    expect(q.getItems()[0].state).toBe('rejected')
  })

  it('stops on 401 and keeps the work pending (sign in again to send it)', async () => {
    const { q } = setup({ async sync() { throw new ApiError(401, 'expired') } })
    q.enqueue({ type: 'accept', job_id: J })
    expect((await q.sync()).stopped).toBe('auth')
    expect(q.getItems()[0].state).toBe('pending')
  })

  it('marks a ping the server received but did not store, without calling it an error', async () => {
    const { q } = setup({ async sync(actions) { return actions.map((a) => ({ client_id: a.client_id, status: 'confirmed' as const, accepted: false, reason: 'throttled' })) } })
    q.enqueue({ type: 'ping', payload: { lat: 1, lon: 1 } })
    await q.sync()
    expect(q.getItems()[0]).toMatchObject({ state: 'confirmed', note: 'Not stored: throttled' })
  })

  it('rejects a photo whose data is gone and a photo the server refuses', async () => {
    const { q, blobs } = setup({ async uploadPhoto() { throw new ApiError(409, 'Evidence can be added while on site (job is ACCEPTED)') } })
    const p1 = await q.enqueuePhoto(J, 'before', new Blob(['x']), 'x.jpg')
    await q.sync()
    expect(q.find(p1.id)).toMatchObject({ state: 'rejected', error: expect.stringContaining('on site') })
    const p2 = await q.enqueuePhoto(J, 'after', new Blob(['x']), 'y.jpg')
    await blobs.del(q.find(p2.id)!.photo!.key)
    await q.sync()
    expect(q.find(p2.id)!.error).toContain('no longer on this device')
  })

  it('discard removes a refused item and its photo data', async () => {
    const { q, blobs } = setup({ async uploadPhoto() { throw new ApiError(422, 'bad') } })
    const p = await q.enqueuePhoto(J, 'before', new Blob(['x']), 'x.jpg')
    await q.sync()
    const key = q.find(p.id)!.photo!.key
    await q.discard(p.id)
    expect(q.getItems()).toHaveLength(0)
    expect(await blobs.get(key)).toBeUndefined()
  })
})

describe('housekeeping', () => {
  it('keeps only the most recent GPS pings while offline', () => {
    const { q } = setup({}, { maxPings: 3 })
    for (let i = 0; i < 6; i++) q.enqueue({ type: 'ping', payload: { n: i } })
    expect(q.getItems().map((i) => i.payload.n)).toEqual([3, 4, 5])
  })

  it('prunes old confirmed items', async () => {
    const { q } = setup({}, { keepConfirmed: 2 })
    for (let i = 0; i < 5; i++) q.enqueue({ type: 'accept', job_id: 'j' + i })
    await q.sync()
    expect(q.getItems()).toHaveLength(2)
  })

  it('notifies subscribers and reports syncing', async () => {
    const { q } = setup()
    let hits = 0
    q.subscribe(() => hits++)
    q.enqueue({ type: 'accept', job_id: J })
    const p = q.sync()
    expect(q.isSyncing()).toBe(true)
    await p
    expect(q.isSyncing()).toBe(false)
    expect(hits).toBeGreaterThan(2)
  })
})

describe('projectStatus (enables the next legal button offline; never shown as the real status)', () => {
  const mk = (type: QueueItem['type'], state: QueueItem['state'] = 'local'): QueueItem => ({ id: type + state, type, payload: {}, occurred_at: '', state, attempts: 0 })
  it('walks the happy path through queued actions', () => {
    expect(projectStatus('NOTIFIED', [mk('accept'), mk('start_journey'), mk('arrive')])).toBe('ARRIVED')
    expect(projectStatus('ARRIVED', [mk('start_work'), mk('hold'), mk('resume'), mk('resolve')])).toBe('VERIFICATION')
  })
  it('ignores confirmed, rejected and impossible actions', () => {
    expect(projectStatus('NOTIFIED', [mk('accept', 'confirmed')])).toBe('NOTIFIED')
    expect(projectStatus('NOTIFIED', [mk('accept', 'rejected')])).toBe('NOTIFIED')
    expect(projectStatus('ACCEPTED', [mk('arrive')])).toBe('ACCEPTED')
    expect(projectStatus('NOTIFIED', [mk('reject')])).toBe('REJECTED')
  })
})
