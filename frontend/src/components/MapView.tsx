import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface MapMarker {
  id: string
  lat: number
  lon: number
  /** visual kind: job pin, technician dot, device square */
  kind: 'job' | 'tech' | 'device' | 'me'
  color?: string
  label?: string
  /** plain text shown in the popup (never HTML) */
  popup?: string
  dim?: boolean
}

const COLOR = { crit: '#DC2626', warn: '#D97706', info: '#2563EB', ok: '#16A34A', muted: '#667085' }
export const MARKER_COLOR = COLOR

function icon(m: MapMarker, selected: boolean) {
  const c = m.color ?? COLOR.info
  const size = selected ? 34 : 28
  const opacity = m.dim ? 0.55 : 1
  const shape = m.kind === 'job'
    ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="${c}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>`
    : m.kind === 'device'
      ? `<svg width="${size - 8}" height="${size - 8}" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="${c}" stroke="#fff" stroke-width="2"/></svg>`
      : `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="${c}" stroke="#fff" stroke-width="2.5"/><circle cx="12" cy="9.5" r="2.4" fill="#fff"/><path d="M7.5 17c.8-2.2 2.6-3.2 4.5-3.2s3.7 1 4.5 3.2" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`
  return L.divIcon({ className: '', html: `<div style="opacity:${opacity};filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">${shape}</div>`, iconSize: [size, size], iconAnchor: [size / 2, m.kind === 'job' ? size : size / 2] })
}

/**
 * OpenStreetMap map (Leaflet). Free, no API key. Tiles come from tile.openstreetmap.org, which is fine for development and
 * light internal use; heavy production use needs your own tile server or a paid provider (see docs/ARCHITECTURE.md).
 * Tiles need a connection: offline, markers still show on a blank grey background.
 */
export default function MapView({ markers, selectedId, onSelect, height = 420, center = [-6.2088, 106.8456], zoom = 12, fit = true, className }: {
  markers: MapMarker[]; selectedId?: string | null; onSelect?: (id: string) => void
  height?: number | string; center?: [number, number]; zoom?: number; fit?: boolean; className?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { center, zoom, zoomControl: true, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => { ro.disconnect(); m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current, g = layer.current
    if (!m || !g) return
    g.clearLayers()
    markers.forEach((mk) => {
      const marker = L.marker([mk.lat, mk.lon], { icon: icon(mk, mk.id === selectedId), title: mk.label, keyboard: true, zIndexOffset: mk.id === selectedId ? 1000 : 0 })
      if (mk.popup) {
        const div = document.createElement('div')
        div.textContent = mk.popup // textContent: data from the API is never interpreted as HTML
        div.style.whiteSpace = 'pre-line'
        marker.bindPopup(div)
      }
      marker.on('click', () => onSelect?.(mk.id))
      marker.addTo(g)
    })
    if (fit && !fitted.current && markers.length) {
      m.fitBounds(L.latLngBounds(markers.map((x) => [x.lat, x.lon] as [number, number])).pad(0.2), { maxZoom: 15 })
      fitted.current = true
    }
  }, [markers, selectedId, onSelect, fit])

  useEffect(() => {
    const sel = markers.find((x) => x.id === selectedId)
    if (sel && map.current) map.current.panTo([sel.lat, sel.lon], { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  return <div ref={el} className={className} style={{ height, width: '100%' }} role="application" aria-label="Map (OpenStreetMap)" />
}
