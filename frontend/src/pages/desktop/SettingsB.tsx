import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { ROLE_LABEL, fmtDateTime } from '../../lib/format'
import type { Role } from '../../lib/types'
import { Async, Badge, Button, Card, CardHeader, DataTable, Field, Input, Modal, Pagination, Select, useAction } from '../../components/ui'
import { ReadOnlyNote } from './SettingsA'

// ------------------------------------------------------------------ D10e
interface General { timezone: string; language: 'en' | 'id'; display_name: string; require_after_photo?: boolean }
export function GeneralTab({ canEdit }: { canEdit: boolean }) {
  const run = useAction()
  const a = useAsync(() => api.get<General>('/settings/general'), [])
  const [f, setF] = useState<General | null>(null)
  useEffect(() => { if (a.data) setF({ ...a.data, require_after_photo: a.data.require_after_photo ?? true }) }, [a.data])
  return (
    <Card><CardHeader title="General" subtitle="Organization profile and field-work rules" />
      <div className="px-4 pb-4 max-w-xl">{!canEdit && <ReadOnlyNote />}
        <Async a={a}>{() => f && (
          <div className="space-y-3">
            <Field label="Display name"><Input disabled={!canEdit} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
            <Field label="Time zone (IANA name)"><Input disabled={!canEdit} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
            <Field label="Language"><Select disabled={!canEdit} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as 'en' | 'id' })}><option value="en">English</option><option value="id">Bahasa Indonesia</option></Select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={f.require_after_photo ?? true} onChange={(e) => setF({ ...f, require_after_photo: e.target.checked })} /> Require at least one “after” photo before a technician can resolve a job</label>
            {canEdit && <Button variant="primary" onClick={() => run(() => api.put('/settings/general', { ...f, require_after_photo: f.require_after_photo ?? true }), 'Settings saved')}>Save</Button>}
          </div>)}</Async></div></Card>
  )
}

// ------------------------------------------------------------------ D10f
interface UserRow { id: string; email: string; full_name: string; role: Role; phone: string | null; is_active: boolean; skills: string[] }
interface Branch { id: string; bank_id: string; name: string; city: string | null }
const ROLES: Role[] = ['super_admin', 'management', 'supervisor', 'scheduler', 'technician']

