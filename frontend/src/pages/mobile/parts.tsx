import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, MapPin, Timer } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtRemaining, STATUS_LABEL } from '../../lib/format'
import { useAsync, useNow } from '../../lib/hooks'
import { pendingForJob, projectStatus, STATE_LABEL, TYPE_LABEL, type QueueItem } from '../../lib/offline'
import type { Job, JobDetail, JobStatus } from '../../lib/types'
import { Badge, Button, Card, PriorityBadge, SlaBadge, StatusBadge, Modal, Field, Textarea, cn, type Tone } from '../../components/ui'
import { useMobile } from './MobileContext'

export function BackHeader({ title, to, right }: { title: string; to?: string; right?: ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="flex items-center gap-1 mb-3">
      <button onClick={() => (to ? nav(to) : nav(-1))} aria-label="Back" className="grid place-items-center w-11 h-11 -ml-2 rounded-full active:bg-line"><ChevronLeft size={26} /></button>
      <h1 className="text-lg flex-1 truncate">{title}</h1>
      {right}
    </div>
  )
}

export const STATE_TONE: Record<QueueItem['state'], Tone> = { local: 'neutral', pending: 'warn', confirmed: 'ok', rejected: 'crit' }
export const StateBadge = ({ state }: { state: QueueItem['state'] }) => <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>

/** SLA time left, ticking, computed from the server's due_at. */
export function SlaClock({ job }: { job: Pick<Job, 'sla'> }) {
  const now = useNow(15000)
  const due = job.sla.due_at
  if (!due) return <span className="text-muted flex items-center gap-1"><Timer size={16} /> No SLA policy</span>
  const stopped = !!job.sla.stopped && job.sla.remaining_seconds !== null
  const remaining = stopped ? job.sla.remaining_seconds! : Math.round((Date.parse(due) - now) / 1000)
  const tone = remaining < 0 ? 'text-crit' : job.sla.state === 'warning' ? 'text-warn' : 'text-ok'
  return (
    <span className={cn('flex items-center gap-1 font-semibold tabular-nums', tone)}>
      <Timer size={16} aria-hidden /> {fmtRemaining(remaining, stopped)}
      <span className="text-muted font-normal text-xs ml-1">by {new Date(due).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
    </span>
  )
}

export function JobCard({ job, to }: { job: Job; to?: string }) {
  const { items } = useMobile()
  const pending = pendingForJob(items, job.id).length
  return (
    <Link to={to ?? `/m/job/${job.id}`} className="block active:scale-[.99] transition-transform">
      <Card className="p-4 border-l-4" >
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1"><span className="font-semibold">{job.code}</span><PriorityBadge priority={job.priority} /><StatusBadge status={job.status} /></div>
            <div className="font-medium">{job.device?.code} <span className="text-muted font-normal">{job.device?.type}</span></div>
            {job.device?.address && <div className="text-muted text-sm flex items-center gap-1 truncate"><MapPin size={14} aria-hidden />{job.device.address}</div>}
            <div className="text-sm mt-1 line-clamp-2">{job.description}</div>
            <div className="flex items-center justify-between mt-2 text-sm"><SlaClock job={job} /><SlaBadge state={job.sla.state} /></div>
            {pending > 0 && <div className="mt-2"><Badge tone="warn">{pending} not yet confirmed by server</Badge></div>}
          </div>
          <ChevronRight className="text-muted mt-1" aria-hidden />
        </div>
      </Card>
    </Link>
  )
}

/** The job as the server last said it, plus what is still only on this device. */
export function useJobData(id: string) {
  const { jobs, items, jobsVersion } = useMobile()
  const detail = useAsync(() => api.get<JobDetail>(`/jobs/${id}`), [id, jobsVersion])
  const base = jobs?.find((j) => j.id === id) ?? null
  const d = detail.data
  const job: (Job | JobDetail) | null = d && base ? (Date.parse(d.updated_at) >= Date.parse(base.updated_at) ? d : base) : (d ?? base)
  const pending = pendingForJob(items, id)
  const serverStatus = job?.status ?? null
  const projected: JobStatus | null = serverStatus ? projectStatus(serverStatus, pending) : null
  return { job, detail: d, loading: detail.loading && !job, error: job ? null : detail.error, reload: detail.reload, pending, serverStatus, projected, all: items.filter((i) => i.job_id === id) }
}

/** Server status vs. what is only recorded locally, kept visibly separate. */
export function StatusPanel({ serverStatus, projected, pending }: { serverStatus: JobStatus; projected: JobStatus; pending: QueueItem[] }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted mb-1">Status confirmed by server</div>
      <StatusBadge status={serverStatus} />
      {pending.length > 0 && (
        <div className="mt-3 rounded-md bg-warn-50 border border-warn-100 p-3" role="status">
          <div className="text-sm font-medium text-warn">Not yet confirmed ({pending.length})</div>
          {projected !== serverStatus && <div className="text-xs text-ink/80 mt-0.5">If accepted, the job becomes: <b>{STATUS_LABEL[projected]}</b></div>}
          <ul className="mt-2 space-y-1">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm gap-2"><span>{TYPE_LABEL[p.type]}</span><StateBadge state={p.state} /></li>
            ))}
          </ul>
          <Link to="/m/sync" className="text-xs text-primary underline mt-2 inline-block">Open sync queue</Link>
        </div>
      )}
    </Card>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mt-5 mb-2">{children}</h2>
}

