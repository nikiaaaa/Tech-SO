import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BarChart3, CheckCircle2, Clock, CloudOff, Home, ListChecks, Loader2, MapPinned, Satellite, TriangleAlert, User, Wifi } from 'lucide-react'
import { Button, PriorityBadge, cn } from '../../components/ui'
import { useMobile } from './MobileContext'
import { REJECT_OPTIONS, ReasonSheet, SlaClock } from './parts'

const REASON_TEXT: Record<string, string> = { active_shift: 'active shift', active_assignment: 'active job assignment' }

function TopBar() {
  const { online, syncing, unsynced, items } = useMobile()
  const rejected = items.filter((i) => i.state === 'rejected').length
  return (
    <header className="sticky top-0 z-30 bg-surface border-b border-line px-3 h-14 flex items-center gap-2 pt-[env(safe-area-inset-top)] box-content">
      <img src="/logo.png" alt="" className="w-9 h-9" />
      <div className="leading-tight flex-1"><div className="font-semibold text-primary-700">TechSO</div><div className="text-[11px] text-muted">Field technician</div></div>
      <span className={cn('flex items-center gap-1 text-xs font-medium rounded-full px-2 py-1', online ? 'bg-ok-50 text-ok' : 'bg-crit-50 text-crit')}>
        {online ? <Wifi size={14} aria-hidden /> : <CloudOff size={14} aria-hidden />}{online ? 'Online' : 'Offline'}
      </span>
      <Link to="/m/sync" aria-label="Sync queue" className={cn('flex items-center gap-1 text-xs font-medium rounded-full px-2 py-1', syncing ? 'bg-primary-50 text-primary-700' : unsynced || rejected ? 'bg-warn-50 text-warn' : 'bg-canvas text-muted')}>
        {syncing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : unsynced || rejected ? <Clock size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden />}
        {syncing ? 'Syncing' : unsynced ? `${unsynced} pending` : rejected ? `${rejected} refused` : 'All synced'}
      </Link>
    </header>
  )
}

function TrackingBanner() {
  const { trackerState: t, tracking, tracker } = useMobile()
  if (t.running && t.config) {
    return (
      <div className="bg-primary text-white px-3 py-2 text-sm flex items-start gap-2" role="status">
        <Satellite size={18} className="mt-0.5 shrink-0" aria-hidden />
        <div className="flex-1">
          <b>Location tracking is active</b> ({REASON_TEXT[t.config.reason] ?? t.config.reason}) — retention {t.config.retentionDays} days. Dispatch can see your position.
          {t.error && <div className="mt-1 bg-white/15 rounded px-2 py-1">{t.error.message}</div>}
        </div>
        <Link to="/m/shift" className="underline shrink-0">Details</Link>
      </div>
    )
  }
  if (tracking?.active && t.error) {
    return (
      <div className="bg-warn-50 text-warn border-b border-warn-100 px-3 py-2 text-sm flex items-start gap-2" role="alert">
        <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden />
        <div className="flex-1"><b>Tracking is required but location is unavailable.</b> {t.error.message}</div>
        {t.error.kind !== 'insecure_context' && <Button size="sm" onClick={() => tracker.retry()}>Retry</Button>}
      </div>
    )
  }
  return null
}

/** Full-width alert for a job that is waiting for the technician's answer. Works only while the app is open. */
function AssignmentAlert() {
  const { awaiting, perform } = useMobile()
  const loc = useLocation()
  const [rejecting, setRejecting] = useState(false)
  const job = awaiting[0]
  if (!job || loc.pathname === `/m/job/${job.id}/incoming`) return null
  const hot = job.priority === 'critical' || job.priority === 'high'
  return (
    <div className={cn('px-3 py-3 border-b-4', hot ? 'bg-crit-50 border-crit' : 'bg-primary-50 border-primary')} role="alert" aria-live="assertive">
      <div className="flex items-center gap-2 mb-1">
        <TriangleAlert size={20} className={hot ? 'text-crit' : 'text-primary'} aria-hidden />
        <b className="text-base">New assignment {awaiting.length > 1 ? `(+${awaiting.length - 1} more)` : ''}</b>
        <PriorityBadge priority={job.priority} />
      </div>
      <div className="text-sm"><b>{job.code}</b> · {job.device?.code} ({job.device?.type})</div>
      <div className="text-sm text-muted">{job.device?.address ?? 'Address not set'}</div>
      <div className="text-sm mt-0.5"><SlaClock job={job} /></div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <Button size="lg" variant="primary" onClick={() => void perform('accept', job.id)}>Accept</Button>
        <Button size="lg" onClick={() => setRejecting(true)}>Reject</Button>
        <Link to={`/m/job/${job.id}/incoming`} className="inline-flex items-center justify-center rounded border border-line bg-surface text-base min-h-[48px]">Details</Link>
      </div>
      <p className="text-[11px] text-muted mt-2">Alerts sound only while this app is open. There is no background push in this version.</p>
      <ReasonSheet open={rejecting} title="Why are you rejecting this job?" options={REJECT_OPTIONS} confirmLabel="Reject job" danger onClose={() => setRejecting(false)}
        onConfirm={async (r) => { await perform('reject', job.id, { reason: r.value === 'other' ? r.note : `${r.label}${r.note ? `: ${r.note}` : ''}` }) }} />
    </div>
  )
}

const TABS = [
  { to: '/m', label: 'Home', icon: Home, end: true },
  { to: '/m/jobs', label: 'Jobs', icon: ListChecks },
  { to: '/m/shift', label: 'Shift', icon: MapPinned },
  { to: '/m/performance', label: 'Score', icon: BarChart3 },
  { to: '/m/profile', label: 'Profile', icon: User },
]

export default function MobileLayout() {
  const { stale, jobs } = useMobile()
  return (
    <div className="min-h-full flex flex-col bg-canvas text-base">
      <TopBar />
      <TrackingBanner />
      <AssignmentAlert />
      {stale && jobs && <div className="bg-warn-50 text-warn text-xs px-3 py-1.5 border-b border-warn-100" role="status">Showing the copy saved on this device. It may be out of date (last server answer failed).</div>}
      <main className="flex-1 p-3 pb-24"><Outlet /></main>
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line grid grid-cols-5 pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[11px]', isActive ? 'text-primary-700 font-semibold' : 'text-muted')}>
            <Icon size={22} aria-hidden />{label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