export function UsersTab({ canEdit }: { canEdit: boolean }) {
  const run = useAction()
  const a = useAsync(() => api.get<UserRow[]>('/users'), [])
  const banks = useAsync(() => api.get<{ id: string; name: string; code: string }[]>('/banks'), [])
  const branches = useAsync(() => api.get<Branch[]>('/branches'), [])
  const blank = { id: '', email: '', full_name: '', role: 'technician' as Role, phone: '', skills: '', password: '', is_active: true }
  const [f, setF] = useState<typeof blank | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    if (!f) return
    const skills = f.skills.split(',').map((s) => s.trim()).filter(Boolean)
    if (f.full_name.trim().length < 2) { setErr('Full name is required'); return }
    if (!f.id && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { setErr('Enter a valid email address'); return }
    if ((!f.id || f.password) && f.password.length < 10) { setErr('Password must be at least 10 characters'); return }
    const ok = await run(() => (f.id
      ? api.patch(`/users/${f.id}`, { full_name: f.full_name.trim(), role: f.role, is_active: f.is_active, phone: f.phone || null, skills, ...(f.password ? { password: f.password } : {}) })
      : api.post('/users', { email: f.email.trim(), full_name: f.full_name.trim(), role: f.role, password: f.password, phone: f.phone || null, skills })), 'User saved')
    if (ok) { setF(null); void a.reload() }
  }

  return (
    <div className="space-y-4">
      <Card><CardHeader title="Users & roles" subtitle="Roles decide what each person can see and do. The server enforces them."
        action={canEdit ? <Button size="sm" variant="primary" onClick={() => { setF(blank); setErr(null) }}><Plus size={14} /> New user</Button> : undefined} />
        {!canEdit && <div className="px-4"><ReadOnlyNote /></div>}
        <Async a={a} empty={(d) => d.length === 0} emptyTitle="No users">{(rows) => <DataTable rows={rows} rowKey={(u) => u.id} onRowClick={canEdit ? (u) => { setF({ id: u.id, email: u.email, full_name: u.full_name, role: u.role, phone: u.phone ?? '', skills: u.skills.join(', '), password: '', is_active: u.is_active }); setErr(null) } : undefined} columns={[
          { key: 'n', header: 'Name', render: (u: UserRow) => <span className="font-medium">{u.full_name}</span> }, { key: 'e', header: 'Email', render: (u: UserRow) => u.email },
          { key: 'r', header: 'Role', render: (u: UserRow) => <Badge tone="info">{ROLE_LABEL[u.role]}</Badge> }, { key: 'a', header: 'Active', render: (u: UserRow) => <Badge tone={u.is_active ? 'ok' : 'neutral'}>{u.is_active ? 'Active' : 'Deactivated'}</Badge> }]} />}</Async>
      </Card>
      <Card><CardHeader title="Organization" subtitle="Banks and their branches" />
        <Async a={banks} empty={(d) => d.length === 0} emptyTitle="No banks yet">{(bs) => <div className="px-4 pb-4 grid md:grid-cols-3 gap-3">{bs.map((b) => (
          <div key={b.id} className="border border-line rounded p-3"><div className="font-medium">{b.name} <span className="text-muted text-xs">({b.code})</span></div>
            <ul className="text-sm text-muted mt-1">{(branches.data ?? []).filter((x) => x.bank_id === b.id).map((x) => <li key={x.id}>{x.name}{x.city ? ` — ${x.city}` : ''}</li>)}</ul></div>))}</div>}</Async></Card>
      <Modal open={!!f} title={f?.id ? 'Edit user' : 'New user'} onClose={() => setF(null)} footer={<><Button onClick={() => setF(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
        {f && <div className="space-y-3">
          <Field label="Full name"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" disabled={!!f.id} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
            <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div>
          <Field label="Skills (comma separated, e.g. ATM, CRM)"><Input value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} /></Field>
          <Field label={f.id ? 'Reset password (leave empty to keep)' : 'Password (min 10 characters)'} error={err}><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          {f.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active (deactivated users are signed out immediately)</label>}
        </div>}
      </Modal>
    </div>
  )
}

// ------------------------------------------------------------------ D10h
interface Version { version: number; weights: Record<string, number>; params: Record<string, unknown>; note: string | null; effective_from: string }
const DIMS = ['response_time', 'mobilization', 'sla_achievement', 'documentation', 'resolution_quality'] as const
const PARAMS = [['overlap_allowance_pct', 'Allowance for overlapping assignments (%)'], ['assumed_speed_kmh', 'Assumed travel speed (km/h)'], ['complexity_min_per_checklist_item', 'Repair allowance per checklist item (min)'], ['correction_penalty', 'Quality penalty per correction request (points)']] as const

export const weightsTotal = (w: Record<string, number>) => Math.round(Object.values(w).reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100

export function ScoringTab({ canEdit }: { canEdit: boolean }) {
  const run = useAction()
  const a = useAsync(() => api.get<Version[]>('/scoring-versions'), [])
  const [w, setW] = useState<Record<string, number>>({})
  const [p, setP] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  useEffect(() => { const cur = a.data?.[0]; if (cur) { setW(cur.weights); setP(Object.fromEntries(PARAMS.map(([k]) => [k, Number(cur.params[k])]))) } }, [a.data])
  const total = weightsTotal(w)
  return (
    <div className="space-y-4">
      <Card><CardHeader title="Scoring weights" subtitle="Versioned. Publishing creates a new version; earlier scores keep the version they were computed with. Initial values are a proposal, not a rule." />
        <div className="px-4 pb-4 max-w-2xl">{!canEdit && <ReadOnlyNote />}
          <Async a={a}>{(vs) => (
            <div className="space-y-3">
              <div className="text-sm">Current version: <Badge tone="info">v{vs[0].version}</Badge></div>
              <div className="grid sm:grid-cols-2 gap-3">{DIMS.map((d) => <Field key={d} label={`${d.replace(/_/g, ' ')} (%)`}><Input type="number" min={0} disabled={!canEdit} value={w[d] ?? 0} onChange={(e) => setW({ ...w, [d]: Number(e.target.value) })} /></Field>)}</div>
              <div className={total === 100 ? 'text-sm text-ok' : 'text-sm text-crit'} role="status">Total: {total}% {total === 100 ? '' : '— must add up to 100'}</div>
              <h3 className="text-xs font-medium text-muted pt-1">Fairness adjustment parameters</h3>
              <div className="grid sm:grid-cols-2 gap-3">{PARAMS.map(([k, l]) => <Field key={k} label={l}><Input type="number" min={0} disabled={!canEdit} value={p[k] ?? 0} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} /></Field>)}</div>
              {canEdit && <><Field label="Reason for this version"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <Button variant="primary" disabled={total !== 100} onClick={async () => { const ok = await run(() => api.post('/scoring-versions', { weights: w, params: p, note: note || null }), 'New scoring version published'); if (ok) { setNote(''); void a.reload() } }}>Publish new version</Button></>}
            </div>)}</Async></div></Card>
      <Card><CardHeader title="Version history" />
        <Async a={a} empty={(d) => d.length === 0}>{(vs) => <DataTable rows={vs} rowKey={(v) => String(v.version)} columns={[
          { key: 'v', header: 'Version', render: (v: Version) => `v${v.version}` }, { key: 'd', header: 'Effective from', render: (v: Version) => fmtDateTime(v.effective_from) },
          { key: 'w', header: 'Weights', render: (v: Version) => DIMS.map((d) => `${v.weights[d]}`).join(' / ') }, { key: 'n', header: 'Note', render: (v: Version) => v.note ?? '—' }]} />}</Async></Card>
    </div>
  )
}

// ------------------------------------------------------------------ D10i
interface Gps { enabled: boolean; min_interval_s: number; max_accuracy_m: number; stale_after_s: number; retention_days: number }
export function GpsTab({ canEdit }: { canEdit: boolean }) {
  const run = useAction()
  const a = useAsync(() => api.get<Gps>('/settings/gps_policy'), [])
  const [f, setF] = useState<Gps | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (a.data) setF(a.data) }, [a.data])
  const n = (k: keyof Gps) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f!, [k]: Number(e.target.value) })
  const save = async () => {
    if (!f) return
    if (f.min_interval_s < 1 || f.max_accuracy_m < 5 || f.stale_after_s < 30 || f.retention_days < 1) { setErr('Intervals ≥ 1 s, accuracy ≥ 5 m, stale ≥ 30 s, retention ≥ 1 day'); return }
    setErr(null); await run(() => api.put('/settings/gps_policy', f), 'GPS policy saved')
  }
  return (
    <Card><CardHeader title="GPS & retention policy" subtitle="Location is collected only while a technician is on an active shift or holds an active assignment, and is visible only to dispatch and management roles." />
      <div className="px-4 pb-4 max-w-xl">{!canEdit && <ReadOnlyNote />}
        <Async a={a}>{() => f && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Location tracking enabled</label>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Minimum seconds between positions"><Input type="number" disabled={!canEdit} value={f.min_interval_s} onChange={n('min_interval_s')} /></Field>
              <Field label="Reject positions less accurate than (m)"><Input type="number" disabled={!canEdit} value={f.max_accuracy_m} onChange={n('max_accuracy_m')} /></Field>
              <Field label="Mark a position stale after (s)"><Input type="number" disabled={!canEdit} value={f.stale_after_s} onChange={n('stale_after_s')} /></Field>
              <Field label="Keep positions for (days)" error={err}><Input type="number" disabled={!canEdit} value={f.retention_days} onChange={n('retention_days')} /></Field></div>
            <p className="text-xs text-muted">Technicians see a visible notice whenever tracking is active. A position is a dispatch hint; it is not proof of misconduct and must not be used as the only evidence in a review.</p>
            {canEdit && <Button variant="primary" onClick={save}>Save policy</Button>}
          </div>)}</Async></div></Card>
  )
}

