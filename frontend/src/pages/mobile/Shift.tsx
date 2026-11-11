import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, CircleX, Satellite } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { geolocationPermission, type Fix, type GpsError } from '../../lib/gps'
import { useOnline } from '../../lib/hooks'
import { Badge, Button, Card, useAction } from '../../components/ui'
import { useMobile } from './MobileContext'
import { SectionTitle } from './parts'

type Check = { ok: boolean | null; label: string; detail?: string }
const Row = ({ c }: { c: Check }) => (
  <li className="flex items-start gap-2 py-2 border-b border-line last:border-0">
    {c.ok === true ? <CheckCircle2 size={18} className="text-ok mt-0.5 shrink-0" aria-hidden /> : c.ok === false ? <CircleX size={18} className="text-crit mt-0.5 shrink-0" aria-hidden /> : <CircleAlert size={18} className="text-muted mt-0.5 shrink-0" aria-hidden />}
    <div className="text-sm"><div className="font-medium">{c.label}</div>{c.detail && <div className="text-muted break-words">{c.detail}</div>}</div>
  </li>
)

function GpsDiagnostics() {
  const { tracker, trackerState: t, tracking, items } = useMobile()
  const [perm, setPerm] = useState<string>('checking…')
  const [test, setTest] = useState<{ fix?: Fix; error?: GpsError } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void geolocationPermission().then(setPerm) }, [test])
  const secure = window.isSecureContext
  const hasApi = 'geolocation' in navigator
  const queuedPings = items.filter((i) => i.type === 'ping' && (i.state === 'local' || i.state === 'pending')).length
  const verified = t.lastConfirmedAt !== null
  const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString('en-GB') : '—')

  const run = async () => {
    setBusy(true)
    try { setTest({ fix: await tracker.testOnce() }) } catch (e) { setTest({ error: e as GpsError }) } finally { setBusy(false) }
  }
  const checks: Check[] = [
    { ok: secure, label: 'Secure connection (https or localhost)', detail: secure ? undefined : 'GPS is blocked on plain http. Open the app over https (development: "npm run dev:https") or on localhost.' },
    { ok: hasApi, label: 'Browser provides GPS' },
    { ok: perm === 'granted' ? true : perm === 'denied' ? false : null, label: `Location permission: ${perm}`, detail: perm === 'denied' ? 'Allow location for this site in the browser settings, then press Test.' : perm === 'prompt' ? 'The browser will ask when you press Test.' : undefined },
    { ok: tracking ? tracking.active : null, label: 'Server allows tracking right now', detail: tracking ? (tracking.active ? `Reason: ${tracking.reason}` : `Not tracking: ${tracking.reason.replaceAll('_', ' ')}. Start a shift or accept a job.`) : 'Could not ask the server (offline).' },
    { ok: t.running, label: 'Tracking is running on this phone' },
    { ok: t.lastFix ? true : null, label: 'Last position fix on this phone', detail: t.lastFix ? `${t.lastFix.lat.toFixed(5)}, ${t.lastFix.lon.toFixed(5)} (±${Math.round(t.lastFix.accuracy_m)} m) at ${fmt(t.lastFix.at)}` : 'No fix yet.' },
    { ok: verified ? true : t.lastServer ? false : null, label: 'Server has stored a position from this phone', detail: verified ? `Confirmed at ${fmt(t.lastConfirmedAt)}` : t.lastServer ? `Last answer: ${t.lastServer.accepted ? 'received' : 'refused'}${t.lastServer.reason ? ` (${t.lastServer.reason})` : ''} at ${fmt(t.lastServer.at)}` : 'Nothing confirmed yet.' },
    { ok: queuedPings === 0 ? null : false, label: `Positions waiting on this device: ${queuedPings}`, detail: queuedPings ? 'They are sent when you are online.' : undefined },
  ]
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1"><Satellite aria-hidden /><h2 className="font-semibold">GPS check</h2>
        {verified ? <Badge tone="ok">Verified end to end</Badge> : <Badge tone="warn">Not verified yet</Badge>}</div>
      <p className="text-xs text-muted mb-2">"Verified" means the server actually stored a position sent by this phone. A fix on the phone alone does not prove it.</p>
      <ul>{checks.map((c) => <Row key={c.label} c={c} />)}</ul>
      <div className="grid gap-2 mt-3">
        <Button size="lg" loading={busy} onClick={() => void run()}>Test my GPS</Button>
        {t.error && t.error.kind !== 'insecure_context' && <Button size="lg" onClick={() => tracker.retry()}>Retry tracking</Button>}
      </div>
      {test?.fix && <div className="mt-3 rounded bg-ok-50 border border-ok-100 p-2 text-sm"><b>Got a position:</b> {test.fix.lat.toFixed(5)}, {test.fix.lon.toFixed(5)} · accuracy ±{Math.round(test.fix.accuracy_m)} m · {fmt(test.fix.at)}<div className="text-xs text-muted mt-1">This test does not send anything to the server.</div></div>}
      {test?.error && <div className="mt-3 rounded bg-crit-50 border border-crit-100 p-2 text-sm text-crit" role="alert">{test.error.message}</div>}
      {t.error && <div className="mt-3 text-sm text-crit" role="alert">{t.error.message}</div>}
    </Card>
  )
}

