import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Phone } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync, useDebounced } from '../../lib/hooks'
import { fmtDateTime, timeAgo } from '../../lib/format'
import type { Job, Technician } from '../../lib/types'
import { Async, Badge, Button, Card, CardHeader, DataTable, Field, Input, Modal, PageHeader, PriorityBadge, Select, StatusBadge, useAction, type Column } from '../../components/ui'
import { Dl, PERFORMANCE_ROLES, SHIFT_ROLES, SlaCell, has } from './common'

const STATUS_TONE = { available: 'ok', working: 'info', off_shift: 'neutral' } as const
const STATUS_TEXT = { available: 'Available', working: 'Working', off_shift: 'Off shift' } as const

/** D05 — technician list. */
export function Technicians() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const status = sp.get('status') ?? ''
  const a = useAsync(() => api.get<Technician[]>('/technicians', { q: dq || undefined, status: status || undefined }), [dq, status])
  const cols: Column<Technician>[] = [
    { key: 'name', header: 'Technician', render: (t) => <span className="font-medium text-primary-700">{t.full_name}</span> },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={STATUS_TONE[t.status]}>{STATUS_TEXT[t.status]}</Badge> },
    { key: 'teams', header: 'Team', render: (t) => t.teams.join(', ') || '—' },
    { key: 'skills', header: 'Skills', render: (t) => t.skills.join(', ') || '—' },
    { key: 'jobs', header: 'Active jobs', render: (t) => t.active_jobs },
    { key: 'loc', header: 'Last position', render: (t) => (t.location ? timeAgo(t.location.recorded_at) : <span className="text-muted">none</span>) },
    { key: 'phone', header: 'Phone', render: (t) => t.phone ?? '—' },
  ]
  return (
    <>
      <PageHeader title="Technicians" subtitle="Availability, workload and teams" />
      <Card>
        <div className="p-3 flex gap-2 border-b border-line">
          <Input aria-label="Search technicians" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select aria-label="Status" value={status} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.value) n.set('status', e.target.value); else n.delete('status'); setSp(n, { replace: true }) }} className="!w-auto">
            <option value="">All statuses</option>{Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <Async a={a} empty={(d) => d.length === 0} emptyTitle="No technicians found">
          {(rows) => <DataTable columns={cols} rows={rows} rowKey={(t) => t.id} onRowClick={(t) => nav(`/technicians/${t.id}`)} />}
        </Async>
      </Card>
    </>
  )
}

interface TechDetail extends Technician { jobs: Job[]; performance: { jobs_scored: number; score: number | null; dimensions: Record<string, number> } }
interface ShiftRow { id: string; status: string; starts_at: string; ends_at: string; started_at: string | null; ended_at: string | null }

/** D05a — technician profile, current jobs, performance summary and shifts. */
export function TechnicianDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const run = useAction()
  const a = useAsync(() => api.get<TechDetail>(`/technicians/${id}`), [id])
  const shifts = useAsync(() => api.get<ShiftRow[]>(`/technicians/${id}/shifts`), [id])
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const canShift = has(user?.role, SHIFT_ROLES)

  const save = async () => {
    if (!start || !end) { setErr('Start and end are required'); return }
    if (new Date(end) <= new Date(start)) { setErr('The shift must end after it starts'); return }
    const ok = await run(() => api.post('/shifts', { user_id: id, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() }), 'Shift scheduled')
    if (ok) { setOpen(false); void shifts.reload() }
  }

  return (
    <>
      <button onClick={() => nav(-1)} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Back</button>
      <Async a={a}>
        {(t) => (
          <div className="space-y-4">
            <PageHeader title={t.full_name} subtitle={t.teams.join(', ') || 'No team'}
              actions={<>{t.phone && <a className="inline-flex items-center gap-1.5 rounded border border-line px-3.5 py-2 text-sm hover:bg-canvas bg-surface" href={`tel:${t.phone}`}><Phone size={14} /> Contact</a>}
                {has(user?.role, PERFORMANCE_ROLES) && <Button onClick={() => nav('/performance')}>Performance</Button>}</>} />
            <div className="grid lg:grid-cols-3 gap-4">
              <Card><CardHeader title="Profile" /><div className="px-4 pb-4"><Dl items={[
                ['Status', <Badge key="s" tone={STATUS_TONE[t.status]}>{STATUS_TEXT[t.status]}</Badge>], ['Skills', t.skills.join(', ') || '—'], ['Phone', t.phone],
                ['Active jobs', t.active_jobs], ['Last position', t.location ? `${timeAgo(t.location.recorded_at)}${t.location.accuracy_m != null ? ` (±${Math.round(t.location.accuracy_m)} m)` : ''}` : 'Not reported']]} /></div></Card>
              <Card><CardHeader title="Performance (12 months)" subtitle="Weighted score, adjusted for context" /><div className="px-4 pb-4">
                {t.performance.score === null ? <p className="text-sm text-muted">No scored jobs yet.</p> : <>
                  <div className="text-3xl font-semibold">{t.performance.score}<span className="text-base text-muted"> / 100</span></div>
                  <div className="text-xs text-muted mb-2">{t.performance.jobs_scored} scored jobs</div>
                  <Dl items={Object.entries(t.performance.dimensions).map(([k, v]) => [k.replace(/_/g, ' '), `${v}`])} /></>}
              </div></Card>
              <Card><CardHeader title="Shifts" action={canShift ? <Button size="sm" onClick={() => { setStart(''); setEnd(''); setErr(null); setOpen(true) }}>Schedule shift</Button> : undefined} />
                <Async a={shifts} empty={(d) => d.length === 0} emptyTitle="No shifts">
                  {(rows) => <ul className="px-4 pb-4 text-sm space-y-1.5 max-h-60 overflow-y-auto">{rows.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2"><span>{fmtDateTime(s.starts_at)} – {fmtDateTime(s.ends_at)}</span><Badge tone={s.status === 'active' ? 'ok' : 'neutral'}>{s.status}</Badge></li>))}</ul>}
                </Async></Card>
            </div>
            <Card><CardHeader title="Current jobs" />
              {t.jobs.length === 0 ? <p className="px-4 pb-4 text-sm text-muted">No open jobs.</p> : (
                <DataTable columns={[
                  { key: 'c', header: 'Job', render: (j: Job) => <Link className="text-primary-700 font-medium hover:underline" to={`/jobs/${j.id}`}>{j.code}</Link> },
                  { key: 'p', header: 'Priority', render: (j: Job) => <PriorityBadge priority={j.priority} /> },
                  { key: 's', header: 'Status', render: (j: Job) => <StatusBadge status={j.status} /> },
                  { key: 'd', header: 'Device', render: (j: Job) => j.device?.code },
                  { key: 'l', header: 'SLA', render: (j: Job) => <SlaCell sla={j.sla} /> }]} rows={t.jobs} rowKey={(j) => j.id} />)}
            </Card>
          </div>
        )}
      </Async>
      <Modal open={open} title="Schedule shift" onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save shift</Button></>}>
        <div className="space-y-3"><Field label="Starts"><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Ends" error={err}><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
      </Modal>
    </>
  )
}
