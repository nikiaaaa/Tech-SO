import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Camera, FileText } from 'lucide-react'
import { Badge, Card, Empty, ErrorState, Loading, ProgressBar, cn } from '../../components/ui'
import { HOLD_REASONS } from '../../lib/format'
import { useMobile } from './MobileContext'
import { BackHeader, BigButton, ReasonSheet, StatusPanel, useJobData } from './parts'
import { checkSummary, useChecklist } from './checklistState'

const HOLD_OPTIONS = Object.entries(HOLD_REASONS).map(([value, label]) => ({ value, label }))
const linkBtn = 'inline-flex items-center justify-center gap-2 rounded border border-line bg-surface text-base font-medium min-h-[48px] px-4 w-full active:bg-canvas'

/** M06 — Work checklist, with hold (reason required) and resume. */
export default function Checklist() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { perform } = useMobile()
  const d = useJobData(id)
  const cl = useChecklist(id, d.job?.category?.id)
  const [holding, setHolding] = useState(false)
  if (d.loading) return <Loading />
  if (!d.job || !d.serverStatus || !d.projected) return <ErrorState message={d.error ?? 'Job not found'} onRetry={() => void d.reload()} />
  const p = d.projected
  const s = checkSummary(cl.items)
  const editable = p === 'IN_PROGRESS' || p === 'ARRIVED'
  return (
    <div>
      <BackHeader title="Checklist" to={`/m/job/${id}`} right={<Badge tone="info">{s.done}/{s.total}</Badge>} />
      <StatusPanel serverStatus={d.serverStatus} projected={p} pending={d.pending} />
      {d.job.hold_reason && d.serverStatus === 'ON_HOLD' && <Card className="p-3 mt-3 text-sm border-warn-100 bg-warn-50">On hold: <b>{HOLD_REASONS[d.job.hold_reason] ?? d.job.hold_reason}</b>. The SLA clock keeps running while a job is on hold.</Card>}

      <div className="mt-3">
        {!cl.loaded && <Loading />}
        {cl.loaded && cl.error && !cl.hasTemplate && <ErrorState message={`Checklist not available: ${cl.error}`} />}
        {cl.loaded && !cl.error && !cl.hasTemplate && <Card><Empty title="No checklist for this job" hint="This incident category has no checklist. You can still add photos and submit your report." /></Card>}
        {cl.hasTemplate && (
          <Card className="p-3">
            <ProgressBar value={s.total ? (100 * s.done) / s.total : 0} tone="ok" />
            <ul className="mt-3 space-y-2">
              {cl.items.map((i) => (
                <li key={i.label}>
                  <label className={cn('flex items-center gap-3 rounded-md border p-3 tap', i.done ? 'border-ok-100 bg-ok-50' : 'border-line', !editable && 'opacity-70')}>
                    <input type="checkbox" className="w-6 h-6" checked={i.done} disabled={!editable} onChange={() => cl.toggle(i.label)} />
                    <span className={i.done ? 'line-through text-muted' : ''}>{i.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            {!editable && <p className="text-xs text-muted mt-2">Ticks can be changed while the job is in progress.</p>}
            <p className="text-xs text-muted mt-2">Ticks are saved on this device and sent with your report.</p>
          </Card>
        )}
      </div>

      <div className="grid gap-2.5 mt-4">
        {p === 'ARRIVED' && <BigButton variant="primary" onClick={() => void perform('start_work', id)}>Start work</BigButton>}
        {p === 'IN_PROGRESS' && <BigButton onClick={() => setHolding(true)}>Put job on hold</BigButton>}
        {p === 'ON_HOLD' && <BigButton variant="primary" onClick={() => void perform('resume', id)}>Resume work</BigButton>}
        {(p === 'ARRIVED' || p === 'IN_PROGRESS' || p === 'ON_HOLD') && <Link className={linkBtn} to={`/m/job/${id}/evidence`}><Camera size={20} /> Photos</Link>}
        {p === 'IN_PROGRESS' && <Link className={linkBtn} to={`/m/job/${id}/report`}><FileText size={20} /> Continue to report</Link>}
        {p !== 'ARRIVED' && p !== 'IN_PROGRESS' && p !== 'ON_HOLD' && <Card className="p-3 text-sm text-muted">The checklist is used once you are on site and working.</Card>}
      </div>

      <ReasonSheet open={holding} title="Why is the job on hold?" options={HOLD_OPTIONS} confirmLabel="Put on hold" onClose={() => setHolding(false)}
        onConfirm={async (r) => { await perform('hold', id, { reason_code: r.value, note: r.note || undefined }); nav(`/m/job/${id}`) }} />
    </div>
  )
}
