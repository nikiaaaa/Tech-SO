import { Link } from 'react-router-dom'
import { ChevronRight, CloudOff, MapPinned, Satellite } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { Badge, Button, Card, Empty, ErrorState, Loading } from '../../components/ui'
import { useMobile } from './MobileContext'
import { JobCard, SectionTitle } from './parts'

/** M01 — Home: what needs a response now, what is active, shift and sync state. */
export default function Home() {
  const { user } = useAuth()
  const m = useMobile()
  const active = (m.jobs ?? []).filter((j) => j.status !== 'NOTIFIED' || !m.awaiting.some((a) => a.id === j.id))
  const onShift = m.shift?.status === 'active'
  return (
    <div>
      <h1 className="text-xl mb-0.5">Hello, {user?.full_name.split(' ')[0]}</h1>
      <p className="text-muted text-sm mb-3">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>

      <Link to="/m/shift" className="block">
        <Card className="p-3 flex items-center gap-3">
          <MapPinned className={onShift ? 'text-ok' : 'text-muted'} aria-hidden />
          <div className="flex-1">
            <div className="font-medium">{onShift ? 'Shift in progress' : 'No active shift'}</div>
            <div className="text-xs text-muted flex items-center gap-1">
              <Satellite size={13} aria-hidden />
              {m.trackerState.running ? 'Location tracking is active' : m.tracking ? 'Location tracking is off' : 'Tracking status unknown (offline)'}
            </div>
          </div>
          {!onShift && <Badge tone="warn">Start shift</Badge>}
          <ChevronRight className="text-muted" aria-hidden />
        </Card>
      </Link>

      {(m.unsynced > 0 || m.items.some((i) => i.state === 'rejected')) && (
        <Link to="/m/sync" className="block mt-3">
          <Card className="p-3 flex items-center gap-2 border-warn-100 bg-warn-50">
            <CloudOff size={18} className="text-warn" aria-hidden />
            <span className="flex-1 text-sm">{m.unsynced > 0 ? `${m.unsynced} action(s) only on this device, not confirmed by the server.` : 'Some actions were refused by the server.'}</span>
            <ChevronRight size={16} className="text-muted" aria-hidden />
          </Card>
        </Link>
      )}

      {m.awaiting.length > 0 && (
        <>
          <SectionTitle>Needs your response</SectionTitle>
          <div className="space-y-3">{m.awaiting.map((j) => <JobCard key={j.id} job={j} to={`/m/job/${j.id}/incoming`} />)}</div>
        </>
      )}

      <SectionTitle>Active jobs</SectionTitle>
      {m.jobs === null && m.jobsLoading && <Loading />}
      {m.jobs === null && !m.jobsLoading && m.jobsError && <ErrorState message={m.jobsError} onRetry={() => void m.reloadJobs()} />}
      {m.jobs !== null && active.length === 0 && m.awaiting.length === 0 && (
        <Card><Empty title="No active jobs" hint="New assignments from dispatch appear here and sound an alert while the app is open." /></Card>
      )}
      <div className="space-y-3">{active.map((j) => <JobCard key={j.id} job={j} />)}</div>
      {m.jobsError && m.jobs !== null && <div className="mt-3 flex items-center gap-2 text-sm text-crit" role="alert">Could not refresh: {m.jobsError}<Button size="sm" onClick={() => void m.reloadJobs()}>Retry</Button></div>}
    </div>
  )
}
