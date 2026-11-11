import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { PRIORITIES, PRIORITY_LABEL } from '../../lib/format'
import type { Priority, Technician } from '../../lib/types'
import { Async, Badge, Button, Card, CardHeader, DataTable, Field, Input, Modal, PriorityBadge, Select, Textarea, useAction } from '../../components/ui'

export const ReadOnlyNote = () => <p className="text-xs rounded border border-line bg-canvas px-3 py-2 mb-3 text-muted" role="note">Your role can view this setting but not change it.</p>

interface Bank { id: string; name: string; code: string }
interface Branch { id: string; bank_id: string; name: string; city: string | null; address: string | null }
interface Category { id: string; name: string; device_type: string; default_priority: Priority; checklist: string[] }
interface Policy {
  id: string; name: string; bank_id: string | null; device_type: string | null; category_id: string | null; priority: Priority
  response_min: number; dispatch_min: number; mobilization_min: number; travel_min: number; repair_min: number; verification_min: number; total_min: number; warning_pct: number; active: boolean
}
const MINUTE_FIELDS = ['response_min', 'dispatch_min', 'mobilization_min', 'travel_min', 'repair_min', 'verification_min', 'total_min'] as const
const FIELD_LABEL: Record<string, string> = { response_min: 'Response', dispatch_min: 'Dispatch', mobilization_min: 'Mobilization', travel_min: 'Travel', repair_min: 'Repair', verification_min: 'Verification', total_min: 'Total resolution' }

/** Validates a policy form the same way the API does. Returns an error message or null. */
export function validatePolicy(f: { name: string; warning_pct: number } & Record<(typeof MINUTE_FIELDS)[number], number>): string | null {
  if (f.name.trim().length < 2) return 'Name is required'
  for (const k of MINUTE_FIELDS) if (!Number.isInteger(f[k]) || f[k] < 1) return `${FIELD_LABEL[k]} must be a whole number of minutes (1 or more)`
  if (!Number.isInteger(f.warning_pct) || f.warning_pct < 1 || f.warning_pct > 99) return 'Warning threshold must be between 1 and 99 %'
  return null
}

