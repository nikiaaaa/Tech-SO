import { Link, useNavigate, useParams } from 'react-router-dom'
import { Camera, ClipboardCheck, FileText, MapPin, Navigation, Phone } from 'lucide-react'
import { EVENT_LABEL, fmtDateTime, HOLD_REASONS } from '../../lib/format'
import type { JobDetail } from '../../lib/types'
import { Badge, Card, ErrorState, Loading, PriorityBadge, SlaBadge } from '../../components/ui'
import { useMobile } from './MobileContext'
import { BackHeader, BigButton, SectionTitle, SlaClock, StatusPanel, useJobData } from './parts'

const linkBtn = 'inline-flex items-center justify-center gap-2 rounded border border-line bg-surface text-base font-medium min-h-[48px] px-4 w-full active:bg-canvas'

/** M03 — Job details with only the actions that are valid for the current status. */
export default function JobDetails() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { perform } = useMobile()
  const d = useJobData(id)
  if (d.loading) return <Loading />
  if (!d.job || !d.serverStatus || !d.projected) return <ErrorState message={d.error ?? 'Job not found'} onRetry={() => void d.reload()} />
  const job = d.job
  const p = d.projected
  const events = (d.detail as JobDetail | null)?.events ?? []
  const correction = [...events].reverse().find((e) => e.type === 'correction_requested')
  return (
    <div>
      <BackHeader title={job.code} to="/m" right={<PriorityBadge priority={job.priority} />} />
      <StatusPanel serverStatus={d.serverStatus} projected={p} pending={d.pending} />

      {correction && d.serverStatus === 'IN_PROGRESS' && (
        <Card className="p-3 mt-3 border-warn-100 bg-warn-50 text-sm"><b>Correction requested:</b> {correction.note}</Card>
      )}

      <Card className="p-4 mt-3 space-y-2">
        <div className="flex items-center justify-between"><SlaClock job={job} /><SlaBadge state={job.sla.state} /></div>
        <div className="text-base">{job.description}</div>
        <div className="text-sm text-muted">{job.category?.name ?? 'Uncategorized'}</div>
        {job.hold_reason && <Badge tone="warn">On hold: {HOLD_REASONS[job.hold_reason] ?? job.hold_reason}</Badge>}
      </Card>

      <SectionTitle>Device</SectionTitle>
      <Card className="p-4 text-base space-y-1">
        <div className="font-semibold">{job.device?.code} · {job.device?.type}</div>
        {job.device?.model && <div className="text-sm text-muted">Model {job.device.model}</div>}
        {job.device?.bank && <div className="text-sm text-muted">{job.device.bank}</div>}
        <div className="flex items-start gap-1 text-sm"><MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />{job.device?.address ?? 'Address not set'}</div>
        {job.device?.status && <div><Badge tone={job.device.status === 'online' ? 'ok' : 'warn'}>Device {job.device.status}</Badge></div>}
        <div className="text-xs text-muted flex items-center gap-1"><Phone size={12} aria-hidden /> Contact dispatch through your supervisor.</div>
      </Card>

      <SectionTitle>Next step</SectionTitle>
      <div className="grid gap-2.5">
        {p === 'NOTIFIED' && <Link className={linkBtn} to={`/m/job/${id}/incoming`}>Respond: accept or reject</Link>}
        {p === 'ACCEPTED' && <BigButton variant="primary" onClick={async () => { if ((await perform('start_journey', id)) !== 'rejected') nav(`/m/job/${id}/navigate`) }}><Navigation size={20} /> Start journey</BigButton>}
        {p === 'EN_ROUTE' && (<>
          <Link className={linkBtn} to={`/m/job/${id}/navigate`}><Navigation size={20} /> Open navigation</Link>
          <Link className={linkBtn} to={`/m/job/${id}/arrival`}>I have arrived</Link>
        </>)}
        {p === 'ARRIVED' && <BigButton variant="primary" onClick={async () => { if ((await perform('start_work', id)) !== 'rejected') nav(`/m/job/${id}/checklist`) }}>Start work</BigButton>}
        {p === 'ON_HOLD' && <BigButton variant="primary" onClick={() => void perform('resume', id)}>Resume work</BigButton>}
        {(p === 'IN_PROGRESS' || p === 'ON_HOLD' || p === 'ARRIVED') && (<>
          <Link className={linkBtn} to={`/m/job/${id}/checklist`}><ClipboardCheck size={20} /> Checklist{p === 'IN_PROGRESS' ? ' and hold' : ''}</Link>
          <Link className={linkBtn} to={`/m/job/${id}/evidence`}><Camera size={20} /> Photos (before / after)</Link>
        </>)}
        {p === 'IN_PROGRESS' && <Link className={linkBtn} to={`/m/job/${id}/report`}><FileText size={20} /> Submit report</Link>}
        {(p === 'VERIFICATION' || p === 'RESOLVED') && <Card className="p-3 text-sm">Report submitted. Waiting for the scheduler to verify it.</Card>}
        {(p === 'CLOSED' || p === 'CANCELLED' || p === 'REJECTED') && <Card className="p-3 text-sm text-muted">No further action on this job.</Card>}
      </div>

      <SectionTitle>Timeline (from server)</SectionTitle>
      <Card className="divide-y divide-line">
        {events.length === 0 && <div className="p-3 text-sm text-muted">Timeline not available right now.</div>}
        {events.slice().reverse().slice(0, 12).map((e) => (
          <div key={e.id} className="p-3 text-sm"><div className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</div>{e.note && <div className="text-muted">{e.note}</div>}<div className="text-xs text-muted">{fmtDateTime(e.occurred_at)}{e.actor ? ` · ${e.actor}` : ''}</div></div>
        ))}
      </Card>
      <p className="mt-4 text-xs text-muted"><Link to="/m/sync" className="underline">Sync queue</Link></p>
    </div>
  )
}
