import type { JobStatus, Priority, SlaState } from './types'

export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'

export function timeAgo(iso?: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** 4500 -> "1h 15m" */
export function fmtDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return '—'
  const m = Math.round(Math.abs(seconds) / 60)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

/** SLA text. Running clock: "13m left" / "overdue 5m". Stopped (job resolved): "met, 13m spare" / "missed by 5m". */
export function fmtRemaining(seconds?: number | null, stopped = false): string {
  if (seconds === null || seconds === undefined) return '—'
  if (stopped) return seconds >= 0 ? `met, ${fmtDuration(seconds)} spare` : `missed by ${fmtDuration(seconds)}`
  return seconds >= 0 ? `${fmtDuration(seconds)} left` : `overdue ${fmtDuration(seconds)}`
}

export const PRIORITY_LABEL: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
export const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low']

export const STATUS_LABEL: Record<JobStatus, string> = {
  CREATED: 'Created', ASSIGNED: 'Assigned', NOTIFIED: 'Awaiting response', ACCEPTED: 'Accepted', REJECTED: 'Rejected',
  EN_ROUTE: 'En route', ARRIVED: 'Arrived', IN_PROGRESS: 'In progress', ON_HOLD: 'On hold', RESOLVED: 'Resolved',
  VERIFICATION: 'Awaiting verification', CLOSED: 'Closed', CANCELLED: 'Cancelled',
}
export const OPEN_STATUSES: JobStatus[] = ['CREATED', 'ASSIGNED', 'NOTIFIED', 'ACCEPTED', 'REJECTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'VERIFICATION']

export const SLA_LABEL: Record<SlaState, string> = {
  on_track: 'On track', warning: 'Warning', breach: 'Breach', no_policy: 'No SLA policy', cancelled: 'Cancelled',
}

export const HOLD_REASONS: Record<string, string> = {
  spare_part_unavailable: 'Spare part unavailable', site_access_delay: 'Site access delay', connectivity_issue: 'Connectivity issue',
  awaiting_bank_confirmation: 'Awaiting bank confirmation', other: 'Other (note required)',
}
export const RESOLUTIONS: Record<string, string> = {
  repaired: 'Repaired', part_replaced: 'Part replaced', configuration_reset: 'Configuration reset',
  no_fault_found: 'No fault found', escalated_to_vendor: 'Escalated to vendor',
}
export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin', management: 'Management', supervisor: 'Supervisor', scheduler: 'Scheduler / Dispatcher', technician: 'Field Technician',
}
export const EVENT_LABEL: Record<string, string> = {
  created: 'Job created', assigned: 'Assigned', reassigned: 'Reassigned', notified: 'Technician notified', accepted: 'Accepted',
  rejected: 'Rejected', journey_started: 'Journey started', arrived: 'Arrived on site', work_started: 'Work started', on_hold: 'Put on hold',
  resumed: 'Resumed', resolved: 'Resolved', submitted_for_verification: 'Submitted for verification', verified_closed: 'Approved and closed',
  correction_requested: 'Correction requested', cancelled: 'Cancelled', escalation: 'Escalated (no response)',
}

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024
