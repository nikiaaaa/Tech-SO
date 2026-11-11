import { useState } from 'react'
import { Download } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, download } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import type { ReportTable } from '../../lib/types'
import { Async, Button, Card, CardHeader, Input, PageHeader, Tabs, useAction } from '../../components/ui'

type Kind = 'sla' | 'jobs' | 'performance' | 'incidents'
const TITLES: Record<Kind, string> = { sla: 'SLA Report', jobs: 'Job Report', performance: 'Performance', incidents: 'Incident' }
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Chart data per report type, taken straight from the report rows. */
export function chartFor(kind: Kind, r: ReportTable): { name: string; value: number }[] {
  if (kind === 'sla') return r.rows.map((x) => ({ name: String(x[0]), value: Number(x[4] ?? 0) }))
  if (kind === 'performance') return r.rows.map((x) => ({ name: String(x[1]), value: Number(x[2] ?? 0) }))
  if (kind === 'incidents') return r.rows.filter((x) => x[0] === 'Device').slice(0, 10).map((x) => ({ name: String(x[1]), value: Number(x[2]) }))
  const counts: Record<string, number> = {}
  r.rows.forEach((x) => { const p = String(x[3]); counts[p] = (counts[p] ?? 0) + 1 })
  return Object.entries(counts).map(([name, value]) => ({ name, value }))
}
const CHART_TITLE: Record<Kind, string> = { sla: 'SLA compliance % by priority', jobs: 'Jobs by priority', performance: 'Score by technician', incidents: 'Incidents by device (top 10)' }

/** D09 — reports & analytics, computed from stored jobs. */
export default function Reports() {
  const run = useAction()
  const [kind, setKind] = useState<Kind>('sla')
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 864e5)))
  const [to, setTo] = useState(iso(new Date()))
  const a = useAsync(() => api.get<ReportTable>(`/reports/${kind}`, { date_from: `${from}T00:00:00`, date_to: `${to}T23:59:59` }), [kind, from, to])
  const exportCsv = () => run(async () => download(`techso-${kind}-report.csv`, await api.text(`/reports/${kind}/export`, { date_from: `${from}T00:00:00`, date_to: `${to}T23:59:59` })), 'CSV downloaded')
  return (
    <>
      <PageHeader title="Reports & Analytics" subtitle="Computed from your stored jobs" actions={<>
        <Input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-auto" />
        <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-auto" />
        <Button variant="primary" onClick={exportCsv}><Download size={15} /> Export</Button></>} />
      <Tabs<Kind> value={kind} onChange={setKind} tabs={(Object.keys(TITLES) as Kind[]).map((k) => ({ id: k, label: TITLES[k] }))} />
      <div className="mt-4 space-y-4">
        <Async a={a} empty={(r) => r.rows.length === 0} emptyTitle="No data in this period" emptyHint="Change the date range.">
          {(r) => {
            const data = chartFor(kind, r)
            return (<>
              <div className="grid lg:grid-cols-3 gap-4">
                <Card className="lg:col-span-2"><CardHeader title={CHART_TITLE[kind]} />
                  <div className="h-60 px-2 pb-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Bar dataKey="value" fill="#2563EB" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
                <Card><CardHeader title="Summary" /><dl className="px-4 pb-4 text-sm space-y-1.5">{Object.entries(r.summary).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted capitalize">{k.replace(/_/g, ' ')}</dt><dd className="text-right tabular-nums">{v === null ? '—' : String(v)}</dd></div>)}</dl></Card>
              </div>
              <Card className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{r.columns.map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
                <tbody>{r.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="td">{c === null || c === '' ? '—' : String(c)}</td>)}</tr>)}</tbody></table></Card>
            </>)
          }}
        </Async>
      </div>
    </>
  )
}
