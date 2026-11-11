import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAsync, useNow } from '../../lib/hooks'
import { useRealtime } from '../../lib/realtime'
import { fmtDateTime, timeAgo } from '../../lib/format'
import type { NotificationOut } from '../../lib/types'
import { Async, Badge, Button, Card, PageHeader, cn, useAction } from '../../components/ui'

/** D12 — notification center (in-app notifications; escalations and SLA/appeal alerts). */
export default function Notifications() {
  const nav = useNavigate()
  const run = useAction()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const a = useAsync(() => api.get<{ unread: number; items: NotificationOut[] }>('/notifications', { unread_only: unreadOnly }), [unreadOnly])
  const now = useNow(60000)
  useRealtime((e) => { if (e.type === 'notification') void a.reload() })
  const open = async (n: NotificationOut) => {
    if (!n.read) await run(() => api.post(`/notifications/${n.id}/read`))
    void a.reload()
    if (n.job_id) nav(`/jobs/${n.job_id}`)
  }
  return (
    <>
      <PageHeader title="Notifications" subtitle={a.data ? `${a.data.unread} unread` : undefined}
        actions={<><Button onClick={() => setUnreadOnly(!unreadOnly)}>{unreadOnly ? 'Show all' : 'Unread only'}</Button>
          <Button onClick={async () => { await run(() => api.post('/notifications/read-all'), 'All marked as read'); void a.reload() }}>Mark all read</Button></>} />
      <Card>
        <Async a={a} empty={(d) => d.items.length === 0} emptyTitle="No notifications">
          {(d) => <ul className="divide-y divide-line">{d.items.map((n) => (
            <li key={n.id}><button onClick={() => open(n)} className={cn('w-full text-left px-4 py-3 hover:bg-canvas flex items-start gap-3', !n.read && 'bg-primary-50/50')}>
              <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', n.read ? 'bg-line' : 'bg-primary')} />
              <span className="flex-1 min-w-0"><span className="flex items-center gap-2"><span className="font-medium">{n.title}</span>{n.priority === 'critical' && <Badge tone="crit">Critical</Badge>}<Badge>{n.kind.replace(/_/g, ' ')}</Badge></span>
                {n.body && <span className="block text-sm text-muted">{n.body}</span>}</span>
              <span className="text-xs text-muted whitespace-nowrap" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at, now)}</span></button></li>))}</ul>}
        </Async>
      </Card>
    </>
  )
}
