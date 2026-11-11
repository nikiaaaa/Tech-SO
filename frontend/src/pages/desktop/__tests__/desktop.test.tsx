import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ user: { current: { id: 'u1', role: 'scheduler', full_name: 'Sched', email: 's@x', phone: null, company: null } as unknown } }))

vi.mock('../../../lib/api', async (orig) => {
  const actual = await orig<typeof import('../../../lib/api')>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), blob: vi.fn(), text: vi.fn(), upload: vi.fn() } }
})
vi.mock('../../../lib/auth', () => ({ useAuth: () => ({ user: h.user.current }) }))

import { api } from '../../../lib/api'
import { ReasonDialog } from '../../../components/ui'
import AssignPanel from '../AssignPanel'
import CreateJobModal, { validateJobForm } from '../CreateJobModal'
import JobDetail from '../JobDetail'
import { chartFor } from '../Reports'
import { settingsTabs } from '../Settings'
import { validatePolicy } from '../SettingsA'
import { weightsTotal } from '../SettingsB'
import { jobActions } from '../common'

const mocked = api as unknown as Record<'get' | 'post', ReturnType<typeof vi.fn>>

beforeEach(() => { mocked.get.mockReset(); mocked.post.mockReset(); h.user.current = { id: 'u1', role: 'scheduler', full_name: 'Sched', email: 's@x', phone: null, company: null } })

describe('jobActions (role- and status-dependent buttons)', () => {
  it('offers assign only for unassigned jobs and reassign once a technician was involved', () => {
    expect(jobActions('CREATED', 'scheduler')).toContain('assign')
    expect(jobActions('CREATED', 'scheduler')).not.toContain('reassign')
    expect(jobActions('NOTIFIED', 'scheduler')).toContain('reassign')
    expect(jobActions('IN_PROGRESS', 'scheduler')).not.toContain('reassign')
  })
  it('offers verification only in VERIFICATION, never RESOLVED/CLOSED', () => {
    expect(jobActions('VERIFICATION', 'supervisor')).toEqual(expect.arrayContaining(['verify', 'request_correction']))
    expect(jobActions('RESOLVED', 'supervisor')).not.toContain('verify')
    expect(jobActions('CLOSED', 'supervisor')).toEqual([])
  })
  it('gives management read-only access and technicians nothing', () => {
    expect(jobActions('CREATED', 'management')).toEqual([])
    expect(jobActions('VERIFICATION', 'management')).toEqual([])
    expect(jobActions('CREATED', 'technician')).toEqual([])
  })
  it('no actions on a cancelled job', () => expect(jobActions('CANCELLED', 'super_admin')).toEqual([]))
})

describe('validation helpers', () => {
  it('validateJobForm requires device, priority and a real description', () => {
    expect(Object.keys(validateJobForm({ device_id: '', category_id: '', priority: '', description: '' })).sort()).toEqual(['description', 'device_id', 'priority'])
    expect(validateJobForm({ device_id: 'd', category_id: '', priority: 'high', description: 'ab' }).description).toBeTruthy()
    expect(validateJobForm({ device_id: 'd', category_id: '', priority: 'high', description: 'Cash jam' })).toEqual({})
  })
  const policy = { name: 'Policy',warning_pct: 80, response_min: 10, dispatch_min: 10, mobilization_min: 10, travel_min: 10, repair_min: 10, verification_min: 10, total_min: 60 }
  it('validatePolicy rejects non-positive minutes and out-of-range thresholds', () => {
    expect(validatePolicy(policy)).toBeNull()
    expect(validatePolicy({ ...policy, total_min: 0 })).toMatch(/Total resolution/)
    expect(validatePolicy({ ...policy, travel_min: 1.5 })).toMatch(/Travel/)
    expect(validatePolicy({ ...policy, warning_pct: 100 })).toMatch(/between 1 and 99/)
    expect(validatePolicy({ ...policy, name: ' ' })).toMatch(/Name/)
  })
  it('weightsTotal sums scoring weights', () => expect(weightsTotal({ a: 15, b: 15, c: 30, d: 15, e: 25 })).toBe(100))
  it('chartFor builds bars from report rows', () => {
    expect(chartFor('sla', { kind: 'sla', columns: [], summary: {}, rows: [['high', 4, 3, 1, 75, 50]] })).toEqual([{ name: 'high', value: 75 }])
    expect(chartFor('jobs', { kind: 'jobs', columns: [], summary: {}, rows: [['J1', 'D', 'ATM', 'high'], ['J2', 'D', 'ATM', 'high']] })).toEqual([{ name: 'high', value: 2 }])
  })
})