// ------------------------------------------------------------------ D10a
export function SlaPolicyTab({ canEdit }: { canEdit: boolean }) {
  const run = useAction()
  const a = useAsync(() => api.get<Policy[]>('/sla-policies'), [])
  const banks = useAsync(() => api.get<Bank[]>('/banks'), [])
  const cats = useAsync(() => api.get<Category[]>('/incident-categories'), [])
  const blank = { name: '', priority: 'medium' as Priority, bank_id: '', device_type: '', category_id: '', response_min: 30, dispatch_min: 30, mobilization_min: 30, travel_min: 60, repair_min: 120, verification_min: 60, total_min: 240, warning_pct: 80, active: true }
  const [edit, setEdit] = useState<(typeof blank & { id?: string }) | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    if (!edit) return
    const e = validatePolicy(edit)
    if (e) { setErr(e); return }
    const body = { name: edit.name.trim(), priority: edit.priority, bank_id: edit.bank_id || null, device_type: edit.device_type || null, category_id: edit.category_id || null, ...Object.fromEntries(MINUTE_FIELDS.map((k) => [k, edit[k]])), warning_pct: edit.warning_pct, active: edit.active }
    const ok = await run(() => (edit.id ? api.put(`/sla-policies/${edit.id}`, body) : api.post('/sla-policies', body)), 'SLA policy saved')
    if (ok) { setEdit(null); void a.reload() }
  }
  const num = (k: (typeof MINUTE_FIELDS)[number] | 'warning_pct') => (
    <Field label={`${FIELD_LABEL[k] ?? 'Warning at (%)'}${k === 'warning_pct' ? '' : ' (min)'}`} key={k}><Input type="number" min={1} value={edit![k]} onChange={(e) => setEdit({ ...edit!, [k]: Number(e.target.value) })} /></Field>)

  return (
    <Card>
      <CardHeader title="SLA policies" subtitle="Targets are set by your organization. Nothing here is a built-in or contractual default."
        action={canEdit ? <Button variant="primary" size="sm" onClick={() => { setEdit(blank); setErr(null) }}><Plus size={14} /> New policy</Button> : undefined} />
      {!canEdit && <div className="px-4"><ReadOnlyNote /></div>}
      <Async a={a} empty={(d) => d.length === 0} emptyTitle="No SLA policies" emptyHint="Jobs without a matching policy are tracked without SLA targets.">
        {(rows) => <DataTable rows={rows} rowKey={(p) => p.id} onRowClick={canEdit ? (p) => { setEdit({ ...p, bank_id: p.bank_id ?? '', device_type: p.device_type ?? '', category_id: p.category_id ?? '' }); setErr(null) } : undefined} columns={[
          { key: 'n', header: 'Policy', render: (p: Policy) => <span className="font-medium">{p.name}</span> }, { key: 'p', header: 'Priority', render: (p: Policy) => <PriorityBadge priority={p.priority} /> },
          { key: 's', header: 'Applies to', render: (p: Policy) => [p.bank_id && banks.data?.find((b) => b.id === p.bank_id)?.name, p.device_type, p.category_id && cats.data?.find((c) => c.id === p.category_id)?.name].filter(Boolean).join(' · ') || 'Everything' },
          { key: 'r', header: 'Response', render: (p: Policy) => `${p.response_min} min` }, { key: 't', header: 'Total', render: (p: Policy) => `${p.total_min} min` },
          { key: 'w', header: 'Warning', render: (p: Policy) => `${p.warning_pct}%` }, { key: 'a', header: 'Active', render: (p: Policy) => <Badge tone={p.active ? 'ok' : 'neutral'}>{p.active ? 'Yes' : 'No'}</Badge> }]} />}
      </Async>
      <p className="px-4 py-3 text-xs text-muted border-t border-line">Durations are wall-clock minutes. Operating hours and holidays are not applied yet.</p>
      <Modal open={!!edit} wide title={edit?.id ? 'Edit SLA policy' : 'New SLA policy'} onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save policy</Button></>}>
        {edit && <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2"><Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field></div>
          <Field label="Priority"><Select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field>
          <Field label="Bank"><Select value={edit.bank_id} onChange={(e) => setEdit({ ...edit, bank_id: e.target.value })}><option value="">Any bank</option>{banks.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Field label="Device type"><Select value={edit.device_type} onChange={(e) => setEdit({ ...edit, device_type: e.target.value })}><option value="">ATM and CRM</option><option>ATM</option><option>CRM</option></Select></Field>
          <Field label="Incident category"><Select value={edit.category_id} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}><option value="">Any category</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          {MINUTE_FIELDS.map(num)}{num('warning_pct')}
          <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
          {err && <p className="sm:col-span-3 text-xs text-crit" role="alert">{err}</p>}
        </div>}
      </Modal>
    </Card>
  )
}

// ------------------------------------------------------------------ D10b
interface Rules { accept_timeout_min: number; repeat_interval_min: number; escalate_to_roles: string[]; high_priority_sound: boolean }
const ESC_ROLES = ['supervisor', 'scheduler', 'management', 'super_admin']

