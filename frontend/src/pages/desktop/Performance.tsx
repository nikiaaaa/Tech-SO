import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { fmtDateTime } from '../../lib/format'
import type { ScoreOut } from '../../lib/types'
import { Async, Badge, Button, Card, CardHeader, DataTable, Empty, Field, KpiCard, Modal, PageHeader, ProgressBar, Select, Tabs, Textarea, Input, useAction, type Tone } from '../../components/ui'
import { APPEAL_DECIDE_ROLES, PERFORMANCE_ROLES, has } from './common'

interface Rank { technician_id: string; full_name: string; completed: number; jobs_scored: number; score: number | null; rank?: number; dimensions: Record<string, number> }
interface Team { period: string; team_score: number | null; sla_achievement_pct: number | null; jobs_completed: number; ranking: Rank[]; unranked: Rank[]; sla_trend: { day: string; pct: number }[]; ranking_note: string }
interface Detail { technician: { id: string; full_name: string }; summary: { jobs_scored: number; score: number | null; dimensions: Record<string, number> }; scores: ScoreOut[] }
interface AppealRow { id: string; score_id: string; technician: string | null; reason: string; status: string; decision_note: string | null; created_at: string; decided_at: string | null; score: ScoreOut }

const label = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
const scoreTone = (v: number): Tone => (v >= 85 ? 'ok' : v >= 65 ? 'warn' : 'crit')

