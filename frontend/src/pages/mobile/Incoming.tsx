import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BellRing, MapPin } from 'lucide-react'
import { Card, ErrorState, Loading, PriorityBadge } from '../../components/ui'
import { useMobile } from './MobileContext'
import { BackHeader, BigButton, REJECT_OPTIONS, ReasonSheet, SlaClock, StatusPanel, useJobData } from './parts'

/** M02 — Incoming job: everything needed to decide, then Accept or Reject (reason is mandatory). */
export default function Incoming() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { perform } = useMobile()
  const d = useJobData(id)
  const [rejecting, setRejecting] = useState(false)
  if (d.loading) return <Loading />
  if (!d.job || !d.serverStatus || !d.projected) return <ErrorState message={d.error ?? 'Job not found'} onRetry={() => void d.reload()} />
  const job = d.job
  const canAnswer = d.projected === 'NOTIFIED'
  const hot = job.priority === 'critical' || job.priority === 'high'
  return (
    <div>
      <BackHeader title="Incoming job" to="/m" />
      <Card className={`p-4 border-2 ${hot ? 'border-crit' : 'border-primary/40'}`}>
        <div className="flex items-center gap-2 mb-2"><BellRing className={hot ? 'text-crit' : 'text-primary'} aria-hidden /><span className="text-lg font-semibold">{job.code}</span><PriorityBadge priority={job.priority} /></div>
        <dl className="space-y-2 text-base">
          <div><dt className="text-xs text-muted">Device</dt><dd className="font-medium">{job.device?.code} · {job.device?.type}{job.device?.model ? ` · ${job.device.model}` : ''}</dd></div>
          <div><dt className="text-xs text-muted">Incident</dt><dd>{job.category?.name ?? 'Uncategorized'}</dd></div>
          <div><dt className="text-xs text-muted">Description</dt><dd>{job.description}</dd></div>
          <div><dt className="text-xs text-muted">Location</dt><dd className="flex items-start gap-1"><MapPin size={16} className="mt-1 shrink-0" aria-hidden />{job.device?.address ?? 'Address not set'}{job.device?.bank ? ` (${job.device.bank})` : ''}</dd></div>
          <div><dt className="text-xs text-muted">SLA deadline</dt><dd><SlaClock job={job} /></dd></div>
        </dl>
      </Card>
      <div className="mt-3"><StatusPanel serverStatus={d.serverStatus} projected={d.projected} pending={d.pending} /></div>
      {canAnswer ? (
        <div className="grid gap-3 mt-4">
          <BigButton variant="primary" onClick={async () => { if ((await perform('accept', id)) !== 'rejected') nav(`/m/job/${id}`) }}>Accept job</BigButton>
          <BigButton onClick={() => setRejecting(true)}>Reject with reason</BigButton>
        </div>
      ) : (
        <Card className="p-4 mt-4 text-sm">This job is no longer waiting for your answer. <Link to={`/m/job/${id}`} className="text-primary underline">Open job</Link></Card>
      )}
      <ReasonSheet open={rejecting} title="Why are you rejecting this job?" options={REJECT_OPTIONS} confirmLabel="Reject job" danger onClose={() => setRejecting(false)}
        onConfirm={async (r) => { await perform('reject', id, { reason: r.value === 'other' ? r.note : `${r.label}${r.note ? `: ${r.note}` : ''}` }); nav('/m') }} />
    </div>
  )
}
