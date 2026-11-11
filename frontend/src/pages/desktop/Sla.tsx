import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { fmtDateTime } from '../../lib/format'
import type { Job } from '../../lib/types'
import { Async, Badge, Button, Card, CardHeader, DataTable, KpiCard, PageHeader, PriorityBadge, ReasonDialog, Tabs, StatusBadge, useAction } from '../../components/ui'
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { PAUSE_APPROVE_ROLES, PAUSE_REQUEST_ROLES, SlaCell, has, useJobEvents } from './common'

interface Summary { open_by_state: Record<string, number>; open_total: number; avg_segment_minutes: Record<string, number>; note: string }
interface Pause { id: string; job_id: string; job_code: string | null; requested_by: string | null; reason: string; status: string; decided_by: string | null; decision_note: string | null; started_at: string | null; ended_at: string | null; created_at: string }
type State = '' | 'breach' | 'warning' | 'on_track' | 'no_policy'

/** D07 + D07a — SLA monitoring and the pause workflow. ON_HOLD never pauses SLA; only an approved pause does. */
export default function Sla() {
  const nav = useNavigate()
  const { user } = useAuth()
  const run = useAction()
  const [sp, setSp] = useSearchParams()
  const state = (sp.get('state') ?? '') as State
  const sum = useAsync(() => api.get<Summary>('/sla/summary'), [])
  const jobs = useAsync(() => api.get<Job[]>('/sla/jobs', { state: state || undefined }), [state])
  const pauses = useAsync(() => api.get<Pause[]>('/sla/pauses'), [])
  const [requestFor, setRequestFor] = useState<Job | null>(null)
  const [decide, setDecide] = useState<{ p: Pause; approve: boolean } | null>(null)
  useJobEvents(() => { void sum.reload(); void jobs.reload() })
  const canApprove = has(user?.role, PAUSE_APPROVE_ROLES)
  const canRequest = has(user?.role, PAUSE_REQUEST_ROLES)
  const after = () => { void pauses.reload(); void sum.reload(); void jobs.reload() }
  const o = sum.data?.open_by_state ?? {}

  return (
    <>
      <PageHeader title="SLA Monitoring" subtitle="Targets come from the SLA policies configured by your organization" />
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <KpiCard icon={<CheckCircle2 size={20} />} tone="ok" label="On track" value={o.on_track ?? 0} onClick={() => setSp({ state: 'on_track' })} />
        <KpiCard icon={<AlertTriangle size={20} />} tone="warn" label="Warning" value={o.warning ?? 0} onClick={() => setSp({ state: 'warning' })} />
        <KpiCard icon={<ShieldAlert size={20} />} tone="crit" label="Breach" value={o.breach ?? 0} onClick={() => setSp({ state: 'breach' })} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="px-3 pt-1"><Tabs<State> value={state} onChange={(s) => setSp(s ? { state: s } : {})} tabs={[
            { id: '', label: 'All open', count: sum.data?.open_total }, { id: 'breach', label: 'Breach', count: o.breach ?? 0 }, { id: 'warning', label: 'Warning', count: o.warning ?? 0 },
            { id: 'on_track', label: 'On track', count: o.on_track ?? 0 }, { id: 'no_policy', label: 'No policy', count: o.no_policy ?? 0 }]} /></div>
          <Async a={jobs} empty={(d) => d.length === 0} emptyTitle="No jobs in this state">
            {(rows) => <DataTable rows={rows} rowKey={(j) => j.id} onRowClick={(j) => nav(`/jobs/${j.id}`)} columns={[
              { key: 'c', header: 'Job', render: (j: Job) => <span className="font-medium text-primary-700">{j.code}</span> },
              { key: 'p', header: 'Priority', render: (j: Job) => <PriorityBadge priority={j.priority} /> },
              { key: 'st', header: 'Status', render: (j: Job) => <StatusBadge status={j.status} /> },
              { key: 'd', header: 'Device', render: (j: Job) => j.device?.code },
              { key: 'sla', header: 'SLA', render: (j: Job) => <SlaCell sla={j.sla} /> },
              { key: 'a', header: '', render: (j: Job) => canRequest ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setRequestFor(j) }}>Request pause</Button> : null }]} />}
          </Async>
        </Card>
        <div className="space-y-4">
          <Card><CardHeader title="Average time per segment" subtitle="Minutes, from completed segments" />
            <Async a={sum} empty={(d) => Object.keys(d.avg_segment_minutes).length === 0} emptyTitle="Not enough data yet">
              {(d) => <><ul className="px-4 pb-2 text-sm space-y-1">{Object.entries(d.avg_segment_minutes).map(([k, v]) => <li key={k} className="flex justify-between capitalize"><span>{k}</span><span className="tabular-nums">{v} min</span></li>)}</ul><p className="px-4 pb-3 text-[11px] text-muted">{d.note}</p></>}
            </Async></Card>
          <Card><CardHeader title="Pause requests" subtitle="A pause needs a documented reason and approval by a different person" />
            <Async a={pauses} empty={(d) => d.length === 0} emptyTitle="No pause requests">
              {(rows) => <ul className="px-4 pb-4 space-y-3 text-sm max-h-96 overflow-y-auto">{rows.map((p) => (
                <li key={p.id} className="border-b border-line/70 pb-2">
                  <div className="flex items-center gap-2"><button className="font-medium text-primary-700 hover:underline" onClick={() => nav(`/jobs/${p.job_id}`)}>{p.job_code}</button><Badge tone={p.status === 'approved' ? 'warn' : p.status === 'pending' ? 'info' : 'neutral'}>{p.status}</Badge></div>
                  <div className="text-xs text-muted">{p.requested_by} · {fmtDateTime(p.created_at)}</div><div className="text-xs">{p.reason}</div>
                  {p.decision_note && <div className="text-xs text-muted">{p.decided_by}: {p.decision_note}</div>}
                  {canApprove && p.status === 'pending' && <div className="flex gap-2 mt-1.5"><Button size="sm" variant="primary" onClick={() => setDecide({ p, approve: true })}>Approve</Button><Button size="sm" onClick={() => setDecide({ p, approve: false })}>Reject</Button></div>}
                  {canApprove && p.status === 'approved' && <Button size="sm" className="mt-1.5" onClick={async () => { await run(() => api.post(`/sla/pauses/${p.id}/end`), 'Pause ended'); after() }}>End pause</Button>}
                </li>))}</ul>}
            </Async></Card>
        </div>
      </div>
      <ReasonDialog open={!!requestFor} title={`Request SLA pause — ${requestFor?.code ?? ''}`} label="Documented reason" minLength={10} confirmLabel="Send request" onClose={() => setRequestFor(null)}
        onConfirm={async (reason) => { await api.post(`/sla/${requestFor!.id}/pause-request`, { reason }); after() }} />
      <ReasonDialog open={!!decide} title={decide?.approve ? 'Approve SLA pause' : 'Reject SLA pause'} label="Decision note" confirmLabel={decide?.approve ? 'Approve' : 'Reject'} danger={!decide?.approve} onClose={() => setDecide(null)}
        onConfirm={async (note) => { await api.post(`/sla/pauses/${decide!.p.id}/decision`, { approve: decide!.approve, note }); after() }} />
    </>
  )
}
