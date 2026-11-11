import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import type { Candidate, JobStatus } from '../../lib/types'
import { Async, Badge, Button, Field, Modal, Textarea, cn, useAction } from '../../components/ui'

export interface AssignTarget { id: string; code: string; status: JobStatus; assigneeName?: string | null }

const AVAIL: Record<Candidate['availability'], { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  available: { label: 'Available', tone: 'ok' }, busy: { label: 'Busy', tone: 'warn' }, off_shift: { label: 'Off shift', tone: 'neutral' },
}

/** D03b — assign (CREATED) or reassign (any other reassignable state, reason mandatory). The scheduler always makes the final choice. */
export default function AssignPanel({ open, job, onClose, onDone }: { open: boolean; job: AssignTarget | null; onClose: () => void; onDone: () => void }) {
  const reassign = !!job && job.status !== 'CREATED'
  const run = useAction()
  const list = useAsync(() => (open && job ? api.get<Candidate[]>(`/jobs/${job.id}/candidates`) : Promise.resolve([] as Candidate[])), [open, job?.id])
  const [picked, setPicked] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) { setPicked(null); setNote(''); setErr(null) } }, [open, job?.id])
  useEffect(() => {
    if (open && picked === null && list.data?.length) setPicked((list.data.find((c) => c.recommended) ?? list.data.find((c) => !c.is_current) ?? list.data[0]).id)
  }, [open, list.data, picked])

  const submit = async () => {
    if (!job || !picked) { setErr('Choose a technician'); return }
    if (reassign && note.trim().length < 3) { setErr('A reason is required to reassign'); return }
    setBusy(true); setErr(null)
    const ok = await run(() => reassign
      ? api.post(`/jobs/${job.id}/reassign`, { technician_id: picked, reason: note.trim() })
      : api.post(`/jobs/${job.id}/assign`, { technician_id: picked, ...(note.trim() ? { note: note.trim() } : {}) }),
    reassign ? 'Job reassigned' : 'Technician assigned and notified')
    setBusy(false)
    if (ok) { onDone(); onClose() }
  }

  return (
    <Modal open={open} wide title={`${reassign ? 'Reassign' : 'Assign'} ${job?.code ?? ''}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!picked}>{reassign ? 'Reassign' : 'Assign'}</Button></>}>
      <p className="text-xs text-muted mb-3">
        The recommendation is only a suggestion. Distance and travel time are <strong>estimates</strong> (straight line at an assumed average speed) and only appear when the technician has reported a recent GPS position.
      </p>
      <Async a={list} empty={(d) => d.length === 0} emptyTitle="No technicians" emptyHint="Create technician accounts under Settings → Users.">
        {(items) => (
          <ul className="space-y-2" role="radiogroup" aria-label="Technicians">
            {items.map((c) => (
              <li key={c.id}>
                <label className={cn('flex items-start gap-3 rounded border p-3 cursor-pointer', picked === c.id ? 'border-primary bg-primary-50/50' : 'border-line hover:bg-canvas')}>
                  <input type="radio" name="tech" className="mt-1" checked={picked === c.id} onChange={() => setPicked(c.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.full_name}</span>
                      <Badge tone={AVAIL[c.availability].tone}>{AVAIL[c.availability].label}</Badge>
                      {c.recommended && <Badge tone="info">Recommended</Badge>}
                      {c.is_current && <Badge>Currently assigned</Badge>}
                      {c.skill_match && <Badge tone="ok">Skill match</Badge>}
                    </div>
                    <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>Active assignments: <strong className="text-ink">{c.active_jobs}</strong></span>
                      <span>Skills: {c.skills.length ? c.skills.join(', ') : '—'}</span>
                      {c.distance_km !== null
                        ? <span className="inline-flex items-center gap-1"><MapPin size={12} />≈ {c.distance_km} km{c.eta_min_estimate !== null && <> · ETA ≈ {c.eta_min_estimate} min <em>(estimate)</em></>}{c.location?.stale ? ' · position is stale' : ''}</span>
                        : <span>No recent GPS position</span>}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Async>
      <div className="mt-4">
        <Field label={reassign ? 'Reason for reassignment (required)' : 'Note for the technician (optional)'} error={err}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
