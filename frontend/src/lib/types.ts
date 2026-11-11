// Shapes returned by the TechSO API (see docs/API.md). Kept in one place so desktop and mobile agree.

export type Role = 'super_admin' | 'management' | 'supervisor' | 'scheduler' | 'technician'
export type Priority = 'critical' | 'high' | 'medium' | 'low'
export type JobStatus =
  | 'CREATED' | 'ASSIGNED' | 'NOTIFIED' | 'ACCEPTED' | 'REJECTED' | 'EN_ROUTE' | 'ARRIVED'
  | 'IN_PROGRESS' | 'ON_HOLD' | 'RESOLVED' | 'VERIFICATION' | 'CLOSED' | 'CANCELLED'
export type SlaState = 'on_track' | 'warning' | 'breach' | 'no_policy' | 'cancelled'
export type SegmentName = 'response' | 'dispatch' | 'mobilization' | 'travel' | 'repair' | 'verification' | 'total'

export interface User {
  id: string; email: string; full_name: string; role: Role; phone: string | null
  company: { id: string; name: string; is_demo: boolean } | null
}

export interface DeviceRef {
  id: string; code: string; type: 'ATM' | 'CRM'; address: string | null; lat: number | null; lon: number | null
  status: string; model: string | null; bank: string | null
}

/** `stopped`: the job was resolved, so `remaining_seconds` is the final margin and no longer counts down. */
export interface SlaCompact { state: SlaState; due_at: string | null; remaining_seconds: number | null; stopped?: boolean }
export interface SlaSegment { seconds: number | null; done: boolean; target_min: number | null; state: string }
export interface SlaFull extends SlaCompact {
  segments: Record<SegmentName, SlaSegment>; paused_seconds: number; policy_id: string | null
}

export interface Job {
  id: string; code: string; status: JobStatus; priority: Priority; description: string
  created_at: string; updated_at: string; closed_at: string | null; hold_reason: string | null; correction_count: number
  device: DeviceRef | null
  category: { id: string; name: string } | null
  assignee: { id: string; full_name: string } | null
  sla: SlaCompact
}

export interface JobEventOut {
  id: string; type: string; from: JobStatus | null; to: JobStatus | null; note: string | null
  actor: string | null; occurred_at: string; recorded_at: string
}
export interface Report {
  id: string; version: number; resolution: string; notes: string | null
  checklist: { label: string; done: boolean }[]; parts_used: string | null; technician_id: string; submitted_at: string
}
export interface Evidence { id: string; kind: 'before' | 'after' | 'other'; mime: string; size: number; original_name: string | null; created_at: string; uploader_id: string }
export interface Assignment { technician_id: string; status: string; assigned_at: string; responded_at: string | null; reason: string | null }

export interface JobDetail extends Omit<Job, 'sla'> {
  sla: SlaFull; assignments: Assignment[]; events: JobEventOut[]; report: Report | null; evidence: Evidence[]
}

export interface Paged<T> { total: number; page: number; page_size: number; items: T[] }

export interface Candidate {
  id: string; full_name: string; availability: 'available' | 'busy' | 'off_shift'; active_jobs: number; skills: string[]
  skill_match: boolean; distance_km: number | null; eta_min_estimate: number | null; recommended: boolean; is_current: boolean
  location: { lat: number; lon: number; age_s: number; stale: boolean } | null
}

export interface Position { lat: number; lon: number; accuracy_m: number | null; recorded_at: string; age_s: number; stale: boolean }
export interface Technician {
  id: string; full_name: string; phone: string | null; skills: string[]; is_active: boolean; active_jobs: number
  teams: string[]; status: 'available' | 'working' | 'off_shift'; location?: Position | null
}

export interface Device {
  id: string; code: string; device_type: 'ATM' | 'CRM'; model: string | null; address: string | null; lat: number | null
  lon: number | null; status: string; bank_id: string; bank: string | null; branch_id: string | null; open_jobs: number
}

export interface Overview {
  range: string
  kpis: {
    active_jobs: number; unassigned: number; awaiting_acceptance: number; technicians_available: number
    technicians_working: number; technicians_total: number; sla_warning: number; sla_breach: number; resolved: number; critical_open: number
  }
  priority: Partial<Record<Priority, number>>
  sla: { on_track: number; warning: number; breach: number; no_policy: number; on_track_pct: number | null }
  recent_activity: { job_id: string; job_code: string; type: string; to_status: string | null; actor: string | null; at: string }[]
}

export interface NotificationOut {
  id: string; kind: string; title: string; body: string | null; priority: string; job_id: string | null; created_at: string; read: boolean
}

export interface Tracking {
  active: boolean; reason: string; job_id?: string
  policy: { enabled: boolean; min_interval_s: number; max_accuracy_m: number; stale_after_s: number; retention_days: number }
}
export interface ShiftOut { id: string; status: string; starts_at: string; ends_at: string; started_at: string | null; ended_at: string | null }

export interface ScoreOut {
  id: string; job_id: string; job_code: string | null; technician_id: string; scoring_version: number
  dimensions: Record<string, number | null>; adjustments: { factor: string; text: string }[]
  total: number; override_total: number | null; override_note: string | null; effective_total: number
  explanation: string; created_at: string
  appeal: { id: string; status: string; reason: string; decision_note: string | null } | null
}

export interface ReportTable { kind: string; columns: string[]; rows: (string | number | null)[][]; summary: Record<string, unknown> }

export type RealtimeEvent =
  | { type: 'job.created'; job_id: string; code: string; priority: Priority }
  | { type: 'job.updated'; job_id: string; code: string; status: JobStatus }
  | { type: 'assignment.new'; job_id: string; priority: Priority }
  | { type: 'assignment.removed'; job_id: string }
  | { type: 'location.update'; user_id: string; lat: number; lon: number; accuracy_m: number | null; recorded_at: string }
  | { type: 'notification'; kind: string; title: string; priority: string; job_id: string | null }
