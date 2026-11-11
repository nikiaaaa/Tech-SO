import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { api } from '../../lib/api'
import { MAX_PHOTO_BYTES } from '../../lib/format'
import type { Evidence as EvidenceT } from '../../lib/types'
import type { QueueItem } from '../../lib/offline'
import { Badge, Card, ErrorState, Loading, useToast } from '../../components/ui'
import { downscale, photoProblem } from './image'
import { useMobile } from './MobileContext'
import { BackHeader, SectionTitle, StateBadge, StatusPanel, useJobData } from './parts'

const ON_SITE = ['ARRIVED', 'IN_PROGRESS', 'ON_HOLD']

function useObjectUrl(load: () => Promise<Blob | undefined>, deps: unknown[]) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let u: string | null = null
    load().then((b) => { if (alive && b) { u = URL.createObjectURL(b); setUrl(u) } }).catch(() => {})
    return () => { alive = false; if (u) URL.revokeObjectURL(u) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return url
}

function ServerPhoto({ e }: { e: EvidenceT }) {
  const url = useObjectUrl(() => api.blob(`/evidence/${e.id}`), [e.id])
  return (
    <figure className="rounded-md overflow-hidden border border-line">
      {url ? <img src={url} alt={`${e.kind} photo`} className="w-full h-32 object-cover" /> : <div className="h-32 grid place-items-center text-xs text-muted bg-canvas">Loading…</div>}
      <figcaption className="p-1.5 flex items-center justify-between text-xs"><Badge tone={e.kind === 'after' ? 'ok' : 'info'}>{e.kind}</Badge><Badge tone="ok">Server confirmed</Badge></figcaption>
    </figure>
  )
}

function QueuedPhoto({ item }: { item: QueueItem }) {
  const { queue } = useMobile()
  const url = useObjectUrl(() => queue.getPhotoBlob(item), [item.id])
  return (
    <figure className="rounded-md overflow-hidden border border-warn-100">
      {url ? <img src={url} alt={`${item.photo?.kind} photo, not yet uploaded`} className="w-full h-32 object-cover" /> : <div className="h-32 grid place-items-center text-xs text-muted bg-canvas">No preview</div>}
      <figcaption className="p-1.5 space-y-1 text-xs">
        <div className="flex items-center justify-between"><Badge tone={item.photo?.kind === 'after' ? 'ok' : 'info'}>{item.photo?.kind}</Badge><StateBadge state={item.state} /></div>
        {item.state === 'rejected' && <div className="text-crit">{item.error}</div>}
      </figcaption>
    </figure>
  )
}

/** M07 — Evidence upload: camera capture, before / after, queued when offline. */
export default function EvidenceScreen() {
  const { id = '' } = useParams()
  const { addPhoto, queue } = useMobile()
  const toast = useToast()
  const d = useJobData(id)
  const [kind, setKind] = useState<'before' | 'after'>('before')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  if (d.loading) return <Loading />
  if (!d.job || !d.serverStatus || !d.projected) return <ErrorState message={d.error ?? 'Job not found'} onRetry={() => void d.reload()} />
  const server = d.detail?.evidence ?? []
  const queued = d.all.filter((i) => i.type === 'photo' && i.state !== 'confirmed')
  const canAdd = ON_SITE.includes(d.projected)

  const pick = async (file: File | undefined) => {
    if (!file) return
    const first = photoProblem({ type: file.type || 'image/jpeg', size: file.size || 1 }, Number.MAX_SAFE_INTEGER)
    if (first) { toast('error', first); return }
    setBusy(true)
    try {
      const blob = await downscale(file)
      const problem = photoProblem({ type: blob.type || 'image/jpeg', size: blob.size }, MAX_PHOTO_BYTES)
      if (problem) { toast('error', problem); return }
      await addPhoto(id, kind, blob, `${kind}-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`)
    } finally { setBusy(false); if (input.current) input.current.value = '' }
  }

  return (
    <div>
      <BackHeader title="Photos" to={`/m/job/${id}`} />
      <StatusPanel serverStatus={d.serverStatus} projected={d.projected} pending={d.pending} />
      <Card className="p-3 mt-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Photo type">
          {(['before', 'after'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={`rounded-md border-2 min-h-[48px] font-medium ${kind === k ? 'border-primary bg-primary-50 text-primary-700' : 'border-line'}`}>{k === 'before' ? 'Before repair' : 'After repair'}</button>
          ))}
        </div>
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} aria-label="Take photo" />
        <button disabled={!canAdd || busy} onClick={() => input.current?.click()}
          className="mt-3 w-full rounded-md bg-primary text-white min-h-[56px] text-base font-semibold flex items-center justify-center gap-2 disabled:bg-primary/40">
          <Camera size={22} aria-hidden /> {busy ? 'Preparing photo…' : `Take ${kind} photo`}
        </button>
        {!canAdd && <p className="text-xs text-muted mt-2">Photos can be added once you are on site and until you submit your report.</p>}
        <p className="text-xs text-muted mt-2">Photos are shrunk to about 1600 px. Max {Math.round(MAX_PHOTO_BYTES / 1048576)} MB. Without a connection they stay on this device and upload later, in order.</p>
      </Card>

      {queued.length > 0 && (<><SectionTitle>On this device ({queued.length})</SectionTitle><div className="grid grid-cols-2 gap-3">{queued.map((q) => <div key={q.id}><QueuedPhoto item={q} />{q.state === 'rejected' && <button className="text-xs text-crit underline mt-1" onClick={() => void queue.discard(q.id)}>Remove</button>}</div>)}</div></>)}
      <SectionTitle>Confirmed by server ({server.length})</SectionTitle>
      {server.length === 0 ? <Card className="p-4 text-sm text-muted">No photos confirmed by the server yet.</Card>
        : <div className="grid grid-cols-2 gap-3">{server.map((e) => <ServerPhoto key={e.id} e={e} />)}</div>}
    </div>
  )
}