// ------------------------------------------------------------------ D10g
interface AuditItem { id: string; at: string; actor: string; action: string; entity: string | null; entity_id: string | null; before: unknown; after: unknown }
export function AuditTab() {
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const a = useAsync(() => api.get<{ total: number; items: AuditItem[] }>('/audit-logs', { action: action || undefined, entity: entity || undefined, date_from: from ? `${from}T00:00:00` : undefined, date_to: to ? `${to}T23:59:59` : undefined, page, page_size: 50 }), [action, entity, from, to, page])
  return (
    <Card><CardHeader title="Audit log" subtitle="Who did what and when. Passwords and tokens are never recorded." />
      <div className="px-4 pb-3 grid sm:grid-cols-4 gap-2">
        <Input aria-label="Action starts with" placeholder="Action, e.g. job. or user." value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} />
        <Input aria-label="Entity" placeholder="Entity, e.g. job" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1) }} />
        <Input aria-label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} /><Input aria-label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} /></div>
      <Async a={a} empty={(d) => d.items.length === 0} emptyTitle="No audit entries match">
        {(d) => <><DataTable rows={d.items} rowKey={(x) => x.id} onRowClick={(x) => setOpen(open === x.id ? null : x.id)} selectedKey={open} columns={[
          { key: 't', header: 'When', render: (x: AuditItem) => fmtDateTime(x.at) }, { key: 'a', header: 'Actor', render: (x: AuditItem) => x.actor }, { key: 'c', header: 'Action', render: (x: AuditItem) => <code className="text-xs">{x.action}</code> },
          { key: 'e', header: 'Entity', render: (x: AuditItem) => x.entity ?? '—' }]} />
          {open && (() => { const x = d.items.find((i) => i.id === open); return x ? <pre className="mx-4 my-3 text-xs bg-canvas rounded p-3 overflow-x-auto">{JSON.stringify({ before: x.before, after: x.after }, null, 2)}</pre> : null })()}
          <Pagination page={page} pageSize={50} total={d.total} onPage={setPage} /></>}
      </Async></Card>
  )
}
