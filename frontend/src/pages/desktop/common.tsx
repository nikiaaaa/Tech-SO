import { useNow } from '../../lib/hooks'
import { useRealtime } from '../../lib/realtime'
import { fmtRemaining } from '../../lib/format'
import type { Job, JobStatus, Role } from '../../lib/types'
import { PriorityBadge, SlaBadge, StatusBadge, cn } from '../../components/ui'

// UI hints only: the API enforces every permission. These mirror backend/app/security.py.
export const DISPATCH_ROLES: Role[] = ['super_admin', 'supervisor', 'scheduler']
export const PAUSE_REQUEST_ROLES: Role[] = ['super_admin', 'supervisor', 'scheduler']
export const PAUSE_APPROVE_ROLES: Role[] = ['super_admin', 'supervisor', 'management']
export const SHIFT_ROLES: Role[] = ['super_admin', 'supervisor']
export const DEVICE_WRITE_ROLES: Role[] = ['super_admin', 'supervisor', 'scheduler']
export const PERFORMANCE_ROLES: Role[] = ['super_admin', 'supervisor', 'management']
export const APPEAL_DECIDE_ROLES: Role[] = ['super_admin', 'supervisor', 'management']
export const ADMIN_ROLES: Role[] = ['super_admin']

export const has = (role: Role | undefined, roles: Role[]) => !!role && roles.includes(role)

export type JobAction = 'assign' | 'reassign' | 'cancel' | 'verify' | 'request_correction' | 'pause_request'

const REASSIGNABLE: JobStatus[] = ['ASSIGNED', 'NOTIFIED', 'ACCEPTED', 'REJECTED', 'EN_ROUTE', 'ON_HOLD']

/** Which actions a role may offer for a job in a given status (mirrors the server state machine). */
export function jobActions(status: JobStatus, role: Role): JobAction[] {
  const out: JobAction[] = []
  const open = status !== 'CLOSED' && status !== 'CANCELLED'
  if (has(role, DISPATCH_ROLES)) {
    if (status === 'CREATED') out.push('assign')
    if (REASSIGNABLE.includes(status)) out.push('reassign')
    if (status === 'VERIFICATION') out.push('verify', 'request_correction')
    if (open) out.push('cancel')
  }
  if (open && has(role, PAUSE_REQUEST_ROLES)) out.push('pause_request')
  return out
}

export function SlaCell({ sla }: { sla: Job['sla'] }) {
  useNow(30000)
  return (
    <div className="flex flex-col items-start gap-0.5">
      <SlaBadge state={sla.state} />
      {sla.remaining_seconds !== null && sla.state !== 'cancelled' && <span className="text-[11px] text-muted tabular-nums">{fmtRemaining(sla.remaining_seconds, sla.stopped)}</span>}
    </div>
  )
}

export function JobSummaryBadges({ job }: { job: Pick<Job, 'priority' | 'status'> }) {
  return <div className="flex items-center gap-1.5"><PriorityBadge priority={job.priority} /><StatusBadge status={job.status} /></div>
}

/** Refetch when a job is created/updated (optionally only for one job). */
export function useJobEvents(reload: () => void, jobId?: string) {
  useRealtime((e) => {
    if ((e.type === 'job.created' || e.type === 'job.updated' || e.type === 'assignment.new') && (!jobId || ('job_id' in e && e.job_id === jobId))) reload()
  })
}

export const PRIORITY_COLOR = { critical: '#DC2626', high: '#D97706', medium: '#2563EB', low: '#98A2B3' } as const

export function Dl({ items, className }: { items: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-sm', className)}>
      {items.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v ?? '—'}</dd></div>))}
    </dl>
  )
}
