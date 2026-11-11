import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { Card, ErrorState, Loading } from '../../components/ui'
import { haversineKm } from '../../lib/gps'
import { useMobile } from './MobileContext'
import { BackHeader, BigButton, StatusPanel, useJobData } from './parts'

/** M05 — Arrival confirmation. Your position is shown as a hint only; you decide whether you are on site. */
export default function Arrival() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { perform, trackerState: t } = useMobile()
  const d = useJobData(id)
  if (d.loading) return <Loading />
  if (!d.job || !d.serverStatus || !d.projected) return <ErrorState message={d.error ?? 'Job not found'} onRetry={() => void d.reload()} />
  const dev = d.job.device
  const km = t.lastFix && dev?.lat != null && dev.lon != null ? haversineKm(t.lastFix.lat, t.lastFix.lon, dev.lat, dev.lon) : null
  const p = d.projected
  return (
    <div>
      <BackHeader title="Arrival" to={`/m/job/${id}`} />
      <Card className="p-4 space-y-2">
        <div className="font-semibold text-lg">{dev?.code} · {dev?.type}</div>
        <div className="text-sm text-muted">{dev?.address ?? 'Address not set'}</div>
        {km !== null && (km > 0.5
          ? <div className="flex items-start gap-2 text-sm text-warn bg-warn-50 border border-warn-100 rounded p-2"><TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />Your phone puts you about {km.toFixed(1)} km from the site (accuracy ±{Math.round(t.lastFix!.accuracy_m)} m). GPS is only a hint: confirm arrival only if you are really there.</div>
          : <div className="text-sm text-ok">Your phone puts you about {Math.round(km * 1000)} m from the site.</div>)}
        {km === null && <div className="text-xs text-muted">No position fix available. You can still confirm arrival yourself.</div>}
      </Card>
      <div className="mt-3"><StatusPanel serverStatus={d.serverStatus} projected={p} pending={d.pending} /></div>
      <div className="grid gap-3 mt-4">
        {p === 'EN_ROUTE' && <BigButton variant="primary" onClick={() => void perform('arrive', id)}><CheckCircle2 size={20} /> Confirm: I am on site</BigButton>}
        {p === 'ARRIVED' && <BigButton variant="primary" onClick={async () => { if ((await perform('start_work', id)) !== 'rejected') nav(`/m/job/${id}/checklist`) }}>Start work</BigButton>}
        {p !== 'EN_ROUTE' && p !== 'ARRIVED' && <Card className="p-3 text-sm text-muted">Arrival can be confirmed while the job is en route.</Card>}
      </div>
    </div>
  )
}
