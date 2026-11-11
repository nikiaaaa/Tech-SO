import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { PRIORITIES, PRIORITY_LABEL, fmtDateTime } from '../../lib/format'
import type { Device, Job, Paged, Priority } from '../../lib/types'
import { Button, Field, Modal, Select, Textarea, useAction } from '../../components/ui'
import { useAsync } from '../../lib/hooks'

interface Category { id: string; name: string; device_type: string; default_priority: Priority }
interface Preview { policy: { id: string; name: string; total_min: number; response_min: number } | null; due_at?: string; message?: string }

export interface JobForm { device_id: string; category_id: string; priority: Priority | ''; description: string }

/** Client-side checks that mirror the API rules, so the user sees problems before submitting. */
export function validateJobForm(f: JobForm): Partial<Record<keyof JobForm, string>> {
  const e: Partial<Record<keyof JobForm, string>> = {}
  if (!f.device_id) e.device_id = 'Select an ATM or CRM'
  if (!f.priority) e.priority = 'Select a priority'
  if (f.description.trim().length < 5) e.description = 'Describe the problem (at least 5 characters)'
  if (f.description.length > 2000) e.description = 'Description is too long (max 2000)'
  return e
}

/** D03a — create a job; "Create & Assign" opens the assignment panel for the new job. */
export default function CreateJobModal({ open, onClose, onCreated, presetDeviceId }: {
  open: boolean; onClose: () => void; presetDeviceId?: string
  onCreated: (job: Job, assignNext: boolean) => void
}) {
  const run = useAction()
  const devices = useAsync(() => (open ? api.get<Paged<Device>>('/devices', { page_size: 200 }) : Promise.resolve(null)), [open])
  const cats = useAsync(() => (open ? api.get<Category[]>('/incident-categories') : Promise.resolve([] as Category[])), [open])
  const [f, setF] = useState<JobForm>({ device_id: '', category_id: '', priority: '', description: '' })
  const [errors, setErrors] = useState<Partial<Record<keyof JobForm, string>>>({})
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)

  useEffect(() => { if (open) { setF({ device_id: presetDeviceId ?? '', category_id: '', priority: '', description: '' }); setErrors({}); setPreview(null) } }, [open, presetDeviceId])

  const device = devices.data?.items.find((d) => d.id === f.device_id)
  const categories = useMemo(() => (cats.data ?? []).filter((c) => !device || c.device_type === 'ANY' || c.device_type === device.device_type), [cats.data, device])

  useEffect(() => {
    if (!open || !f.device_id || !f.priority) { setPreview(null); return }
    let live = true
    api.post<Preview>('/sla/preview', { device_id: f.device_id, category_id: f.category_id || null, priority: f.priority })
      .then((p) => live && setPreview(p)).catch(() => live && setPreview(null))
    return () => { live = false }
  }, [open, f.device_id, f.category_id, f.priority])

  const submit = async (assignNext: boolean) => {
    const e = validateJobForm(f)
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    let created: Job | null = null
    const ok = await run(async () => {
      created = await api.post<Job>('/jobs', { device_id: f.device_id, category_id: f.category_id || null, priority: f.priority, description: f.description.trim() })
    }, 'Job created')
    setBusy(false)
    if (ok && created) { onCreated(created, assignNext); onClose() }
  }

  return (
    <Modal open={open} title="Create new job" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => submit(false)}>Create</Button><Button variant="primary" loading={busy} onClick={() => submit(true)}>Create &amp; Assign</Button></>}>
      <div className="space-y-3">
        <Field label="ATM / CRM *" error={errors.device_id}>
          <Select value={f.device_id} onChange={(e) => setF({ ...f, device_id: e.target.value, category_id: '' })} disabled={!!presetDeviceId}>
            <option value="">{devices.loading ? 'Loading devices…' : 'Select device'}</option>
            {devices.data?.items.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.bank ?? ''} ({d.device_type})</option>)}
          </Select>
        </Field>
        <Field label="Incident category">
          <Select value={f.category_id} onChange={(e) => { const c = categories.find((x) => x.id === e.target.value); setF({ ...f, category_id: e.target.value, priority: f.priority || c?.default_priority || '' }) }}>
            <option value="">Uncategorized</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Priority *" error={errors.priority}>
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
            <option value="">Select priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </Select>
        </Field>
        <Field label="Description *" error={errors.description}>
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Describe the fault, what the customer sees, error codes…" />
        </Field>
        {f.device_id && f.priority && (
          <div className="rounded border border-line bg-canvas p-3 text-xs" aria-live="polite">
            {preview?.policy
              ? <>SLA policy <strong>{preview.policy.name}</strong>: total resolution within {preview.policy.total_min} min, due {fmtDateTime(preview.due_at)} if created now.</>
              : <>No SLA policy is configured for this combination — the job will be tracked without an SLA target.</>}
          </div>
        )}
      </div>
    </Modal>
  )
}
