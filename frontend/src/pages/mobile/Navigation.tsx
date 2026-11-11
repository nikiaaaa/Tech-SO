import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ExternalLink, Satellite } from 'lucide-react'
import MapView, { MARKER_COLOR, type MapMarker } from '../../components/MapView'
import { Card, ErrorState, Loading } from '../../components/ui'
import { haversineKm } from '../../lib/gps'
import { fmtTime } from '../../lib/format'
import { useMobile } from './MobileContext'
import { BackHeader, BigButton, useJobData } from './parts'

const ASSUMED_KMH = 25
// Roads are longer than a straight line; same factor as the dispatch screen (backend services/jobs.py ROAD_FACTOR).
const ROAD_FACTOR = 1.4

/** M04 — Navigation: OpenStreetMap with the site and (when a fix exists) your own position. Distances are straight-line estimates. */
export default function NavigationScreen() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { perform, trackerState: t } = useMobile()
  const d = useJobData(id)
  const dev = d.job?.device
  const fix = t.lastFix
  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = []
    if (dev?.lat != null && dev.lon != null) m.push({ id: 'site', lat: dev.lat, lon: dev.lon, kind: 'job', color: MARKER_COLOR.crit, label: dev.code, popup: `${dev.code}\n${dev.address ?? ''}` })
    if (fix) m.push({ id: 'me', lat: fix.lat, lon: fix.lon, kind: 'me', color: MARKER_COLOR.info, label: 'You', popup: `You (accuracy ±${Math.round(fix.accuracy_m)} m)` })
    return m
  }, [dev, fix])
  if (d.loading) return <Loading />
  if (!d.job || !d.projected) return <ErrorState message={d.error ?? 'Job not found'} onRetry={() => void d.reload()} />
  const hasSite = dev?.lat != null && dev.lon != null
  const km = fix && hasSite ? haversineKm(fix.lat, fix.lon, dev!.lat!, dev!.lon!) : null
  const eta = km !== null ? Math.max(1, Math.round(((km * ROAD_FACTOR) / ASSUMED_KMH) * 60)) : null
  const p = d.projected
  return (
    <div>
      <BackHeader title="Navigation" to={`/m/job/${id}`} />
      <div className="text-sm mb-2"><b>{d.job.code}</b> · {dev?.code} · {dev?.address ?? 'Address not set'}</div>
      {hasSite ? (
        <div className="rounded-md overflow-hidden border border-line"><MapView markers={markers} height={300} /></div>
      ) : <Card className="p-4 text-sm text-muted">This device has no coordinates on file, so it cannot be shown on the map.</Card>}

      <Card className="p-3 mt-3 text-sm">
        {km !== null
          ? <div><b>{km.toFixed(1)} km</b> straight-line to the site · about <b>{eta} min</b> <span className="text-muted">(estimate: straight line ×{ROAD_FACTOR} for roads at {ASSUMED_KMH} km/h, not a route)</span></div>
          : <div className="text-muted">Distance appears once your position is known.</div>}
        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted">
          <Satellite size={14} aria-hidden />
          {t.running
            ? fix ? `Last fix ${fmtTime(new Date(fix.at).toISOString())} (±${Math.round(fix.accuracy_m)} m). ${t.lastConfirmedAt ? 'The server has stored your position.' : 'Not yet confirmed by the server.'}` : 'Waiting for a GPS fix…'
            : t.error ? 'Tracking is stopped: location is not available on this device (see below).'
              : 'Tracking is not running. Tracking starts when your assignment is accepted or your shift is active.'}
        </div>
        {t.error && <div className="text-xs text-crit mt-1">{t.error.message} <Link className="underline" to="/m/shift">GPS check</Link></div>}
      </Card>

      {hasSite && (
        <a className="mt-3 inline-flex items-center justify-center gap-2 rounded border border-line bg-surface text-base font-medium min-h-[48px] px-4 w-full" target="_blank" rel="noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${dev!.lat},${dev!.lon}`}><ExternalLink size={18} aria-hidden /> Open in Maps app for turn-by-turn</a>
      )}

      <div className="grid gap-3 mt-3">
        {p === 'ACCEPTED' && (<>
          <p className="text-xs text-muted">Starting the journey tells dispatch you are on the way. Your location is shared with dispatch until the job ends.</p>
          <BigButton variant="primary" onClick={() => void perform('start_journey', id)}>Start journey</BigButton>
        </>)}
        {p === 'EN_ROUTE' && <BigButton variant="primary" onClick={() => nav(`/m/job/${id}/arrival`)}>I have arrived</BigButton>}
        {p !== 'ACCEPTED' && p !== 'EN_ROUTE' && <Card className="p-3 text-sm text-muted">Navigation actions are available between accepting a job and arriving on site.</Card>}
      </div>
    </div>
  )
}
