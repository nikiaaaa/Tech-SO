import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ImageOff, PauseCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { EVENT_LABEL, HOLD_REASONS, RESOLUTIONS, STATUS_LABEL, fmtDateTime, fmtDuration, fmtRemaining } from '../../lib/format'
import type { Evidence, JobDetail as JobDetailT, SegmentName } from '../../lib/types'
import { Async, Badge, Button, Card, CardHeader, Loading, Modal, PriorityBadge, ReasonDialog, SlaBadge, StatusBadge, useAction, type Tone } from '../../components/ui'
import AssignPanel from './AssignPanel'
import { Dl, SlaCell, jobActions, useJobEvents } from './common'

interface Pause { id: string; job_id: string; reason: string; status: string; requested_by: string | null; decided_by: string | null; decision_note: string | null; created_at: string; started_at: string | null; ended_at: string | null }

const SEGMENTS: [SegmentName, string][] = [
  ['dispatch', 'Dispatch time'], ['response', 'Technician response'], ['mobilization', 'Mobilization'], ['travel', 'Travel'],
  ['repair', 'Repair'], ['verification', 'Verification'], ['total', 'Total resolution'],
]
const SEG_TONE: Record<string, Tone> = { on_track: 'ok', warning: 'warn', breach: 'crit' }

export function EvidenceImage({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    let made: string | null = null
    api.blob(`/evidence/${id}`).then((b) => { if (live) { made = URL.createObjectURL(b); setUrl(made) } }).catch(() => live && setFailed(true))
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [id])
  if (failed) return <div className={`grid place-items-center bg-canvas text-muted text-xs ${className ?? ''}`}><ImageOff size={18} /></div>
  if (!url) return <div className={`bg-canvas animate-pulse ${className ?? ''}`} aria-label="Loading photo" />
  return <img src={url} alt={alt} className={className} />
}

