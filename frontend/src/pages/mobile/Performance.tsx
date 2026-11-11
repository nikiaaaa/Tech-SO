import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import type { ScoreOut } from '../../lib/types'
import { Async, Badge, Button, Card, ProgressBar, Tabs, useAction, type Tone } from '../../components/ui'
import { TextSheet } from './parts'

interface Perf { technician: { id: string; full_name: string }; summary: { jobs_scored: number; score: number | null; dimensions: Record<string, number> }; scores: ScoreOut[] }

const DIM: Record<string, string> = {
  response_time: 'Response time', mobilization: 'Mobilization', sla_achievement: 'SLA achievement', documentation: 'Work documentation', resolution_quality: 'Resolution quality',
}
const tone = (v: number): Tone => (v >= 85 ? 'ok' : v >= 65 ? 'warn' : 'crit')
const grade = (v: number) => (v >= 90 ? 'Excellent' : v >= 80 ? 'Very good' : v >= 65 ? 'Good' : 'Needs attention')

function ScoreCard({ s, onAppeal }: { s: ScoreOut; onAppeal: (s: ScoreOut) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="p-3">
      <button className="w-full flex items-center gap-2 text-left min-h-[44px]" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="flex-1"><div className="font-medium">{s.job_code ?? 'Job'}</div><div className="text-xs text-muted">Scoring version {s.scoring_version}</div></div>
        <div className="text-xl font-semibold tabular-nums">{Math.round(s.effective_total)}</div>
        {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
      </button>
      {open && (
        <div className="mt-2 space-y-3 text-sm">
          {s.override_total !== null && <div className="rounded bg-ok-50 border border-ok-100 p-2">Adjusted after review from {Math.round(s.total)} to <b>{Math.round(s.override_total)}</b>. {s.override_note}</div>}
          <div><div className="text-xs font-medium text-muted mb-1">How this score was calculated</div><pre className="whitespace-pre-wrap font-sans text-sm">{s.explanation}</pre></div>
          <div><div className="text-xs font-medium text-muted mb-1">Adjustments applied</div><ul className="list-disc pl-5 space-y-1">{s.adjustments.map((a) => <li key={a.factor}>{a.text}</li>)}</ul></div>
          {s.appeal ? (
            <div className="rounded border border-line p-2"><Badge tone={s.appeal.status === 'accepted' ? 'ok' : s.appeal.status === 'rejected' ? 'crit' : 'warn'}>Appeal {s.appeal.status}</Badge>
              <div className="mt-1">{s.appeal.reason}</div>{s.appeal.decision_note && <div className="text-muted mt-1">Decision: {s.appeal.decision_note}</div>}</div>
          ) : <Button size="lg" className="w-full" onClick={() => onAppeal(s)}>Ask for a review (appeal)</Button>}
          {s.appeal?.status === 'rejected' && <p className="text-xs text-muted">This appeal was decided. You can raise a new one only if the score changes.</p>}
        </div>
      )}
    </Card>
  )
}

/** M09 — Personal performance with transparent explanations and an appeal path. */
export default function Performance() {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')
  const a = useAsync(() => api.get<Perf>('/me/performance', { period }), [period])
  const act = useAction()
  const [appeal, setAppeal] = useState<ScoreOut | null>(null)
  return (
    <div>
      <h1 className="text-xl mb-3">My performance</h1>
      <Tabs tabs={[{ id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }, { id: '90d', label: '90 days' }]} value={period} onChange={setPeriod} />
      <div className="mt-3 space-y-3">
        <Async a={a} empty={(d) => d.scores.length === 0} emptyTitle="No scored jobs in this period" emptyHint="A score appears after the scheduler approves a finished job.">
          {(d) => (<>
            <Card className="p-4">
              <div className="flex items-center gap-4">
                <div className="text-5xl font-semibold tabular-nums">{d.summary.score === null ? '—' : Math.round(d.summary.score)}<span className="text-base text-muted">/100</span></div>
                <div><div className="font-medium">{d.summary.score === null ? '' : grade(d.summary.score)}</div><div className="text-xs text-muted">{d.summary.jobs_scored} job(s) scored</div></div>
              </div>
              <div className="mt-4 space-y-2.5">
                {Object.entries(d.summary.dimensions).map(([k, v]) => (
                  <div key={k}><div className="flex justify-between text-sm"><span>{DIM[k] ?? k}</span><span className="tabular-nums">{Math.round(v)}</span></div><ProgressBar value={v} tone={tone(v)} /></div>
                ))}
              </div>
              <p className="text-xs text-muted mt-3">Scores consider job complexity, distance, workload and delays outside your control. They are not ranked by speed alone.</p>
            </Card>
            {d.scores.map((s) => <ScoreCard key={s.id} s={s} onAppeal={setAppeal} />)}
          </>)}
        </Async>
      </div>
      <TextSheet open={!!appeal} title={`Appeal score for ${appeal?.job_code ?? 'job'}`} label="What should be reviewed?" minLength={10} confirmLabel="Send appeal" onClose={() => setAppeal(null)}
        onConfirm={async (text) => { if (await act(() => api.post(`/performance/scores/${appeal!.id}/appeal`, { reason: text }), 'Appeal sent to your supervisor')) void a.reload() }} />
    </div>
  )
}
