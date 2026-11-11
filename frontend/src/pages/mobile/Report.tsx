import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Circle } from 'lucide-react'
import { Card, ErrorState, Field, Input, Loading, Select, Textarea } from '../../components/ui'
import { RESOLUTIONS } from '../../lib/format'
import { useMobile } from './MobileContext'
import { BackHeader, BigButton, StatusPanel, useJobData } from './parts'
import { checkSummary, useChecklist } from './checklistState'

const Req = ({ ok, children }: { ok: boolean; children: string }) => (
  <li className={`flex items-center gap-2 text-sm ${ok ? 'text-ok' : 'text-muted'}`}>{ok ? <CheckCircle2 size={16} aria-hidden /> : <Circle size={16} aria-hidden />}{children}</li>
)

/** M08 — Job report. Mirrors the server rules so the technician finds out before submitting. */
export default function Report() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { perform } = useMobile()
  const d = useJobData(id)
  const cl = useChecklist(id, d.job?.category?.id)
  const [resolution, setResolution] = useState('')
  const [notes, setNotes] = useState('')
  const [parts, setParts] = useState('')
  const [busy, setBusy] = useState(false)
  if (d.loading) return <Loading />
  if (!d.job || !d.serverStatus || !d.projected) return <ErrorState message={d.error ?? 'Job not found'} onRetry={() => void d.reload()} />
  const afterServer = (d.detail?.evidence ?? []).filter((e) => e.kind === 'after').length
  const afterQueued = d.all.filter((i) => i.type === 'photo' && i.photo?.kind === 'after' && i.state !== 'rejected' && i.state !== 'confirmed').length
  const afterPhotos = afterServer + afterQueued
  const s = checkSummary(cl.items)
  const ready = !!resolution && notes.trim().length >= 5 && afterPhotos >= 1
  const canSubmit = d.projected === 'IN_PROGRESS'

  const submit = async () => {
    setBusy(true)
    try {
      const out = await perform('resolve', id, { resolution, notes: notes.trim(), checklist: cl.items, parts_used: parts.trim() || undefined })
      if (out !== 'rejected') nav(`/m/job/${id}`)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <BackHeader title="Job report" to={`/m/job/${id}`} />
      <StatusPanel serverStatus={d.serverStatus} projected={d.projected} pending={d.pending} />
      {!canSubmit && <Card className="p-3 mt-3 text-sm">A report can be submitted while the job is in progress. {d.projected === 'ON_HOLD' ? 'Resume work first.' : d.projected === 'ARRIVED' ? 'Start work first.' : ''}</Card>}
      <Card className="p-4 mt-3 space-y-4">
        <Field label="Result"><Select className="tap" value={resolution} onChange={(e) => setResolution(e.target.value)}>
          <option value="">Choose…</option>{Object.entries(RESOLUTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select></Field>
        <Field label="Service notes" hint="What was wrong and what you did (min 5 characters)"><Textarea className="min-h-[120px] text-base" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Parts used (optional)"><Input className="tap" value={parts} onChange={(e) => setParts(e.target.value)} /></Field>
        <div className="text-sm">Checklist: <b>{s.done}/{s.total}</b> done {s.total > s.done && <span className="text-warn">(unticked items will be reported as not done)</span>} <Link className="text-primary underline ml-1" to={`/m/job/${id}/checklist`}>Edit</Link></div>
        <ul className="space-y-1.5">
          <Req ok={!!resolution}>Result chosen</Req>
          <Req ok={notes.trim().length >= 5}>Service notes written</Req>
          <Req ok={afterPhotos >= 1}>{`At least one "after" photo (${afterServer} confirmed, ${afterQueued} waiting on this device)`}</Req>
        </ul>
        {afterPhotos < 1 && <Link className="text-primary underline text-sm" to={`/m/job/${id}/evidence`}>Add an after photo</Link>}
      </Card>
      <div className="mt-4"><BigButton variant="primary" disabled={!ready || !canSubmit} loading={busy} onClick={() => void submit()}>Submit report</BigButton></div>
      <p className="text-xs text-muted mt-2">After you submit, the scheduler verifies the work. The job is only closed after that approval.</p>
    </div>
  )
}
