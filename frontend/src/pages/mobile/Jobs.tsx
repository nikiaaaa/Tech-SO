import { useState } from 'react'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import type { Job } from '../../lib/types'
import { Async, Card, Empty, Tabs } from '../../components/ui'
import { useMobile } from './MobileContext'
import { JobCard } from './parts'

/** Jobs tab: active jobs and finished history. */
export default function Jobs() {
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const m = useMobile()
  const history = useAsync(() => api.get<Job[]>('/me/jobs', { scope: 'history' }), [tab, m.jobsVersion])
  return (
    <div>
      <h1 className="text-xl mb-3">Jobs</h1>
      <Tabs tabs={[{ id: 'active', label: 'Active', count: m.jobs?.length }, { id: 'history', label: 'History' }]} value={tab} onChange={setTab} />
      <div className="mt-3 space-y-3">
        {tab === 'active' && (m.jobs?.length ? m.jobs.map((j) => <JobCard key={j.id} job={j} />) : <Card><Empty title="No active jobs" /></Card>)}
        {tab === 'history' && (
          <Async a={history} empty={(d) => d.length === 0} emptyTitle="No finished jobs yet" emptyHint="Jobs you complete or that were cancelled appear here.">
            {(d) => d.map((j) => <JobCard key={j.id} job={j} />)}
          </Async>
        )}
      </div>
    </div>
  )
}
