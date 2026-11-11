import {
  createContext, useContext, useEffect, useRef, useState, useCallback,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react'
import type { Async as AsyncResult } from '../lib/hooks'
import { PRIORITY_LABEL, SLA_LABEL, STATUS_LABEL } from '../lib/format'
import type { JobStatus, Priority, SlaState } from '../lib/types'

export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

// ---------------------------------------------------------------- buttons & badges
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-700 disabled:bg-primary/50',
  secondary: 'bg-surface text-ink border border-line hover:bg-canvas disabled:text-muted',
  ghost: 'text-muted hover:text-ink hover:bg-canvas',
  danger: 'bg-crit text-white hover:bg-crit/90 disabled:bg-crit/50',
}

export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:cursor-not-allowed',
        size === 'sm' && 'px-2.5 py-1 text-xs', size === 'md' && 'px-3.5 py-2 text-sm', size === 'lg' && 'px-4 py-3 text-base min-h-[48px]',
        VARIANT[variant], className,
      )}
    >
      {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'crit'
const TONE: Record<Tone, string> = {
  neutral: 'bg-canvas text-muted border-line',
  info: 'bg-primary-50 text-primary-700 border-primary-100',
  ok: 'bg-ok-50 text-ok border-ok-100',
  warn: 'bg-warn-50 text-warn border-warn-100',
  crit: 'bg-crit-50 text-crit border-crit-100',
}
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', TONE[tone], className)}>{children}</span>
}

const PRIORITY_TONE: Record<Priority, Tone> = { critical: 'crit', high: 'warn', medium: 'info', low: 'neutral' }
export const PriorityBadge = ({ priority }: { priority: Priority }) => <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>

const STATUS_TONE: Record<JobStatus, Tone> = {
  CREATED: 'neutral', ASSIGNED: 'info', NOTIFIED: 'info', ACCEPTED: 'info', REJECTED: 'crit', EN_ROUTE: 'info', ARRIVED: 'info',
  IN_PROGRESS: 'info', ON_HOLD: 'warn', RESOLVED: 'warn', VERIFICATION: 'warn', CLOSED: 'ok', CANCELLED: 'neutral',
}
export const StatusBadge = ({ status }: { status: JobStatus }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>

const SLA_TONE: Record<SlaState, Tone> = { on_track: 'ok', warning: 'warn', breach: 'crit', no_policy: 'neutral', cancelled: 'neutral' }
export const SlaBadge = ({ state }: { state: SlaState }) => <Badge tone={SLA_TONE[state]}>{SLA_LABEL[state]}</Badge>

export const DemoPill = () => <Badge tone="warn" className="uppercase tracking-wide">Demo data</Badge>

// ---------------------------------------------------------------- layout blocks
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('card', className)}>{children}</section>
}

export function CardHeader({ title, action, subtitle }: { title: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
      <div>
        <h2 className="text-sm text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 className="text-xl text-ink">{title}</h1>
        {subtitle && <p className="text-muted text-sm mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function KpiCard({ icon, label, value, tone = 'info', hint, onClick }: {
  icon: ReactNode; label: string; value: ReactNode; tone?: Tone; hint?: string; onClick?: () => void
}) {
  const bar: Record<Tone, string> = { neutral: 'bg-muted/40', info: 'bg-primary', ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit' }
  const Wrap = onClick ? 'button' : 'div'
  return (
    <Wrap onClick={onClick} className={cn('card text-left relative overflow-hidden p-3.5', onClick && 'hover:border-primary/40 transition-colors')}>
      <div className="flex items-center gap-3">
        <span className={cn('grid place-items-center w-10 h-10 rounded-md', TONE[tone])}>{icon}</span>
        <div className="min-w-0">
          <div className="text-xs text-muted truncate">{label}</div>
          <div className="text-2xl font-semibold leading-tight tabular-nums">{value}</div>
        </div>
      </div>
      {hint && <div className="text-xs text-muted mt-1.5">{hint}</div>}
      <span className={cn('absolute left-0 right-0 bottom-0 h-0.5', bar[tone])} />
    </Wrap>
  )
}

export function ProgressBar({ value, tone = 'info' }: { value: number; tone?: Tone }) {
  const color: Record<Tone, string> = { neutral: 'bg-muted', info: 'bg-primary', ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit' }
  return (
    <div className="h-2 rounded-full bg-canvas border border-line overflow-hidden" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full', color[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Donut({ parts, center, size = 140 }: { parts: { value: number; color: string; label: string }[]; center?: ReactNode; size?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const r = 15.9155
  let offset = 25
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" width={size} height={size} role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(', ')}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="#E5E7EB" strokeWidth="4" />
        {total > 0 && parts.map((p) => {
          const len = (p.value / total) * 100
          const el = <circle key={p.label} cx="18" cy="18" r={r} fill="none" stroke={p.color} strokeWidth="4" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={offset} />
          offset -= len
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{center}</div>
    </div>
  )
}

// ---------------------------------------------------------------- async states
export const Loading = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-muted" role="status">
    <Loader2 className="animate-spin" size={18} aria-hidden /> {label}
  </div>
)

export const Empty = ({ title = 'Nothing here yet', hint }: { title?: string; hint?: string }) => (
  <div className="flex flex-col items-center gap-1 py-10 text-center text-muted">
    <Inbox size={26} aria-hidden />
    <div className="text-ink font-medium">{title}</div>
    {hint && <div className="text-xs max-w-xs">{hint}</div>}
  </div>
)

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="flex flex-col items-center gap-2 py-10 text-center" role="alert">
    <AlertTriangle className="text-crit" size={26} aria-hidden />
    <div className="text-ink font-medium">Could not load this</div>
    <div className="text-xs text-muted max-w-sm">{message}</div>
    {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
  </div>
)

/** Renders loading / error / empty / data consistently for any useAsync result. */
export function Async<T>({ a, empty, emptyTitle, emptyHint, children }: {
  a: AsyncResult<T>; empty?: (d: T) => boolean; emptyTitle?: string; emptyHint?: string; children: (d: T) => ReactNode
}) {
  if (a.data === null && a.loading) return <Loading />
  if (a.data === null && a.error) return <ErrorState message={a.error} onRetry={a.reload} />
  if (a.data === null) return null
  if (empty?.(a.data)) return <Empty title={emptyTitle} hint={emptyHint} />
  return <>{a.error && <div className="text-xs text-crit px-4 py-1" role="alert">Refresh failed: {a.error}</div>}{children(a.data)}</>
}

// ---------------------------------------------------------------- forms
const field = 'w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-primary disabled:bg-canvas disabled:text-muted'
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(field, className)} />
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(field, className)}>{children}</select>
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cn(field, 'min-h-[84px]', className)} />

export function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted mb-1">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted mt-1">{hint}</span>}
      {error && <span className="block text-xs text-crit mt-1" role="alert">{error}</span>}
    </label>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-line overflow-x-auto" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn('px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px', value === t.id ? 'border-primary text-primary font-medium' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs text-muted">({t.count})</span>}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- table
