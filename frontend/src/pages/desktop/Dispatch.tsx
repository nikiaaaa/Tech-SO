import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/hooks'
import { PRIORITIES, PRIORITY_LABEL } from '../../lib/format'
import type { Job, Paged } from '../../lib/types'
import { Async, Button, Card, DataTable, Pagination, PageHeader, PriorityBadge, StatusBadge, Tabs, cn, type Column } from '../../components/ui'
import AssignPanel, { type AssignTarget } from './AssignPanel'
import CreateJobModal from './CreateJobModal'
import { DISPATCH_ROLES, SlaCell, has, jobActions, useJobEvents } from './common'

const TABS = [
  { id: 'unassigned', label: 'Unassigned', statuses: 'CREATED,REJECTED' },
  { id: 'active', label: 'In progress', statuses: 'ASSIGNED,NOTIFIED,ACCEPTED,EN_ROUTE,ARRIVED,IN_PROGRESS,ON_HOLD,RESOLVED' },
  { id: 'verification', label: 'Awaiting verification', statuses: 'VERIFICATION' },
] as const
type TabId = (typeof TABS)[number]['id'] | 'filtered'
const PAGE = 25

/** D03 — dispatch queue. Tabs: unassigned / in progress / awaiting verification. The scheduler assigns; nobody self-claims. */
export default function Dispatch() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [sp, setSp] = useSearchParams()
  const statusParam = sp.get('status')
  const tab = (statusParam ? 'filtered' : (sp.get('tab') as TabId) || 'unassigned') as TabId
  const priority = sp.get('priority') ?? ''
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState('priority')
  const [creating, setCreating] = useState(false)
  const [assign, setAssign] = useState<AssignTarget | null>(null)
  const canDispatch = has(user?.role, DISPATCH_ROLES)

  const statuses = statusParam ?? TABS.find((t) => t.id === tab)?.statuses ?? TABS[0].statuses
  const a = useAsync(async () => {
    const [data, ...counts] = await Promise.all([
      api.get<Paged<Job>>('/jobs', { status: statuses, priority: priority || undefined, page, page_size: PAGE, sort }),
      ...TABS.map((t) => api.get<Paged<Job>>('/jobs', { status: t.statuses, priority: priority || undefined, page_size: 1 })),
    ])
    return { data, counts: Object.fromEntries(TABS.map((t, i) => [t.id, counts[i].total])) as Record<string, number> }
  }, [statuses, priority, page, sort])
  useJobEvents(() => void a.reload())

  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k === 'tab') n.delete('status'); setSp(n, { replace: true }); setPage(1) }
  const targetOf = (j: Job): AssignTarget => ({ id: j.id, code: j.code, status: j.status, assigneeName: j.assignee?.full_name })

  const cols: Column<Job>[] = [
    { key: 'code', header: 'Job', sortKey: 'created_at', render: (j) => <span className="font-medium text-primary-700">{j.code}</span> },
    { key: 'priority', header: 'Priority', sortKey: 'priority', render: (j) => <PriorityBadge priority={j.priority} /> },
    { key: 'device', header: 'ATM / CRM', render: (j) => <div><div className="font-medium">{j.device?.code}</div><div className="text-xs text-muted">{j.device?.bank}</div></div> },
    { key: 'description', header: 'Issue', className: 'max-w-xs', render: (j) => <div className="truncate" title={j.description}>{j.category?.name ?? j.description}</div> },
    { key: 'status', header: 'Status', render: (j) => <StatusBadge status={j.status} /> },
    { key: 'assignee', header: 'Technician', render: (j) => j.assignee?.full_name ?? <span className="text-muted">—</span> },
    { key: 'sla', header: 'SLA', render: (j) => <SlaCell sla={j.sla} /> },
    {
      key: 'act', header: '', render: (j) => {
        const acts = user ? jobActions(j.status, user.role) : []
        const label = acts.includes('assign') ? 'Assign' : acts.includes('reassign') ? 'Reassign' : null
        return label ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setAssign(targetOf(j)) }}>{label}</Button> : null
      },
    },
  ]

  return (
    <>
      <PageHeader title="Job Dispatch" subtitle="Scheduler-assigned dispatch. Technicians receive jobs only from the scheduler."
        actions={canDispatch ? <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Create job</Button> : undefined} />
      <Card>
        <div className="px-3 pt-1">
          <Tabs<TabId> value={tab}
            tabs={[...TABS.map((t) => ({ id: t.id as TabId, label: t.label, count: a.data?.counts[t.id] })), ...(statusParam ? [{ id: 'filtered' as TabId, label: `Status: ${statusParam.split(',').join(' / ')}` }] : [])]}
            onChange={(t) => setParam('tab', t)} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 border-b border-line" role="group" aria-label="Priority filter">
          {['', ...PRIORITIES].map((p) => (
            <button key={p || 'all'} onClick={() => setParam('priority', p)} aria-pressed={priority === p}
              className={cn('px-2.5 py-1 rounded text-xs border', priority === p ? 'bg-primary text-white border-primary' : 'border-line text-muted hover:bg-canvas')}>
              {p ? PRIORITY_LABEL[p as keyof typeof PRIORITY_LABEL] : 'All priorities'}
            </button>
          ))}
        </div>
        <Async a={a} empty={(d) => d.data.items.length === 0} emptyTitle="No jobs in this view" emptyHint={tab === 'unassigned' ? 'Every job has a technician. Nice.' : 'Try another tab or priority.'}>
          {({ data }) => (
            <>
              <DataTable columns={cols} rows={data.items} rowKey={(j) => j.id} onRowClick={(j) => nav(`/jobs/${j.id}`)} sort={sort}
                onSort={(k) => setSort(k === 'priority' ? 'priority' : sort === 'created_at' ? '-created_at' : 'created_at')} />
              <Pagination page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </>
          )}
        </Async>
      </Card>
      <CreateJobModal open={creating} onClose={() => setCreating(false)}
        onCreated={(job, next) => { void a.reload(); if (next) setAssign({ id: job.id, code: job.code, status: job.status }) }} />
      <AssignPanel open={!!assign} job={assign} onClose={() => setAssign(null)} onDone={() => void a.reload()} />
    </>
  )
}