export function BigButton(props: Parameters<typeof Button>[0]) {
  return <Button size="lg" {...props} className={cn('w-full', props.className)} />
}

// ---------------------------------------------------------------- M13: reason sheets (reject / hold / appeal)
export interface ReasonOption { value: string; label: string }

export const REJECT_OPTIONS: ReasonOption[] = [
  { value: 'vehicle', label: 'Vehicle breakdown' },
  { value: 'too_far', label: 'Too far to arrive in time' },
  { value: 'busy', label: 'Already on another job' },
  { value: 'unavailable', label: 'Not able to work right now' },
  { value: 'other', label: 'Other (note required)' },
]

/** Bottom sheet that makes the technician choose a reason (and write a note when needed) before an action is recorded. */
export function ReasonSheet({ open, title, options, noteRequiredFor = ['other'], confirmLabel, danger, onClose, onConfirm }: {
  open: boolean; title: string; options: ReasonOption[]; noteRequiredFor?: string[]; confirmLabel: string; danger?: boolean
  onClose: () => void; onConfirm: (r: { value: string; label: string; note: string }) => Promise<void> | void
}) {
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setValue(''); setNote(''); setErr(null) } }, [open])
  if (!open) return null
  const needNote = noteRequiredFor.includes(value)
  const submit = async () => {
    if (!value) { setErr('Please choose a reason.'); return }
    if (needNote && note.trim().length < 3) { setErr('Please write a short note (at least 3 characters).'); return }
    setBusy(true)
    try { await onConfirm({ value, label: options.find((o) => o.value === value)!.label, note: note.trim() }); onClose() } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full bg-surface rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[88vh] overflow-y-auto">
        <div className="mx-auto w-10 h-1 rounded-full bg-line mb-3" />
        <h2 className="text-lg mb-3">{title}</h2>
        <div role="radiogroup" aria-label="Reason" className="space-y-2">
          {options.map((o) => (
            <label key={o.value} className={cn('flex items-center gap-3 rounded-md border p-3 tap', value === o.value ? 'border-primary bg-primary-50' : 'border-line')}>
              <input type="radio" name="reason" className="w-5 h-5" checked={value === o.value} onChange={() => setValue(o.value)} /> {o.label}
            </label>
          ))}
        </div>
        <div className="mt-3"><Field label={needNote ? 'Note (required)' : 'Note (optional)'}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        {err && <p className="text-crit text-sm mt-2" role="alert">{err}</p>}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Button size="lg" onClick={onClose}>Cancel</Button>
          <Button size="lg" variant={danger ? 'danger' : 'primary'} loading={busy} onClick={submit}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

/** Free-text sheet (appeals). */
export function TextSheet({ open, title, label, minLength, confirmLabel, onClose, onConfirm }: {
  open: boolean; title: string; label: string; minLength: number; confirmLabel: string; onClose: () => void; onConfirm: (text: string) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setText(''); setErr(null) } }, [open])
  const submit = async () => {
    if (text.trim().length < minLength) { setErr(`Please write at least ${minLength} characters.`); return }
    setBusy(true)
    try { await onConfirm(text.trim()); onClose() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} title={title} onClose={onClose} footer={<><Button size="lg" onClick={onClose}>Cancel</Button><Button size="lg" variant="primary" loading={busy} onClick={submit}>{confirmLabel}</Button></>}>
      <Field label={label} error={err}><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </Modal>
  )
}
