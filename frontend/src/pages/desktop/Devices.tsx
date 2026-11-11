import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync, useDebounced } from '../../lib/hooks'
import type { Device, Job, Paged } from '../../lib/types'
import MapView from '../../components/MapView'
import { Async, Badge, Button, Card, CardHeader, DataTable, Field, Input, Modal, PageHeader, Pagination, PriorityBadge, Select, StatusBadge, useAction, type Column } from '../../components/ui'
import CreateJobModal from './CreateJobModal'
import { DEVICE_WRITE_ROLES, DISPATCH_ROLES, Dl, SlaCell, has } from './common'

const PAGE = 25
const DEV_TONE: Record<string, 'ok' | 'warn' | 'crit' | 'neutral'> = { online: 'ok', degraded: 'warn', offline: 'crit', maintenance: 'neutral' }
interface Bank { id: string; name: string; code: string }
interface Branch { id: string; bank_id: string; name: string; city: string | null }

export function DeviceForm({ open, device, onClose, onSaved }: { open: boolean; device?: Device; onClose: () => void; onSaved: () => void }) {
  const run = useAction()
  const banks = useAsync(() => (open ? api.get<Bank[]>('/banks') : Promise.resolve([] as Bank[])), [open])
  const branches = useAsync(() => (open ? api.get<Branch[]>('/branches') : Promise.resolve([] as Branch[])), [open])
  const [f, setF] = useState({ code: '', device_type: 'ATM', bank_id: '', branch_id: '', model: '', address: '', lat: '', lon: '', status: 'online' })
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setErr(null)
    setF(device ? { code: device.code, device_type: device.device_type, bank_id: device.bank_id, branch_id: device.branch_id ?? '', model: device.model ?? '', address: device.address ?? '', lat: device.lat?.toString() ?? '', lon: device.lon?.toString() ?? '', status: device.status }
      : { code: '', device_type: 'ATM', bank_id: '', branch_id: '', model: '', address: '', lat: '', lon: '', status: 'online' })
  }, [open, device])

  const save = async () => {
    const lat = f.lat === '' ? null : Number(f.lat), lon = f.lon === '' ? null : Number(f.lon)
    if (!device && (f.code.trim().length < 2 || !f.bank_id)) { setErr('Code (min 2 characters) and bank are required'); return }
    if ((lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) || (lon !== null && (Number.isNaN(lon) || lon < -180 || lon > 180))) { setErr('Latitude must be -90..90 and longitude -180..180'); return }
    const body = { model: f.model || null, address: f.address || null, lat, lon, status: f.status, branch_id: f.branch_id || null }
    const ok = await run(() => device ? api.patch(`/devices/${device.id}`, body) : api.post('/devices', { ...body, code: f.code.trim(), device_type: f.device_type, bank_id: f.bank_id }), device ? 'Device updated' : 'Device added')
    if (ok) { onSaved(); onClose() }
  }
  return (
    <Modal open={open} title={device ? `Edit ${device.code}` : 'Add ATM / CRM'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code *"><Input value={f.code} disabled={!!device} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Type"><Select value={f.device_type} disabled={!!device} onChange={(e) => setF({ ...f, device_type: e.target.value })}><option>ATM</option><option>CRM</option></Select></Field>
        <Field label="Bank *"><Select value={f.bank_id} disabled={!!device} onChange={(e) => setF({ ...f, bank_id: e.target.value })}><option value="">Select bank</option>{banks.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Branch"><Select value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })}><option value="">None</option>{branches.data?.filter((b) => !f.bank_id || b.bank_id === f.bank_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Model"><Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['online', 'degraded', 'offline', 'maintenance'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <div className="col-span-2"><Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field></div>
        <Field label="Latitude"><Input inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></Field>
        <Field label="Longitude" error={err}><Input inputMode="decimal" value={f.lon} onChange={(e) => setF({ ...f, lon: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

/** D06 — device registry. */
export function Devices() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [type, setType] = useState('')
  const [bank, setBank] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const banks = useAsync(() => api.get<Bank[]>('/banks'), [])
  const a = useAsync(() => api.get<Paged<Device>>('/devices', { q: dq || undefined, device_type: type || undefined, bank_id: bank || undefined, status: status || undefined, page, page_size: PAGE }), [dq, type, bank, status, page])
  const cols: Column<Device>[] = [
    { key: 'code', header: 'Device', render: (d) => <span className="font-medium text-primary-700">{d.code}</span> },
    { key: 'type', header: 'Type', render: (d) => d.device_type },
    { key: 'bank', header: 'Bank', render: (d) => d.bank ?? '—' },
    { key: 'addr', header: 'Address', className: 'max-w-xs', render: (d) => <div className="truncate">{d.address ?? '—'}</div> },
    { key: 'status', header: 'Status', render: (d) => <Badge tone={DEV_TONE[d.status] ?? 'neutral'}>{d.status}</Badge> },
    { key: 'open', header: 'Open jobs', render: (d) => d.open_jobs },
  ]
  return (
    <>
      <PageHeader title="ATM & CRM Devices" subtitle="Device registry" actions={has(user?.role, DEVICE_WRITE_ROLES) ? <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} /> Add device</Button> : undefined} />
      <Card>
        <div className="p-3 grid gap-2 sm:grid-cols-4 border-b border-line">
          <Input aria-label="Search devices" placeholder="Search code or address…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
          <Select aria-label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}><option value="">ATM and CRM</option><option>ATM</option><option>CRM</option></Select>
          <Select aria-label="Bank" value={bank} onChange={(e) => { setBank(e.target.value); setPage(1) }}><option value="">All banks</option>{banks.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{['online', 'degraded', 'offline', 'maintenance'].map((s) => <option key={s}>{s}</option>)}</Select>
        </div>
        <Async a={a} empty={(d) => d.items.length === 0} emptyTitle="No devices" emptyHint="Add a device, or import a CSV under Settings → Devices.">
          {(d) => <><DataTable columns={cols} rows={d.items} rowKey={(x) => x.id} onRowClick={(x) => nav(`/devices/${x.id}`)} /><Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} /></>}
        </Async>
      </Card>
      <DeviceForm open={adding} onClose={() => setAdding(false)} onSaved={() => void a.reload()} />
    </>
  )
}

/** D06a — device detail with incident history and a quick "create job". */
export function DeviceDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const a = useAsync(() => api.get<Device>(`/devices/${id}`), [id])
  const jobs = useAsync(() => api.get<Paged<Job>>(`/devices/${id}/jobs`), [id])
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  return (
    <>
      <button onClick={() => nav(-1)} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Back</button>
      <Async a={a}>
        {(d) => (
          <div className="space-y-4">
            <PageHeader title={d.code} subtitle={`${d.device_type} · ${d.bank ?? ''}`}
              actions={<>{has(user?.role, DEVICE_WRITE_ROLES) && <Button onClick={() => setEditing(true)}>Edit</Button>}{has(user?.role, DISPATCH_ROLES) && <Button variant="primary" onClick={() => setCreating(true)}>Create job</Button>}</>} />
            <div className="grid lg:grid-cols-2 gap-4">
              <Card><CardHeader title="Details" /><div className="px-4 pb-4"><Dl items={[['Status', <Badge key="s" tone={DEV_TONE[d.status] ?? 'neutral'}>{d.status}</Badge>], ['Model', d.model], ['Address', d.address], ['Coordinates', d.lat != null ? `${d.lat}, ${d.lon}` : 'Not set'], ['Open jobs', d.open_jobs]]} /></div></Card>
              <Card className="overflow-hidden">{d.lat != null && d.lon != null ? <MapView height={220} zoom={15} center={[d.lat, d.lon]} fit={false} markers={[{ id: d.id, kind: 'device', lat: d.lat, lon: d.lon, label: d.code, popup: d.code }]} /> : <div className="p-6 text-sm text-muted">No coordinates recorded for this device.</div>}</Card>
            </div>
            <Card><CardHeader title="Incident history" />
              <Async a={jobs} empty={(x) => x.items.length === 0} emptyTitle="No incidents for this device">
                {(x) => <DataTable rows={x.items} rowKey={(j) => j.id} columns={[
                  { key: 'c', header: 'Job', render: (j: Job) => <Link className="text-primary-700 font-medium hover:underline" to={`/jobs/${j.id}`}>{j.code}</Link> },
                  { key: 'p', header: 'Priority', render: (j: Job) => <PriorityBadge priority={j.priority} /> }, { key: 's', header: 'Status', render: (j: Job) => <StatusBadge status={j.status} /> },
                  { key: 'd', header: 'Issue', render: (j: Job) => j.description }, { key: 'l', header: 'SLA', render: (j: Job) => <SlaCell sla={j.sla} /> }]} />}
              </Async></Card>
            <DeviceForm open={editing} device={d} onClose={() => setEditing(false)} onSaved={() => void a.reload()} />
            <CreateJobModal open={creating} presetDeviceId={d.id} onClose={() => setCreating(false)} onCreated={(j) => nav(`/jobs/${j.id}`)} />
          </div>
        )}
      </Async>
    </>
  )
}