export interface Column<T> { key: string; header: ReactNode; render?: (row: T) => ReactNode; className?: string; sortKey?: string }

export function DataTable<T>({ columns, rows, rowKey, onRowClick, sort, onSort, selectedKey }: {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void
  sort?: string; onSort?: (key: string) => void; selectedKey?: string | null
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn('th', c.className)} aria-sort={c.sortKey && sort === c.sortKey ? 'ascending' : c.sortKey && sort === `-${c.sortKey}` ? 'descending' : undefined}>
                {c.sortKey && onSort ? <button onClick={() => onSort(c.sortKey!)} className="hover:text-ink">{c.header}{sort === c.sortKey ? ' ↑' : sort === `-${c.sortKey}` ? ' ↓' : ''}</button> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={() => onRowClick?.(r)}
              className={cn(onRowClick && 'cursor-pointer hover:bg-primary-50/50', selectedKey === rowKey(r) && 'bg-primary-50')}>
              {columns.map((c) => <td key={c.key} className={cn('td', c.className)}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
      <span>{from}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="px-2">Page {page} / {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- dialogs
export function Modal({ open, title, onClose, children, footer, wide }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cn('bg-surface rounded-lg shadow-pop w-full max-h-[90vh] flex flex-col', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <h2 className="text-base">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

/** Confirmation that requires a written reason (reject, hold, cancel, reassign, correction…). */
export function ReasonDialog({ open, title, label = 'Reason', confirmLabel = 'Confirm', minLength = 3, danger, onClose, onConfirm, extra }: {
  open: boolean; title: string; label?: string; confirmLabel?: string; minLength?: number; danger?: boolean
  onClose: () => void; onConfirm: (reason: string) => Promise<void>; extra?: ReactNode
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (open) { setReason(''); setErr(null) } }, [open])
  const submit = async () => {
    if (reason.trim().length < minLength) { setErr(`Please enter at least ${minLength} characters`); return }
    setBusy(true)
    try { await onConfirm(reason.trim()); onClose() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} title={title} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={submit}>{confirmLabel}</Button></>}>
      <div className="space-y-3">
        {extra}
        <Field label={label} error={err}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- toasts
type ToastKind = 'success' | 'error' | 'info'
interface ToastItem { id: number; kind: ToastKind; text: string }
const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, kind, text }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cn('rounded-md border px-3 py-2 shadow-pop text-sm bg-surface', t.kind === 'error' ? 'border-crit-100 text-crit' : t.kind === 'success' ? 'border-ok-100 text-ok' : 'border-line text-ink')}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

/** Run an async action and report the outcome. Returns true on success. */
export function useAction() {
  const toast = useToast()
  return useCallback(async (fn: () => Promise<unknown>, successText?: string) => {
    try { await fn(); if (successText) toast('success', successText); return true }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Action failed'); return false }
  }, [toast])
}
