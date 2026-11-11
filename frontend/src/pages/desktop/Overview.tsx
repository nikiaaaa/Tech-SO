import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ClipboardList, Clock3, ShieldAlert, UserCheck, UserCog, UserX, Zap } from 'lucide-react'
import { api } from '../../lib/api'
import { useAsync, useNow } from '../../lib/hooks'
import { EVENT_LABEL, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, timeAgo } from '../../lib/format'
import type { JobStatus, Overview as OverviewData } from '../../lib/types'
import { Async, Card, CardHeader, Donut, KpiCard, PageHeader, Select } from '../../components/ui'
import { PRIORITY_COLOR, useJobEvents } from './common'

const RANGES = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' } as const

/** D01 — Operations Control Center. Every number comes from GET /overview. */
export default function Overview() {
  const nav = useNavigate()
  const [range, setRange] = useState<keyof typeof RANGES>('24h')
  const a = useAsync(() => api.get<OverviewData>('/overview', { range }), [range])
  const now = useNow(60000)
  useJobEvents(() => void a.reload())

  return (
    <>
      <PageHeader title="Operations Overview" subtitle="Real-time operational summary — ATM & CRM"
        actions={<Select aria-label="Time range" value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)} className="!w-auto">
          {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>} />
      <Async a={a}>
        {(o) => {
          const k = o.kpis
          const prio = PRIORITIES.map((p) => ({ value: o.priority[p] ?? 0, color: PRIORITY_COLOR[p], label: PRIORITY_LABEL[p] }))
          const slaParts = [
            { value: o.sla.on_track, color: '#16A34A', label: 'On track' }, { value: o.sla.warning, color: '#D97706', label: 'Warning' },
            { value: o.sla.breach, color: '#DC2626', label: 'Breach' }, { value: o.sla.no_policy, color: '#98A2B3', label: 'No SLA policy' },
          ]
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                <KpiCard icon={<ClipboardList size={20} />} label="Active jobs" value={k.active_jobs} onClick={() => nav('/live')} />
                <KpiCard icon={<Clock3 size={20} />} tone="neutral" label="Unassigned" value={k.unassigned} onClick={() => nav('/dispatch?tab=unassigned')} />
                <KpiCard icon={<UserCog size={20} />} tone="info" label="Awaiting technician acceptance" value={k.awaiting_acceptance} onClick={() => nav('/dispatch?status=NOTIFIED')} />
                <KpiCard icon={<UserCheck size={20} />} tone="ok" label="Technicians available" value={k.technicians_available} hint={`of ${k.technicians_total} technicians`} onClick={() => nav('/technicians?status=available')} />
                <KpiCard icon={<Zap size={20} />} tone="info" label="Technicians working" value={k.technicians_working} onClick={() => nav('/technicians?status=working')} />
                <KpiCard icon={<AlertTriangle size={20} />} tone="warn" label="SLA warnings" value={k.sla_warning} onClick={() => nav('/sla?state=warning')} />
                <KpiCard icon={<ShieldAlert size={20} />} tone="crit" label="SLA breaches" value={k.sla_breach} onClick={() => nav('/sla?state=breach')} />
                <KpiCard icon={<CheckCircle2 size={20} />} tone="ok" label={`Resolved (${RANGES[range].toLowerCase()})`} value={k.resolved} onClick={() => nav('/history?status=RESOLVED,VERIFICATION,CLOSED')} />
                <KpiCard icon={<UserX size={20} />} tone="crit" label="Critical incidents open" value={k.critical_open} onClick={() => nav('/live?priority=critical')} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card>
                  <CardHeader title="Open jobs by priority" />
                  <div className="flex items-center gap-6 px-4 pb-4">
                    <Donut parts={prio} center={<div><div className="text-2xl font-semibold">{k.active_jobs}</div><div className="text-xs text-muted">Open</div></div>} />
                    <ul className="text-sm space-y-1.5">
                      {prio.map((p) => <li key={p.label} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{p.label}<span className="ml-auto pl-6 font-medium tabular-nums">{p.value}</span></li>)}
                    </ul>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="SLA status of open jobs" subtitle="Against the policies configured for your organization" />
                  <div className="flex items-center gap-6 px-4 pb-4">
                    <Donut parts={slaParts} center={<div><div className="text-2xl font-semibold">{o.sla.on_track_pct === null ? '—' : `${Math.round(o.sla.on_track_pct)}%`}</div><div className="text-xs text-muted">On track</div></div>} />
                    <ul className="text-sm space-y-1.5">
                      {slaParts.map((p) => <li key={p.label} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{p.label}<span className="ml-auto pl-6 font-medium tabular-nums">{p.value}</span></li>)}
                    </ul>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Recent activity" />
                  {o.recent_activity.length === 0
                    ? <p className="px-4 pb-4 text-sm text-muted">No activity yet.</p>
                    : <ul className="px-2 pb-2">
                      {o.recent_activity.map((r, i) => (
                        <li key={i}><button className="w-full text-left px-2 py-1.5 rounded hover:bg-canvas flex items-start gap-2" onClick={() => nav(`/jobs/${r.job_id}`)}>
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                          <span className="flex-1 min-w-0 text-sm"><span className="font-medium">{r.job_code}</span> {EVENT_LABEL[r.type] ?? r.type}{r.to_status ? ` → ${STATUS_LABEL[r.to_status as JobStatus] ?? r.to_status}` : ''}{r.actor ? <span className="text-muted"> · {r.actor}</span> : null}</span>
                          <span className="text-[11px] text-muted whitespace-nowrap">{timeAgo(r.at, now)}</span>
                        </button></li>
                      ))}
                    </ul>}
                </Card>
              </div>
            </div>
          )
        }}
      </Async>
    </>
  )
}