/** D04a + D11 — job detail with full timeline, SLA, report, evidence review and verification actions. */
export default function JobDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const run = useAction()
  const a = useAsync(() => api.get<JobDetailT>(`/jobs/${id}`), [id])
  const pauses = useAsync(() => api.get<Pause[]>('/sla/pauses'), [id])
  useJobEvents(() => { void a.reload(); void pauses.reload() }, id)
  const [dlg, setDlg] = useState<null | 'cancel' | 'correct' | 'pause'>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [photo, setPhoto] = useState<Evidence | null>(null)
  const [busy, setBusy] = useState(false)

  const job = a.data
  const acts = job && user ? jobActions(job.status, user.role) : []
  const refresh = () => { void a.reload(); void pauses.reload() }

  return (
    <>
      <div className="mb-3"><button onClick={() => nav(-1)} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Back</button></div>
      <Async a={a}>
        {(j) => (
          <div className="space-y-4">
            <Card>
              <div className="p-4 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl">{j.code}</h1><PriorityBadge priority={j.priority} /><StatusBadge status={j.status} /><SlaBadge state={j.sla.state} /></div>
                  <p className="max-w-3xl">{j.description}</p>
                  {j.hold_reason && <Badge tone="warn">On hold: {HOLD_REASONS[j.hold_reason] ?? j.hold_reason}</Badge>}
                </div>
                <div className="flex flex-wrap gap-2" aria-label="Job actions">
                  {acts.includes('assign') && <Button variant="primary" onClick={() => setAssignOpen(true)}>Assign technician</Button>}
                  {acts.includes('reassign') && <Button onClick={() => setAssignOpen(true)}>Reassign</Button>}
                  {acts.includes('verify') && <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); await run(() => api.post(`/jobs/${j.id}/verify`), 'Job approved and closed'); setBusy(false); refresh() }}><CheckCircle2 size={16} /> Approve &amp; close</Button>}
                  {acts.includes('request_correction') && <Button onClick={() => setDlg('correct')}>Request correction</Button>}
                  {acts.includes('pause_request') && <Button onClick={() => setDlg('pause')}><PauseCircle size={16} /> Request SLA pause</Button>}
                  {acts.includes('cancel') && <Button variant="danger" onClick={() => setDlg('cancel')}>Cancel job</Button>}
                </div>
              </div>
              <div className="border-t border-line p-4 grid md:grid-cols-3 gap-6">
                <Dl items={[
                  ['ATM / CRM', j.device ? <Link key="d" className="text-primary hover:underline" to={`/devices/${j.device.id}`}>{j.device.code} ({j.device.type})</Link> : null],
                  ['Bank', j.device?.bank], ['Address', j.device?.address], ['Category', j.category?.name]]} />
                <Dl items={[
                  ['Technician', j.assignee ? <Link key="t" className="text-primary hover:underline" to={`/technicians/${j.assignee.id}`}>{j.assignee.full_name}</Link> : 'Unassigned'],
                  ['Created', fmtDateTime(j.created_at)], ['Closed', fmtDateTime(j.closed_at)], ['Corrections', j.correction_count]]} />
                <Dl items={[
                  ['SLA due', j.sla.due_at ? fmtDateTime(j.sla.due_at) : 'No SLA policy'], [j.sla.stopped ? 'SLA result' : 'Remaining', j.sla.remaining_seconds === null ? '—' : fmtRemaining(j.sla.remaining_seconds, j.sla.stopped)],
                  ['SLA paused', j.sla.paused_seconds ? fmtDuration(j.sla.paused_seconds) : 'Not paused'], ['Status', STATUS_LABEL[j.status]]]} />
              </div>
            </Card>

            {j.status === 'VERIFICATION' && (
              <div className="rounded border border-warn-100 bg-warn-50 px-4 py-2.5 text-sm text-warn" role="status">
                This job is resolved but <strong>not closed</strong>. Review the report and photos below, then approve or request a correction.
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader title="Timeline" subtitle="Every status change is recorded and audited" />
                <ol className="px-4 pb-4 space-y-3">
                  {j.events.map((e) => {
                    const late = Math.abs(new Date(e.recorded_at).getTime() - new Date(e.occurred_at).getTime()) > 120000
                    return (
                      <li key={e.id} className="flex gap-3">
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm"><span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>{e.to && <span className="text-muted"> → {STATUS_LABEL[e.to]}</span>}</div>
                          <div className="text-xs text-muted">{fmtDateTime(e.occurred_at)}{e.actor ? ` · ${e.actor}` : ''}{late ? ` · received ${fmtDateTime(e.recorded_at)} (recorded offline)` : ''}</div>
                          {e.note && <div className="text-xs mt-0.5 bg-canvas rounded px-2 py-1 break-words">{e.note}</div>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader title="SLA breakdown" subtitle={j.sla.policy_id ? 'Targets come from the SLA policy applied to this job' : undefined} />
                  {!j.sla.policy_id ? <p className="px-4 pb-4 text-sm text-muted">No SLA policy matches this job, so no targets are tracked. An administrator can add one under Settings → SLA Policy.</p> : (
                    <table className="w-full text-sm"><thead><tr><th className="th">Segment</th><th className="th">Elapsed</th><th className="th">Target</th><th className="th">State</th></tr></thead>
                      <tbody>{SEGMENTS.map(([k, label]) => { const s = j.sla.segments[k]; return (
                        <tr key={k}><td className="td">{label}</td><td className="td tabular-nums">{s.seconds === null ? '—' : fmtDuration(s.seconds)}{s.seconds !== null && !s.done ? ' (running)' : ''}</td>
                          <td className="td tabular-nums">{s.target_min ? `${s.target_min} min` : '—'}</td><td className="td">{s.seconds === null ? <span className="text-muted">pending</span> : <Badge tone={SEG_TONE[s.state] ?? 'neutral'}>{s.state.replace('_', ' ')}</Badge>}</td></tr>) })}</tbody></table>
                  )}
                </Card>
                <Card>
                  <CardHeader title="SLA pauses" />
                  <PausesFor jobId={j.id} data={pauses} />
                </Card>
                <Card>
                  <CardHeader title="Assignments" />
                  {j.assignments.length === 0 ? <p className="px-4 pb-4 text-sm text-muted">Not assigned yet.</p> : (
                    <ul className="px-4 pb-4 space-y-2 text-sm">{j.assignments.map((x, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2"><Badge tone={x.status === 'active' ? 'info' : x.status === 'rejected' ? 'crit' : 'neutral'}>{x.status}</Badge>
                        <span className="text-muted">{fmtDateTime(x.assigned_at)}{x.responded_at ? ` · answered ${fmtDateTime(x.responded_at)}` : ''}</span>{x.reason && <span className="text-xs bg-canvas rounded px-1.5 py-0.5">{x.reason}</span>}</li>))}</ul>
                  )}
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader title="Service report & evidence" subtitle={j.report ? `Report v${j.report.version} · submitted ${fmtDateTime(j.report.submitted_at)}` : undefined} />
              <div className="px-4 pb-4 grid lg:grid-cols-2 gap-6">
                <div>
                  {j.report ? (
                    <>
                      <Dl items={[['Resolution', RESOLUTIONS[j.report.resolution] ?? j.report.resolution], ['Notes', j.report.notes], ['Parts used', j.report.parts_used]]} />
                      <h3 className="text-xs font-medium text-muted mt-4 mb-1.5">Checklist</h3>
                      {j.report.checklist.length === 0 ? <p className="text-sm text-muted">No checklist items recorded.</p> : (
                        <ul className="text-sm space-y-1">{j.report.checklist.map((c, i) => <li key={i} className="flex items-center gap-2"><span className={c.done ? 'text-ok' : 'text-crit'}>{c.done ? '✓' : '✗'}</span>{c.label}</li>)}</ul>
                      )}
                    </>
                  ) : <p className="text-sm text-muted">No report submitted yet.</p>}
                </div>
                <div>
                  {j.evidence.length === 0 ? <p className="text-sm text-muted">No photos uploaded yet.</p> : (['before', 'after', 'other'] as const).map((kind) => {
                    const items = j.evidence.filter((e) => e.kind === kind)
                    return items.length ? (
                      <div key={kind} className="mb-3"><h3 className="text-xs font-medium text-muted mb-1.5 capitalize">{kind} photos</h3>
                        <div className="flex flex-wrap gap-2">{items.map((e) => (
                          <button key={e.id} onClick={() => setPhoto(e)} className="rounded border border-line overflow-hidden hover:border-primary" aria-label={`Open ${kind} photo`}><EvidenceImage id={e.id} alt={`${kind} photo`} className="w-28 h-20 object-cover" /></button>))}</div></div>) : null
                  })}
                </div>
              </div>
            </Card>
          </div>
        )}
      </Async>

      {job && <AssignPanel open={assignOpen} job={{ id: job.id, code: job.code, status: job.status, assigneeName: job.assignee?.full_name }} onClose={() => setAssignOpen(false)} onDone={refresh} />}
      <ReasonDialog open={dlg === 'cancel'} danger title="Cancel this job" label="Reason for cancellation" confirmLabel="Cancel job" onClose={() => setDlg(null)}
        onConfirm={async (reason) => { await api.post(`/jobs/${id}/cancel`, { reason }); refresh() }} />
      <ReasonDialog open={dlg === 'correct'} title="Request correction" label="What must the technician fix or add?" confirmLabel="Send back to technician" onClose={() => setDlg(null)}
        onConfirm={async (reason) => { await api.post(`/jobs/${id}/request-correction`, { reason }); refresh() }} />
      <ReasonDialog open={dlg === 'pause'} title="Request SLA pause" label="Documented reason (an authorized approver must approve)" minLength={10} confirmLabel="Send request" onClose={() => setDlg(null)}
        onConfirm={async (reason) => { await api.post(`/sla/${id}/pause-request`, { reason }); refresh() }} />
      <Modal open={!!photo} wide title={photo ? `${photo.kind} photo` : ''} onClose={() => setPhoto(null)}>
        {photo ? <><EvidenceImage id={photo.id} alt={`${photo.kind} photo`} className="max-h-[60vh] mx-auto" /><p className="text-xs text-muted mt-2 text-center">{photo.original_name ?? ''} · {Math.round(photo.size / 1024)} KB · {fmtDateTime(photo.created_at)}</p></> : <Loading />}
      </Modal>
    </>
  )
}

function PausesFor({ jobId, data }: { jobId: string; data: ReturnType<typeof useAsync<Pause[]>> }) {
  const mine = (data.data ?? []).filter((p) => p.job_id === jobId)
  if (data.loading && !data.data) return <Loading />
  if (mine.length === 0) return <p className="px-4 pb-4 text-sm text-muted">No pause requests. Putting a job on hold does <strong>not</strong> pause its SLA.</p>
  return (
    <ul className="px-4 pb-4 space-y-2 text-sm">{mine.map((p) => (
      <li key={p.id}><div className="flex items-center gap-2"><Badge tone={p.status === 'approved' ? 'warn' : p.status === 'pending' ? 'info' : 'neutral'}>{p.status}</Badge><span className="text-xs text-muted">{fmtDateTime(p.created_at)} · {p.requested_by}</span></div>
        <div className="text-xs mt-0.5">{p.reason}</div>{p.decision_note && <div className="text-xs text-muted">Decision ({p.decided_by}): {p.decision_note}</div>}</li>))}</ul>
  )
}

export { SlaCell }
