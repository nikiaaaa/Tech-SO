import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  BarChart3, Bell, ChevronDown, Cpu, FileText, History, LayoutDashboard, LogOut, Radio, Search, Send, Settings, ShieldCheck, Users,
} from 'lucide-react'
import { api } from '../../lib/api'
import { isOneOf, useAuth } from '../../lib/auth'
import { useAsync, useNow } from '../../lib/hooks'
import { useRealtime, useRealtimeStatus } from '../../lib/realtime'
import { ROLE_LABEL, timeAgo } from '../../lib/format'
import type { NotificationOut, Role } from '../../lib/types'
import { Badge, DemoPill, Loading, cn } from '../ui'

const ALL_STAFF: Role[] = ['super_admin', 'management', 'supervisor', 'scheduler']
export const NAV: { to: string; label: string; icon: typeof Bell; roles: Role[]; end?: boolean }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, roles: ALL_STAFF, end: true },
  { to: '/live', label: 'Live Operations', icon: Radio, roles: ALL_STAFF },
  { to: '/dispatch', label: 'Job Dispatch', icon: Send, roles: ['super_admin', 'supervisor', 'scheduler', 'management'] },
  { to: '/history', label: 'Job History', icon: History, roles: ALL_STAFF },
  { to: '/technicians', label: 'Technicians', icon: Users, roles: ALL_STAFF },
  { to: '/devices', label: 'ATM & CRM Devices', icon: Cpu, roles: ALL_STAFF },
  { to: '/sla', label: 'SLA Monitoring', icon: ShieldCheck, roles: ALL_STAFF },
  { to: '/performance', label: 'Performance', icon: BarChart3, roles: ['super_admin', 'management', 'supervisor'] },
  { to: '/reports', label: 'Reports', icon: FileText, roles: ALL_STAFF },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ALL_STAFF },
]

function Sidebar() {
  const { user } = useAuth()
  const items = NAV.filter((n) => isOneOf(user, n.roles))
  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-surface border-r border-line">
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-line">
        <img src="/logo.png" alt="" className="w-10 h-10" />
        <div className="leading-tight">
          <div className="text-lg font-semibold text-primary-700">TechSO</div>
          <div className="text-[11px] text-muted">Technical Service Operations</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5" aria-label="Main">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cn('flex items-center gap-3 rounded px-3 py-2 text-sm', isActive ? 'bg-primary-50 text-primary-700 font-medium' : 'text-ink/80 hover:bg-canvas')}>
            <Icon size={18} aria-hidden /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-line p-3 text-xs text-muted">
        <div className="font-semibold text-ink">NEXUS OPS</div>
        <div>Integrated Operations Platform</div>
      </div>
    </aside>
  )
}

function Bell_() {
  const nav = useNavigate()
  const list = useAsync(() => api.get<{ unread: number; items: NotificationOut[] }>('/notifications'), [])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const now = useNow(60000)
  useRealtime((e) => { if (e.type === 'notification') void list.reload() })
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const unread = list.data?.unread ?? 0
  const go = async (n: NotificationOut) => {
    setOpen(false)
    if (!n.read) { await api.post(`/notifications/${n.id}/read`).catch(() => {}); void list.reload() }
    if (n.job_id) nav(`/jobs/${n.job_id}`)
  }
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
        className="relative grid place-items-center w-9 h-9 rounded hover:bg-canvas text-muted hover:text-ink">
        <Bell size={18} />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-crit text-white text-[11px] grid place-items-center">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[90vw] card shadow-pop z-40">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <span className="font-medium">Notifications</span>
            <button className="text-xs text-primary hover:underline" onClick={async () => { await api.post('/notifications/read-all'); void list.reload() }}>Mark all read</button>
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-line">
            {(list.data?.items ?? []).slice(0, 12).map((n) => (
              <li key={n.id}>
                <button onClick={() => go(n)} className={cn('w-full text-left px-3 py-2 hover:bg-canvas', !n.read && 'bg-primary-50/50')}>
                  <div className="flex items-center gap-2">
                    {n.priority === 'critical' && <Badge tone="crit">Critical</Badge>}
                    <span className="font-medium truncate">{n.title}</span>
                  </div>
                  {n.body && <div className="text-xs text-muted truncate">{n.body}</div>}
                  <div className="text-[11px] text-muted mt-0.5">{timeAgo(n.created_at, now)}</div>
                </button>
              </li>
            ))}
            {!list.loading && (list.data?.items.length ?? 0) === 0 && <li className="px-3 py-6 text-center text-muted text-sm">No notifications</li>}
          </ul>
          <button className="w-full text-center text-xs text-primary py-2 border-t border-line hover:bg-canvas" onClick={() => { setOpen(false); nav('/notifications') }}>View all</button>
        </div>
      )}
    </div>
  )
}

function LiveStatus() {
  const s = useRealtimeStatus()
  const map = { connected: ['bg-ok', 'Live'], connecting: ['bg-warn', 'Connecting'], offline: ['bg-muted', 'Offline'] } as const
  const [dot, label] = map[s]
  return <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted" title="Realtime connection"><span className={cn('w-2 h-2 rounded-full', dot)} />{label}</span>
}

function Topbar() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const now = useNow(30000)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus() } }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [])
  const initials = (user?.full_name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  return (
    <header className="h-16 shrink-0 bg-surface border-b border-line flex items-center gap-3 px-4">
      <img src="/logo.png" alt="TechSO" className="w-8 h-8 md:hidden" />
      <form className="flex-1 max-w-xl relative" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/history?q=${encodeURIComponent(q.trim())}`) }} role="search">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job or device code…  (Ctrl + K)" aria-label="Search jobs"
          className="w-full rounded border border-line bg-canvas pl-9 pr-3 py-2 text-sm placeholder:text-muted/70 focus:bg-surface focus:border-primary" />
      </form>
      <div className="ml-auto flex items-center gap-3">
        {user?.company?.is_demo && <DemoPill />}
        <LiveStatus />
        <span className="hidden lg:block text-xs text-muted tabular-nums">{new Date(now).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        <Bell_ />
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded hover:bg-canvas pl-1 pr-2 py-1" aria-expanded={menu} aria-label="Account menu">
            <span className="grid place-items-center w-8 h-8 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">{initials}</span>
            <span className="hidden sm:block text-left leading-tight"><span className="block text-sm font-medium">{user?.full_name}</span><span className="block text-[11px] text-muted">{user ? ROLE_LABEL[user.role] : ''}</span></span>
            <ChevronDown size={14} className="text-muted" />
          </button>
          {menu && (
            <div className="absolute right-0 mt-2 w-56 card shadow-pop z-40 py-1" onMouseLeave={() => setMenu(false)}>
              <div className="px-3 py-2 text-xs text-muted border-b border-line">{user?.email}<br />{user?.company?.name}</div>
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-canvas" onClick={async () => { await logout(); nav('/login') }}><LogOut size={15} /> Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

/** Desktop frame: white sidebar + compact top bar. Pages render in the Outlet. */
export default function Shell() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-5" id="main"><Suspense fallback={<Loading />}><Outlet /></Suspense></main>
      </div>
    </div>
  )
}