/** D08a — why a score is what it is: dimensions, adjustment factors, version, appeal state. */
export function ScoreExplain({ s, open, onClose }: { s: ScoreOut | null; open: boolean; onClose: () => void }) {
  if (!s) return null
  return (
    <Modal open={open} wide title={`Score explanation — ${s.job_code ?? ''}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-end gap-3"><div className="text-4xl font-semibold">{s.effective_total}<span className="text-base text-muted"> / 100</span></div>
          <Badge>scoring version {s.scoring_version}</Badge>{s.override_total !== null && <Badge tone="info">Adjusted after appeal (original {s.total})</Badge>}</div>
        {s.override_note && <p className="text-sm bg-canvas rounded px-3 py-2">Appeal decision: {s.override_note}</p>}
        <div><h3 className="text-xs font-medium text-muted mb-2">Dimensions</h3>
          <ul className="space-y-2">{Object.entries(s.dimensions).map(([k, v]) => (
            <li key={k}><div className="flex justify-between text-sm"><span>{label(k)}</span><span className="tabular-nums">{v === null ? 'not scored (no SLA target)' : Math.round(v)}</span></div>{v !== null && <ProgressBar value={v} tone={scoreTone(v)} />}</li>))}</ul></div>
        <div><h3 className="text-xs font-medium text-muted mb-2">Adjustments applied for fairness</h3>
          <ul className="text-sm space-y-1 list-disc pl-5">{s.adjustments.map((a, i) => <li key={i}>{a.text}</li>)}</ul></div>
        <pre className="text-xs bg-canvas rounded p-3 whitespace-pre-wrap">{s.explanation}</pre>
        {s.appeal && <p className="text-sm">Appeal: <Badge tone={s.appeal.status === 'accepted' ? 'ok' : s.appeal.status === 'open' ? 'info' : 'neutral'}>{s.appeal.status}</Badge> — {s.appeal.reason}</p>}
      </div>
    </Modal>
  )
}

/** D08 — team performance. Visible to management, supervisors and admins only. */
export default function Performance() {
  const { user } = useAuth()
  if (!has(user?.role, PERFORMANCE_ROLES)) return (<><PageHeader title="Performance" /><Card><Empty title="Not available for your role" hint="Team performance is visible to supervisors, management and administrators." /></Card></>)
  return <PerformanceView />
}

/** Ranked by weighted, adjusted score; never by raw completion time. */
function PerformanceView() {
  const { user } = useAuth()
  const run = useAction()
  const [tab, setTab] = useState<'team' | 'appeals'>('team')
  const [period, setPeriod] = useState('30d')
  const [tech, setTech] = useState<string | null>(null)
  const [score, setScore] = useState<ScoreOut | null>(null)
  const [decide, setDecide] = useState<AppealRow | null>(null)
  const [accept, setAccept] = useState(true)
  const [note, setNote] = useState('')
  const [newTotal, setNewTotal] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const team = useAsync(() => api.get<Team>('/performance/team', { period }), [period])
  const detail = useAsync(() => (tech ? api.get<Detail>(`/performance/${tech}`, { period }) : Promise.resolve(null)), [tech, period])
  const appeals = useAsync(() => api.get<AppealRow[]>('/performance/appeals'), [])
  const canDecide = has(user?.role, APPEAL_DECIDE_ROLES)
  const openAppeals = appeals.data?.filter((a) => a.status === 'open').length

  const submit = async () => {
    if (!decide) return
    if (note.trim().length < 3) { setErr('A decision note is required'); return }
    const total = Number(newTotal)
    if (accept && (newTotal === '' || Number.isNaN(total) || total < 0 || total > 100)) { setErr('Enter the corrected score (0–100)'); return }
    const ok = await run(() => api.post(`/performance/appeals/${decide.id}/decision`, { accept, note: note.trim(), ...(accept ? { new_total: total } : {}) }), 'Decision recorded')
    if (ok) { setDecide(null); void appeals.reload(); void team.reload(); void detail.reload() }
  }

  return (
    <>
      <PageHeader title="Performance" subtitle="Weighted scores with transparent explanations" actions={<Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} className="!w-auto"><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></Select>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'team', label: 'Team' }, { id: 'appeals', label: 'Appeals', count: openAppeals }]} />
      <div className="mt-4">
        {tab === 'team' && (
          <Async a={team}>
            {(t) => (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-3 gap-3">
                  <KpiCard icon={<span className="text-sm font-semibold">★</span>} label="Team score" value={t.team_score ?? '—'} />
                  <KpiCard icon={<span className="text-sm font-semibold">%</span>} tone="ok" label="SLA achievement" value={t.sla_achievement_pct === null ? '—' : `${t.sla_achievement_pct}%`} />
                  <KpiCard icon={<span className="text-sm font-semibold">#</span>} tone="neutral" label="Jobs completed" value={t.jobs_completed} />
                </div>
                <div className="grid lg:grid-cols-3 gap-4">
                  <Card className="lg:col-span-2"><CardHeader title="Technician ranking" subtitle={t.ranking_note} />
                    {t.ranking.length === 0 ? <p className="px-4 pb-4 text-sm text-muted">No scored jobs in this period. Scores are created when a job is verified and closed.</p> : (
                      <DataTable rows={t.ranking} rowKey={(r) => r.technician_id} selectedKey={tech} onRowClick={(r) => setTech(r.technician_id)} columns={[
                        { key: 'r', header: '#', render: (r: Rank) => r.rank }, { key: 'n', header: 'Technician', render: (r: Rank) => <span className="font-medium">{r.full_name}</span> },
                        { key: 's', header: 'Score', render: (r: Rank) => <div className="w-40"><div className="text-sm tabular-nums">{r.score}</div><ProgressBar value={r.score ?? 0} tone={scoreTone(r.score ?? 0)} /></div> },
                        { key: 'j', header: 'Jobs scored', render: (r: Rank) => r.jobs_scored }, { key: 'c', header: 'Completed', render: (r: Rank) => r.completed }]} />)}
                    {t.unranked.length > 0 && <p className="px-4 py-3 text-xs text-muted border-t border-line">Not yet scored: {t.unranked.map((u) => u.full_name).join(', ')}</p>}
                  </Card>
                  <Card><CardHeader title="SLA achievement trend" subtitle="Share of closed jobs within SLA, by day" />
                    {t.sla_trend.length === 0 ? <p className="px-4 pb-4 text-sm text-muted">No closed jobs in this period.</p> : (
                      <div className="h-56 px-2 pb-3"><ResponsiveContainer width="100%" height="100%"><LineChart data={t.sla_trend}><CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="pct" stroke="#2563EB" strokeWidth={2} dot /></LineChart></ResponsiveContainer></div>)}
                  </Card>
                </div>
                {tech && (
                  <Card><CardHeader title={detail.data ? `${detail.data.technician.full_name} — scored jobs` : 'Scored jobs'} action={<Button size="sm" onClick={() => setTech(null)}>Close</Button>} />
                    <Async a={detail} empty={(d) => !d || d.scores.length === 0} emptyTitle="No scored jobs in this period">
                      {(d) => d && <DataTable rows={d.scores} rowKey={(s) => s.id} onRowClick={setScore} columns={[
                        { key: 'j', header: 'Job', render: (s: ScoreOut) => <Link className="text-primary-700 hover:underline" to={`/jobs/${s.job_id}`} onClick={(e) => e.stopPropagation()}>{s.job_code}</Link> },
                        { key: 't', header: 'Score', render: (s: ScoreOut) => <span className="tabular-nums">{s.effective_total}</span> }, { key: 'v', header: 'Version', render: (s: ScoreOut) => `v${s.scoring_version}` },
                        { key: 'a', header: 'Appeal', render: (s: ScoreOut) => s.appeal ? <Badge tone={s.appeal.status === 'open' ? 'info' : 'neutral'}>{s.appeal.status}</Badge> : '—' }, { key: 'd', header: 'Date', render: (s: ScoreOut) => fmtDateTime(s.created_at) },
                        { key: 'x', header: '', render: () => <span className="text-xs text-primary">Explain</span> }]} />}
                    </Async></Card>)}
              </div>
            )}
          </Async>
        )}
        {tab === 'appeals' && (
          <Card><Async a={appeals} empty={(d) => d.length === 0} emptyTitle="No appeals" emptyHint="Technicians can appeal a score from the technician app.">
            {(rows) => <ul className="divide-y divide-line">{rows.map((a) => (
              <li key={a.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-medium">{a.technician}</span><Badge tone={a.status === 'open' ? 'info' : a.status === 'accepted' ? 'ok' : 'neutral'}>{a.status}</Badge><span className="text-xs text-muted">{a.score.job_code} · score {a.score.effective_total}</span></div>
                  <p className="text-sm mt-1">{a.reason}</p>{a.decision_note && <p className="text-xs text-muted mt-1">Decision: {a.decision_note}</p>}</div>
                <div className="flex gap-2"><Button size="sm" onClick={() => setScore(a.score)}>View score</Button>
                  {canDecide && a.status === 'open' && <Button size="sm" variant="primary" onClick={() => { setDecide(a); setAccept(true); setNote(''); setNewTotal(String(a.score.effective_total)); setErr(null) }}>Decide</Button>}</div></li>))}</ul>}
          </Async></Card>
        )}
      </div>
      <ScoreExplain s={score} open={!!score} onClose={() => setScore(null)} />
      <Modal open={!!decide} title="Decide on appeal" onClose={() => setDecide(null)} footer={<><Button onClick={() => setDecide(null)}>Cancel</Button><Button variant="primary" onClick={submit}>Record decision</Button></>}>
        <div className="space-y-3"><Field label="Decision"><Select value={accept ? 'accept' : 'reject'} onChange={(e) => setAccept(e.target.value === 'accept')}><option value="accept">Accept — correct the score</option><option value="reject">Reject — keep the score</option></Select></Field>
          {accept && <Field label="Corrected score (0–100)"><Input inputMode="decimal" value={newTotal} onChange={(e) => setNewTotal(e.target.value)} /></Field>}
          <Field label="Decision note" error={err}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
      </Modal>
    </>
  )
}