describe('settings tab visibility by role', () => {
  const ids = (r: Parameters<typeof settingsTabs>[0]) => settingsTabs(r).map((t) => t.id)
  it('scheduler cannot see users, scoring, general or audit', () => {
    expect(ids('scheduler')).toEqual(['sla', 'notifications', 'teams', 'devices', 'gps'])
    expect(settingsTabs('scheduler').every((t) => !t.canEdit)).toBe(true)
  })
  it('only the super admin sees every tab and may edit the GPS policy', () => {
    expect(ids('super_admin')).toHaveLength(9)
    expect(settingsTabs('management').find((t) => t.id === 'gps')?.canEdit).toBe(false)
    expect(settingsTabs('super_admin').find((t) => t.id === 'gps')?.canEdit).toBe(true)
  })
  it('management can configure SLA and scoring and read the audit log; supervisor edits notifications', () => {
    expect(settingsTabs('management').find((t) => t.id === 'sla')?.canEdit).toBe(true)
    expect(ids('management')).toContain('audit')
    expect(settingsTabs('supervisor').find((t) => t.id === 'notifications')?.canEdit).toBe(true)
    expect(ids('supervisor')).not.toContain('audit')
  })
})

describe('ReasonDialog', () => {
  it('does not confirm without a reason, then confirms with one', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<ReasonDialog open title="Cancel" confirmLabel="Do it" onClose={() => {}} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 3/)
    await userEvent.type(screen.getByRole('textbox'), 'Duplicate report')
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Duplicate report'))
  })
})

describe('AssignPanel', () => {
  const cands = [
    { id: 't1', full_name: 'Asep', availability: 'available', active_jobs: 0, skills: ['ATM'], skill_match: true, distance_km: 1.2, eta_min_estimate: 3, recommended: true, is_current: false, location: null },
    { id: 't2', full_name: 'Dedi', availability: 'off_shift', active_jobs: 0, skills: [], skill_match: false, distance_km: null, eta_min_estimate: null, recommended: false, is_current: false, location: null },
  ]
  it('labels distance and ETA as estimates and shows recommendation without forcing it', async () => {
    mocked.get.mockResolvedValue(cands)
    render(<AssignPanel open job={{ id: 'j1', code: 'J-1', status: 'CREATED' }} onClose={() => {}} onDone={() => {}} />)
    expect(await screen.findByText('Asep')).toBeInTheDocument()
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByText(/\(estimate\)/)).toBeInTheDocument()
    expect(screen.getByText(/No recent GPS position/)).toBeInTheDocument()
  })
  it('assigns the chosen technician for a new job', async () => {
    mocked.get.mockResolvedValue(cands); mocked.post.mockResolvedValue({})
    const onDone = vi.fn()
    render(<AssignPanel open job={{ id: 'j1', code: 'J-1', status: 'CREATED' }} onClose={() => {}} onDone={onDone} />)
    await screen.findByText('Dedi')
    await userEvent.click(screen.getAllByRole('radio')[1])
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/jobs/j1/assign', { technician_id: 't2' }))
    expect(onDone).toHaveBeenCalled()
  })
  it('requires a reason to reassign', async () => {
    mocked.get.mockResolvedValue(cands); mocked.post.mockResolvedValue({})
    render(<AssignPanel open job={{ id: 'j1', code: 'J-1', status: 'REJECTED' }} onClose={() => {}} onDone={() => {}} />)
    await screen.findByText('Asep')
    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/reason is required/)
    expect(mocked.post).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox'), 'Technician unreachable')
    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/jobs/j1/reassign', { technician_id: 't1', reason: 'Technician unreachable' }))
  })
})

describe('CreateJobModal', () => {
  it('shows validation errors and does not call the API when the form is empty', async () => {
    mocked.get.mockImplementation(async (p: string) => (p === '/devices' ? { items: [], total: 0 } : []))
    render(<CreateJobModal open onClose={() => {}} onCreated={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Select an ATM or CRM')).toBeInTheDocument()
    expect(screen.getByText(/at least 5 characters/)).toBeInTheDocument()
    expect(mocked.post).not.toHaveBeenCalled()
  })
})

describe('JobDetail actions by role', () => {
  const sla = { state: 'on_track', due_at: null, remaining_seconds: null, paused_seconds: 0, policy_id: null, segments: {} }
  const job = { id: 'j1', code: 'J-1', status: 'VERIFICATION', priority: 'high', description: 'Cash jam', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', closed_at: null, hold_reason: null, correction_count: 0, device: { id: 'd', code: 'ATM-1', type: 'ATM' }, category: null, assignee: null, sla, assignments: [], events: [], report: null, evidence: [] }
  const renderIt = () => render(<MemoryRouter initialEntries={['/jobs/j1']}><Routes><Route path="/jobs/:id" element={<JobDetail />} /></Routes></MemoryRouter>)
  beforeEach(() => { mocked.get.mockImplementation(async (p: string) => (p === '/sla/pauses' ? [] : job)) })

  it('lets a scheduler approve or send back a resolved job awaiting verification', async () => {
    renderIt()
    expect(await screen.findByRole('button', { name: /Approve & close/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request correction' })).toBeInTheDocument()
    expect(screen.getByText(/resolved but/)).toHaveTextContent(/not closed/)
  })
  it('hides every action from management (read-only) and says there is no SLA policy honestly', async () => {
    h.user.current = { id: 'm', role: 'management', full_name: 'M', email: 'm@x', phone: null, company: null }
    renderIt()
    expect(await screen.findByText('Cash jam')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve & close/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Request SLA pause/ })).toBeNull()
    expect(screen.getByText(/No SLA policy matches this job/)).toBeInTheDocument()
  })
})
