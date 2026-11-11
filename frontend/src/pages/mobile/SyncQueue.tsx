import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { fmtDateTime } from '../../lib/format'
import { STATE_LABEL, TYPE_LABEL, type QueueItem } from '../../lib/offline'
import { Button, Card, Empty } from '../../components/ui'
import { useMobile } from './MobileContext'
import { StateBadge } from './parts'

function Row({ it, code, onDiscard }: { it: QueueItem; code?: string; onDiscard: () => void }) {
  return (
    <li className="p-3 space-y-1">
      <div className="flex items-center justify-between gap-2"><div className="font-medium">{TYPE_LABEL[it.type]}{it.photo ? ` (${it.photo.kind})` : ''}</div><StateBadge state={it.state} /></div>
      <div className="text-xs text-muted">{code ? <Link className="underline" to={`/m/job/${it.job_id}`}>{code}</Link> : 'No job'} · done {fmtDateTime(it.occurred_at)}{it.attempts > 0 && it.state !== 'confirmed' ? ` · ${it.attempts} attempt(s)` : ''}</div>
      {it.state === 'rejected' && <div className="text-sm text-crit">{it.error}{it.code ? ` (${it.code})` : ''}</div>}
      {it.note && <div className="text-xs text-muted">{it.note}</div>}
      {it.state === 'rejected' && <button className="text-xs text-crit underline min-h-[32px]" onClick={onDiscard}>Remove from this list</button>}
    </li>
  )
}

/** M12 — Sync queue: every action on this device, with the exact state it is in. */
export default function SyncQueue() {
  const m = useMobile()
  const items = [...m.items].reverse()
  const codes = new Map((m.jobs ?? []).map((j) => [j.id, j.code]))
  const count = (s: QueueItem['state']) => m.items.filter((i) => i.state === s).length
  return (
    <div>
      <h1 className="text-xl mb-3">Sync queue</h1>
      <Card className="p-3 grid grid-cols-4 gap-1 text-center text-xs">
        {(['local', 'pending', 'confirmed', 'rejected'] as const).map((s) => <div key={s}><div className="text-xl font-semibold tabular-nums">{count(s)}</div><div className="text-muted">{STATE_LABEL[s]}</div></div>)}
      </Card>
      <div className="mt-3 flex items-center gap-2">
        <Button size="lg" variant="primary" className="flex-1" loading={m.syncing} disabled={!m.online || m.unsynced === 0} onClick={() => void m.syncNow()}><RefreshCw size={18} aria-hidden /> Retry now</Button>
      </div>
      <p className="text-xs text-muted mt-2">{m.online ? 'Online. Items are sent in the order you did them.' : 'Offline. Items stay here and are sent automatically when the connection returns.'} Only "Server confirmed" means the server has accepted it.</p>
      <Card className="mt-3">
        {items.length === 0 ? <Empty title="Nothing on this device" hint="Actions you take are recorded here before they are sent." />
          : <ul className="divide-y divide-line">{items.map((it) => <Row key={it.id} it={it} code={it.job_id ? codes.get(it.job_id) : undefined} onDiscard={() => void m.queue.discard(it.id)} />)}</ul>}
      </Card>
    </div>
  )
}
