import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { api, download } from '../../lib/api'
import { useAsync, useDebounced } from '../../lib/hooks'
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, fmtDateTime } from '../../lib/format'
import type { Job, JobStatus, Paged, Technician } from '../../lib/types'
import { Async, Button, Card, DataTable, Input, PageHeader, Pagination, PriorityBadge, Select, StatusBadge, useAction, type Column } from '../../components/ui'
import { SlaCell } from './common'

const PAGE = 25

/** D04 — Job History: search, filter, sort, paginate, export. */
export default function History() {
  const nav = useNavigate()
  const run = useAction()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const dq = useDebounced(q)
  const status = sp.get('status') ?? ''
  const priority = sp.get('priority') ?? ''
  const assignee = sp.get('assignee') ?? ''
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState('-created_at')

  const techs = useAsync(() => api.get<Technician[]>('/technicians'), [])
  const a = useAsync(() => api.get<Paged<Job>>('/jobs', {
    q: dq || undefined, status: status || undefined, priority: priority || undefined, assignee: assignee || undefined,
    date_from: from ? `${from}T00:00:00` : undefined, date_to: to ? `${to}T23:59:59` : undefined, sort, page, page_size: PAGE,
  }), [dq, status, priority, assignee, from, to, sort, page])

  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); setPage(1) }
  const cols: Column<Job>[] = [
    { key: 'code', header: 'Job', sortKey: 'created_at', render: (j) => <span className="font-medium text-primary-700">{j.code}</span> },
    { key: 'device', header: 'ATM / CRM', render: (j) => `${j.device?.code ?? '—'}` },
    { key: 'priority', header: 'Priority', sortKey: 'priority', render: (j) => <PriorityBadge priority={j.priority} /> },
    { key: 'status', header: 'Status', sortKey: 'status', render: (j) => <StatusBadge status={j.status} /> },
    { key: 'assignee', header: 'Technician', render: (j) => j.assignee?.full_name ?? '—' },
    { key: 'created', header: 'Created', render: (j) => fmtDateTime(j.created_at) },
    { key: 'closed', header: 'Closed', render: (j) => fmtDateTime(j.closed_at) },
    { key: 'sla', header: 'SLA', render: (j) => <SlaCell sla={j.sla} /> },
  ]
  const exportCsv = () => run(async () => {
    const text = await api.text('/reports/jobs/export', { date_from: from ? `${from}T00:00:00` : undefined, date_to: to ? `${to}T23:59:59` : undefined })
    download('techso-jobs.csv', text)
  }, 'CSV downloaded')

  return (
    <>
      <PageHeader title="Job History" subtitle="Search and review every job" actions={<Button onClick={exportCsv}><Download size={15} /> Export CSV</Button>} />
      <Card>
        <div className="p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6 border-b border-line">
          <Input aria-label="Search" placeholder="Search job or device…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} className="lg:col-span-2" />
          <Select aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All statuses</option>{(Object.keys(STATUS_LABEL) as JobStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            {status.includes(',') && <option value={status}>{status.split(',').map((s) => STATUS_LABEL[s as JobStatus] ?? s).join(' + ')}</option>}
          </Select>
          <Select aria-label="Priority" value={priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </Select>
          <Select aria-label="Technician" value={assignee} onChange={(e) => set('assignee', e.target.value)}>
            <option value="">All technicians</option>{techs.data?.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </Select>
          <div className="flex items-center gap-1.5"><Input aria-label="From date" type="date" value={from} onChange={(e) => set('from', e.target.value)} /><Input aria-label="To date" type="date" value={to} onChange={(e) => set('to', e.target.value)} /></div>
        </div>
        <Async a={a} empty={(d) => d.items.length === 0} emptyTitle="No jobs found" emptyHint="Change or clear the filters.">
          {(d) => (<>
            <DataTable columns={cols} rows={d.items} rowKey={(j) => j.id} onRowClick={(j) => nav(`/jobs/${j.id}`)} sort={sort}
              onSort={(k) => setSort(k === 'priority' ? 'priority' : k === 'status' ? 'status' : sort === 'created_at' ? '-created_at' : 'created_at')} />
            <Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} />
          </>)}
        </Async>
      </Card>
      <p className="text-xs text-muted mt-2">CSV export covers the selected date range (all jobs in that range).</p>
    </>
  )
}
