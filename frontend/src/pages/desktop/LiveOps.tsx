import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Phone, Radio } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync, useNow } from '../../lib/hooks'
import { useRealtime } from '../../lib/realtime'
import { OPEN_STATUSES, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, fmtDuration, timeAgo } from '../../lib/format'
import type { Job, Paged, Position, Technician } from '../../lib/types'
import MapView, { MARKER_COLOR, type MapMarker } from '../../components/MapView'
import { Async, Badge, Button, Card, Empty, PageHeader, PriorityBadge, Select, StatusBadge, cn } from '../../components/ui'
import AssignPanel, { type AssignTarget } from './AssignPanel'
import { DISPATCH_ROLES, Dl, PRIORITY_COLOR, SlaCell, has, jobActions } from './common'

interface GpsPolicy { stale_after_s: number }

/** D02 — Live Operations: job queue | OpenStreetMap | selected job and technician. Technician markers are real reported positions only. */
export default function LiveOps() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [sp, setSp] = useSearchParams()
  const priority = sp.get('priority') ?? ''
  const [status, setStatus] = useState('')
  const [team, setTeam] = useState('')
  const [live, setLive] = useState(true)
  const [sel, setSel] = useState<string | null>(null)        // "job:<id>" | "tech:<id>"
  const [assign, setAssign] = useState<AssignTarget | null>(null)
  const [pos, setPos] = useState<Record<string, Position>>({})
  const now = useNow(15000)

  const jobs = useAsync(() => api.get<Paged<Job>>('/jobs', { status: OPEN_STATUSES.join(','), page_size: 100, sort: 'priority' }), [])
  const techs = useAsync(() => api.get<Technician[]>('/technicians'), [])
  const livePos = useAsync(() => api.get<Technician[]>('/technicians/live'), [])
  const policy = useAsync(() => api.get<GpsPolicy>('/settings/gps_policy'), [])
  const staleAfter = policy.data?.stale_after_s ?? 300

  useEffect(() => {
    if (livePos.data) setPos(Object.fromEntries(livePos.data.filter((t) => t.location).map((t) => [t.id, t.location as Position])))
  }, [livePos.data])

  useRealtime((e) => {
    if (!live) return
    if (e.type === 'job.created' || e.type === 'job.updated' || e.type === 'assignment.new') void jobs.reload()
    if (e.type === 'location.update') setPos((p) => ({ ...p, [e.user_id]: { lat: e.lat, lon: e.lon, accuracy_m: e.accuracy_m, recorded_at: e.recorded_at, age_s: 0, stale: false } }))
  })

  const techById = useMemo(() => Object.fromEntries((techs.data ?? []).map((t) => [t.id, t])), [techs.data])
  const teams = useMemo(() => [...new Set((techs.data ?? []).flatMap((t) => t.teams))].sort(), [techs.data])
  const inTeam = (techId?: string | null) => !team || (!!techId && !!techById[techId]?.teams.includes(team))

  const queue = (jobs.data?.items ?? []).filter((j) => (!priority || j.priority === priority) && (!status || j.status === status) && (!team || inTeam(j.assignee?.id)))
  const ageOf = (p: Position) => Math.max(0, Math.round((now - new Date(p.recorded_at).getTime()) / 1000))
  const techPositions = Object.entries(pos).filter(([id]) => inTeam(id) && techById[id])

  const markers: MapMarker[] = [
    ...queue.filter((j) => j.device?.lat != null && j.device.lon != null).map((j) => ({
      id: `job:${j.id}`, kind: 'job' as const, lat: j.device!.lat!, lon: j.device!.lon!, color: PRIORITY_COLOR[j.priority], label: j.code,
      popup: `${j.code} · ${PRIORITY_LABEL[j.priority]}\n${j.device!.code}\n${STATUS_LABEL[j.status]}`,
    })),
    ...techPositions.map(([id, p]) => {
      const stale = ageOf(p) > staleAfter
      return { id: `tech:${id}`, kind: 'tech' as const, lat: p.lat, lon: p.lon, dim: stale, color: stale ? MARKER_COLOR.muted : MARKER_COLOR.ok, label: techById[id].full_name,
        popup: `${techById[id].full_name}\nLast position ${timeAgo(p.recorded_at, now)}${p.accuracy_m != null ? ` (±${Math.round(p.accuracy_m)} m)` : ''}${stale ? '\nStale position' : ''}` }
    }),
  ]

  const selJob = sel?.startsWith('job:') ? jobs.data?.items.find((j) => j.id === sel.slice(4)) : undefined
  const selTech = sel?.startsWith('tech:') ? techById[sel.slice(5)] : undefined
  const selPos = selTech ? pos[selTech.id] : undefined
  const canDispatch = has(user?.role, DISPATCH_ROLES)

  return (
    <>
      <PageHeader title="Live Operations" subtitle="Monitor jobs and technician positions in real time"
        actions={<>
          <button role="switch" aria-checked={live} onClick={() => setLive(!live)} className="flex items-center gap-2 text-sm rounded border border-line px-3 py-1.5 bg-surface">
            <Radio size={14} className={live ? 'text-ok' : 'text-muted'} /> Live updates
            <span className={cn('w-8 h-4 rounded-full relative transition-colors', live ? 'bg-primary' : 'bg-line')}><span className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all', live ? 'left-4' : 'left-0.5')} /></span>
          </button>
        </>} />
      {!live && <div className="mb-3 text-xs rounded border border-warn-100 bg-warn-50 text-warn px-3 py-1.5" role="status">Live updates are paused: the queue and positions will not change until you turn them back on.</div>}
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_340px] lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* queue */}
        <Card className="flex flex-col max-h-[calc(100vh-190px)]">
          <div className="p-3 border-b border-line space-y-2">
            <div className="flex items-center justify-between"><h2 className="text-sm">Job queue</h2><span className="text-xs text-muted">{queue.length} shown</span></div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Priority">
              {['', ...PRIORITIES].map((p) => (
                <button key={p || 'all'} aria-pressed={priority === p} onClick={() => { const n = new URLSearchParams(sp); if (p) n.set('priority', p); else n.delete('priority'); setSp(n, { replace: true }) }}
                  className={cn('px-2 py-0.5 rounded text-xs border', priority === p ? 'bg-primary text-white border-primary' : 'border-line text-muted hover:bg-canvas')}>{p ? PRIORITY_LABEL[p as keyof typeof PRIORITY_LABEL] : 'All'}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="!py-1 !text-xs"><option value="">All status</option>{OPEN_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
              <Select aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} className="!py-1 !text-xs"><option value="">All teams</option>{teams.map((t) => <option key={t}>{t}</option>)}</Select>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            <Async a={jobs} empty={() => queue.length === 0} emptyTitle="No jobs match" emptyHint="Adjust the filters, or create a job from Job Dispatch.">
              {() => (
                <ul>
                  {queue.map((j) => (
                    <li key={j.id}>
                      <button onClick={() => setSel(`job:${j.id}`)} className={cn('w-full text-left px-3 py-2.5 border-b border-line/70 border-l-4 hover:bg-canvas', sel === `job:${j.id}` && 'bg-primary-50')}
                        style={{ borderLeftColor: PRIORITY_COLOR[j.priority] }}>
                        <div className="flex items-center gap-2"><span className="font-medium">{j.code}</span><PriorityBadge priority={j.priority} /></div>
                        <div className="text-xs text-muted truncate">{j.device?.code} · {j.category?.name ?? j.description}</div>
                        <div className="flex items-center justify-between mt-1"><StatusBadge status={j.status} /><SlaCell sla={j.sla} /></div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Async>
          </div>
        </Card>

        {/* map */}
        <div className="space-y-2 min-w-0">
          <Card className="overflow-hidden"><MapView markers={markers} selectedId={sel} onSelect={setSel} height="calc(100vh - 250px)" /></Card>
          {techPositions.length === 0 && !livePos.loading && (
            <div className="text-xs text-muted rounded border border-line bg-surface px-3 py-2" role="status">
              No technician has reported a position yet. Positions appear only while a technician is on an active shift or assignment and has allowed location access in the technician app.
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-xs text-muted px-1">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-crit" /> Critical job</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-ok" /> Technician (recent)</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-muted" /> Technician (stale)</span>
          </div>
        </div>

        {/* details */}
        <div className="space-y-3 lg:col-span-2 xl:col-span-1">
          {!selJob && !selTech && <Card><Empty title="Select a job or technician" hint="Click an item in the queue or a marker on the map." /></Card>}
          {selJob && (
            <Card>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between"><h2 className="text-base">{selJob.code}</h2><PriorityBadge priority={selJob.priority} /></div>
                <p className="text-sm">{selJob.description}</p>
                <Dl items={[
                  ['Device', `${selJob.device?.code ?? '—'} (${selJob.device?.type ?? ''})`], ['Address', selJob.device?.address],
                  ['Status', <StatusBadge key="s" status={selJob.status} />], ['SLA', <SlaCell key="l" sla={selJob.sla} />],
                  ['Technician', selJob.assignee?.full_name ?? 'Unassigned'],
                  ['Open for', fmtDuration((now - new Date(selJob.created_at).getTime()) / 1000)],
                ]} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => nav(`/jobs/${selJob.id}`)}>View detail</Button>
                  {user && jobActions(selJob.status, user.role).some((a) => a === 'assign' || a === 'reassign') &&
                    <Button onClick={() => setAssign({ id: selJob.id, code: selJob.code, status: selJob.status, assigneeName: selJob.assignee?.full_name })}>{selJob.status === 'CREATED' ? 'Assign' : 'Reassign'}</Button>}
                  {selJob.assignee && techById[selJob.assignee.id]?.phone && <a className="inline-flex items-center gap-1.5 rounded border border-line px-3.5 py-2 text-sm hover:bg-canvas" href={`tel:${techById[selJob.assignee.id].phone}`}><Phone size={14} /> Contact technician</a>}
                </div>
                {!canDispatch && <p className="text-xs text-muted">Your role can monitor but not dispatch.</p>}
              </div>
            </Card>
          )}
          {selTech && (
            <Card>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between"><h2 className="text-base">{selTech.full_name}</h2><Badge tone={selTech.status === 'available' ? 'ok' : selTech.status === 'working' ? 'info' : 'neutral'}>{selTech.status.replace('_', ' ')}</Badge></div>
                <Dl items={[
                  ['Teams', selTech.teams.join(', ') || '—'], ['Skills', selTech.skills.join(', ') || '—'], ['Active jobs', selTech.active_jobs],
                  ['Position', selPos ? `${timeAgo(selPos.recorded_at, now)}${selPos.accuracy_m != null ? ` · ±${Math.round(selPos.accuracy_m)} m` : ''}${ageOf(selPos) > staleAfter ? ' · stale' : ''}` : 'No position reported'],
                ]} />
                <p className="text-xs text-muted">A position is a hint for dispatch, not proof of where someone is or was.</p>
                <div className="flex gap-2">
                  <Button onClick={() => nav(`/technicians/${selTech.id}`)}>Technician profile</Button>
                  {selTech.phone && <a className="inline-flex items-center gap-1.5 rounded border border-line px-3.5 py-2 text-sm hover:bg-canvas" href={`tel:${selTech.phone}`}><Phone size={14} /> Contact</a>}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
      <AssignPanel open={!!assign} job={assign} onClose={() => setAssign(null)} onDone={() => void jobs.reload()} />
    </>
  )
}