export function NotificationsTab({ canEdit }: { canEdit: boolean }) {
  const run = useAction()
  const a = useAsync(() => api.get<Rules>('/settings/notification_rules'), [])
  const [f, setF] = useState<Rules | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sweep, setSweep] = useState<string | null>(null)
  useEffect(() => { if (a.data) setF(a.data) }, [a.data])
  const save = async () => {
    if (!f) return
    if (f.accept_timeout_min < 1 || f.repeat_interval_min < 1) { setErr('Intervals must be at least 1 minute'); return }
    if (f.escalate_to_roles.length === 0) { setErr('Choose at least one role to escalate to'); return }
    setErr(null)
    await run(() => api.put('/settings/notification_rules', f), 'Notification rules saved')
  }
  return (
    <Card>
      <CardHeader title="Notifications & escalation" subtitle="In-app notifications and escalation to supervisors. Mobile push (FCM) is not implemented in this version." />
      <div className="px-4 pb-4 max-w-xl">
        {!canEdit && <ReadOnlyNote />}
        <Async a={a}>{() => f && (
          <div className="space-y-3">
            <Field label="Escalate when a technician has not responded after (minutes)"><Input type="number" min={1} disabled={!canEdit} value={f.accept_timeout_min} onChange={(e) => setF({ ...f, accept_timeout_min: Number(e.target.value) })} /></Field>
            <Field label="Remind the technician every (minutes)"><Input type="number" min={1} disabled={!canEdit} value={f.repeat_interval_min} onChange={(e) => setF({ ...f, repeat_interval_min: Number(e.target.value) })} /></Field>
            <fieldset><legend className="text-xs font-medium text-muted mb-1">Escalate to roles</legend>
              <div className="flex flex-wrap gap-3">{ESC_ROLES.map((r) => <label key={r} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={!canEdit} checked={f.escalate_to_roles.includes(r)} onChange={(e) => setF({ ...f, escalate_to_roles: e.target.checked ? [...f.escalate_to_roles, r] : f.escalate_to_roles.filter((x) => x !== r) })} />{r.replace('_', ' ')}</label>)}</div></fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={f.high_priority_sound} onChange={(e) => setF({ ...f, high_priority_sound: e.target.checked })} /> Play an alert sound for high-priority jobs in the technician app</label>
            {err && <p className="text-xs text-crit" role="alert">{err}</p>}
            {canEdit && <div className="flex items-center gap-2"><Button variant="primary" onClick={save}>Save</Button>
              <Button onClick={async () => { await run(async () => { const r = await api.post<{ escalated: number; reminded: number }>('/admin/escalation/run'); setSweep(`Escalated ${r.escalated}, reminders sent ${r.reminded}`) }) }}>Run escalation check now</Button></div>}
            {sweep && <p className="text-xs text-muted" role="status">{sweep}</p>}
          </div>)}</Async>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ D10c
interface TeamRow { id: string; name: string; supervisor_id: string | null; members: { id: string; full_name: string }[] }
export function TeamsTab({ canEdit }: { canEdit: boolean }) {
  const run = useAction()
  const a = useAsync(() => api.get<TeamRow[]>('/teams'), [])
  const techs = useAsync(() => api.get<Technician[]>('/technicians'), [])
  const sups = useAsync(() => (canEdit ? api.get<{ id: string; full_name: string }[]>('/users', { role: 'supervisor' }) : Promise.resolve([])), [canEdit])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [sup, setSup] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader title="Teams" action={canEdit ? <Button size="sm" variant="primary" onClick={() => { setOpen(true); setName(''); setSup(''); setErr(null) }}><Plus size={14} /> New team</Button> : undefined} />
      <div className="px-4 pb-4">
        {!canEdit && <ReadOnlyNote />}
        <Async a={a} empty={(d) => d.length === 0} emptyTitle="No teams yet">
          {(rows) => <div className="grid md:grid-cols-2 gap-3">{rows.map((t) => (
            <div key={t.id} className="border border-line rounded p-3">
              <div className="font-medium">{t.name}</div>
              <ul className="mt-2 space-y-1 text-sm">{t.members.length === 0 && <li className="text-muted">No members</li>}{t.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between">{m.full_name}{canEdit && <button className="text-xs text-crit hover:underline" onClick={async () => { await run(() => api.del(`/teams/${t.id}/members/${m.id}`), 'Member removed'); void a.reload() }}>Remove</button>}</li>))}</ul>
              {canEdit && <Select aria-label={`Add member to ${t.name}`} className="mt-2 !py-1 !text-xs" value="" onChange={async (e) => { if (e.target.value) { await run(() => api.post(`/teams/${t.id}/members`, { user_id: e.target.value }), 'Member added'); void a.reload() } }}>
                <option value="">Add technician…</option>{techs.data?.filter((x) => !t.members.some((m) => m.id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</Select>}
            </div>))}</div>}
        </Async>
      </div>
      <Modal open={open} title="New team" onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => {
        if (name.trim().length < 2) { setErr('Team name is required'); return }
        const ok = await run(() => api.post('/teams', { name: name.trim(), supervisor_id: sup || null }), 'Team created'); if (ok) { setOpen(false); void a.reload() } }}>Create</Button></>}>
        <div className="space-y-3"><Field label="Team name" error={err}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Supervisor"><Select value={sup} onChange={(e) => setSup(e.target.value)}><option value="">None</option>{sups.data?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field></div>
      </Modal>
    </Card>
  )
}

// ------------------------------------------------------------------ D10d
export function DevicesSettingsTab({ canAdmin, canImport }: { canAdmin: boolean; canImport: boolean }) {
  const run = useAction()
  const banks = useAsync(() => api.get<Bank[]>('/banks'), [])
  const branches = useAsync(() => api.get<Branch[]>('/branches'), [])
  const cats = useAsync(() => api.get<Category[]>('/incident-categories'), [])
  const [bank, setBank] = useState({ name: '', code: '' })
  const [branch, setBranch] = useState({ bank_id: '', name: '', city: '' })
  const [cat, setCat] = useState<{ id?: string; name: string; device_type: string; default_priority: Priority; checklist: string } | null>(null)
  const [csv, setCsv] = useState('code,device_type,bank_code,model,address,lat,lon\n')
  const [result, setResult] = useState<{ created: number; errors: { row: number; error: string }[] } | null>(null)

  return (
    <div className="space-y-4">
      {!canAdmin && <ReadOnlyNote />}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card><CardHeader title="Banks" />
          <Async a={banks} empty={(d) => d.length === 0} emptyTitle="No banks">{(rows) => <ul className="px-4 pb-2 text-sm divide-y divide-line">{rows.map((b) => <li key={b.id} className="py-1.5 flex justify-between"><span>{b.name}</span><Badge>{b.code}</Badge></li>)}</ul>}</Async>
          {canAdmin && <form className="px-4 pb-4 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (bank.name.trim().length < 2 || bank.code.trim().length < 2) return; const ok = await run(() => api.post('/banks', { name: bank.name.trim(), code: bank.code.trim().toUpperCase() }), 'Bank added'); if (ok) { setBank({ name: '', code: '' }); void banks.reload() } }}>
            <Input aria-label="Bank name" placeholder="Bank name" value={bank.name} onChange={(e) => setBank({ ...bank, name: e.target.value })} /><Input aria-label="Bank code" placeholder="Code" className="!w-28" value={bank.code} onChange={(e) => setBank({ ...bank, code: e.target.value })} /><Button type="submit">Add</Button></form>}
        </Card>
        <Card><CardHeader title="Branches" />
          <Async a={branches} empty={(d) => d.length === 0} emptyTitle="No branches">{(rows) => <ul className="px-4 pb-2 text-sm divide-y divide-line max-h-48 overflow-y-auto">{rows.map((b) => <li key={b.id} className="py-1.5 flex justify-between"><span>{b.name}</span><span className="text-muted">{b.city}</span></li>)}</ul>}</Async>
          {canAdmin && <form className="px-4 pb-4 grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={async (e) => { e.preventDefault(); if (!branch.bank_id || branch.name.trim().length < 2) return; const ok = await run(() => api.post('/branches', { bank_id: branch.bank_id, name: branch.name.trim(), city: branch.city || null }), 'Branch added'); if (ok) { setBranch({ ...branch, name: '', city: '' }); void branches.reload() } }}>
            <Select aria-label="Bank" value={branch.bank_id} onChange={(e) => setBranch({ ...branch, bank_id: e.target.value })}><option value="">Bank…</option>{banks.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            <Input aria-label="Branch name" placeholder="Branch name" value={branch.name} onChange={(e) => setBranch({ ...branch, name: e.target.value })} /><Button type="submit">Add</Button>
            <Input aria-label="City" placeholder="City" className="col-span-2" value={branch.city} onChange={(e) => setBranch({ ...branch, city: e.target.value })} /></form>}
        </Card>
      </div>
      <Card><CardHeader title="Incident categories & checklists" action={canAdmin ? <Button size="sm" onClick={() => setCat({ name: '', device_type: 'ANY', default_priority: 'medium', checklist: '' })}><Plus size={14} /> New category</Button> : undefined} />
        <Async a={cats} empty={(d) => d.length === 0} emptyTitle="No categories">{(rows) => <DataTable rows={rows} rowKey={(c) => c.id} onRowClick={canAdmin ? (c) => setCat({ id: c.id, name: c.name, device_type: c.device_type, default_priority: c.default_priority, checklist: c.checklist.join('\n') }) : undefined} columns={[
          { key: 'n', header: 'Category', render: (c: Category) => <span className="font-medium">{c.name}</span> }, { key: 't', header: 'Device type', render: (c: Category) => c.device_type },
          { key: 'p', header: 'Default priority', render: (c: Category) => <PriorityBadge priority={c.default_priority} /> }, { key: 'c', header: 'Checklist items', render: (c: Category) => c.checklist.length }]} />}</Async>
      </Card>
      {canImport && <Card><CardHeader title="Import devices (CSV)" subtitle="Columns: code, device_type (ATM/CRM), bank_code, model, address, lat, lon. Every row is validated; invalid rows are reported and skipped." />
        <div className="px-4 pb-4 space-y-2"><input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()) }} />
          <Textarea className="font-mono text-xs min-h-[140px]" value={csv} onChange={(e) => setCsv(e.target.value)} />
          <Button variant="primary" onClick={async () => { await run(async () => setResult(await api.post('/devices/import', { csv }))) }}>Import</Button>
          {result && <div className="text-sm" role="status">Imported {result.created} device(s). {result.errors.length > 0 && <ul className="mt-1 text-xs text-crit list-disc pl-5">{result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>}</div>}</div></Card>}
      <Modal open={!!cat} title={cat?.id ? 'Edit category' : 'New category'} onClose={() => setCat(null)} footer={<><Button onClick={() => setCat(null)}>Cancel</Button><Button variant="primary" onClick={async () => {
        if (!cat || cat.name.trim().length < 2) return
        const body = { name: cat.name.trim(), device_type: cat.device_type, default_priority: cat.default_priority, checklist: cat.checklist.split('\n').map((x) => x.trim()).filter(Boolean) }
        const ok = await run(() => (cat.id ? api.put(`/incident-categories/${cat.id}`, body) : api.post('/incident-categories', body)), 'Category saved'); if (ok) { setCat(null); void cats.reload() } }}>Save</Button></>}>
        {cat && <div className="space-y-3"><Field label="Name"><Input value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Device type"><Select value={cat.device_type} onChange={(e) => setCat({ ...cat, device_type: e.target.value })}><option>ANY</option><option>ATM</option><option>CRM</option></Select></Field>
            <Field label="Default priority"><Select value={cat.default_priority} onChange={(e) => setCat({ ...cat, default_priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></Field></div>
          <Field label="Checklist (one item per line)"><Textarea value={cat.checklist} onChange={(e) => setCat({ ...cat, checklist: e.target.value })} /></Field></div>}
      </Modal>
    </div>
  )
}