/** M10 — Shift status: start/end shift (needs a connection) and the GPS check. */
export default function Shift() {
  const { shift, tracking, refreshTracking, online } = useMobile()
  const act = useAction()
  const [busy, setBusy] = useState(false)
  const isOnline = useOnline() && online
  const active = shift?.status === 'active'
  const toggle = async () => {
    setBusy(true)
    try { await act(() => api.post(active ? '/me/shift/end' : '/me/shift/start'), active ? 'Shift ended' : 'Shift started'); await refreshTracking() } finally { setBusy(false) }
  }
  return (
    <div>
      <h1 className="text-xl mb-3">Shift</h1>
      <Card className="p-4">
        <div className="flex items-center justify-between"><div><div className="text-xs text-muted">Status</div><div className="text-lg font-semibold">{active ? 'On shift' : 'Off shift'}</div></div>
          <Badge tone={active ? 'ok' : 'neutral'}>{active ? 'Active' : 'Not started'}</Badge></div>
        {shift && <div className="text-sm text-muted mt-1">Started {fmtDateTime(shift.started_at)} · planned end {fmtDateTime(shift.ends_at)}</div>}
        <Button size="lg" variant={active ? 'secondary' : 'primary'} className="w-full mt-3" loading={busy} disabled={!isOnline} onClick={() => void toggle()}>{active ? 'End shift' : 'Start shift'}</Button>
        {!isOnline && <p className="text-xs text-warn mt-2">Starting or ending a shift needs a connection.</p>}
        {active && <p className="text-xs text-muted mt-2">You cannot end the shift while travelling or working on a job.</p>}
      </Card>

      <SectionTitle>Location tracking</SectionTitle>
      <Card className="p-4 text-sm space-y-1">
        {tracking ? (<>
          <div>Tracking is <b>{tracking.active ? 'active' : 'off'}</b>{tracking.active ? ` (${tracking.reason.replaceAll('_', ' ')})` : ''}.</div>
          <div className="text-muted">Only while you are on shift or have an active job. Dispatch and management can see your position. Positions below {tracking.policy.max_accuracy_m} m accuracy are kept for {tracking.policy.retention_days} days, sent at most every {tracking.policy.min_interval_s} s.</div>
          <div className="text-muted">A position is a hint for dispatch. It is not used on its own to judge your work.</div>
        </>) : <div className="text-muted">Tracking status is unknown until you are online.</div>}
      </Card>

      <SectionTitle>Diagnostics</SectionTitle>
      <GpsDiagnostics />
    </div>
  )
}
