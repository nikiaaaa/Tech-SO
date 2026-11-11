import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { checkSummary, mergeChecks } from './checklistState'
import { fitWithin, photoProblem } from './image'
import { REJECT_OPTIONS, ReasonSheet, StatusPanel, TextSheet } from './parts'
import type { QueueItem } from '../../lib/offline'

describe('checklist state', () => {
  it('keeps ticks the technician already made and adds new template items unticked', () => {
    const merged = mergeChecks(['Check power', 'Run self-test', 'New step'], [{ label: 'Check power', done: true }, { label: 'Removed item', done: true }])
    expect(merged).toEqual([{ label: 'Check power', done: true }, { label: 'Run self-test', done: false }, { label: 'New step', done: false }])
    expect(checkSummary(merged)).toEqual({ done: 1, total: 3 })
  })
})

describe('photo helpers', () => {
  it('never upscales and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
  })
  it('rejects non-images, empty files and oversized files before queueing', () => {
    const max = 8 * 1024 * 1024
    expect(photoProblem({ type: 'application/pdf', size: 10 }, max)).toMatch(/photo/i)
    expect(photoProblem({ type: 'image/jpeg', size: 0 }, max)).toMatch(/empty/i)
    expect(photoProblem({ type: 'image/jpeg', size: max + 1 }, max)).toMatch(/8 MB/)
    expect(photoProblem({ type: 'image/png', size: 1000 }, max)).toBeNull()
  })
})

describe('ReasonSheet (reject / hold reasons are mandatory)', () => {
  const setup = () => {
    const onConfirm = vi.fn(async () => {})
    render(<ReasonSheet open title="Why?" options={REJECT_OPTIONS} confirmLabel="Reject job" onClose={() => {}} onConfirm={onConfirm} />)
    return onConfirm
  }

  it('refuses to confirm without a chosen reason', async () => {
    const onConfirm = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Reject job' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('choose a reason')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('"Other" needs a written note', async () => {
    const onConfirm = setup()
    fireEvent.click(screen.getByLabelText('Other (note required)'))
    fireEvent.click(screen.getByRole('button', { name: 'Reject job' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('short note')
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Family emergency' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject job' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ value: 'other', label: 'Other (note required)', note: 'Family emergency' }))
  })

  it('a preset reason is enough on its own', async () => {
    const onConfirm = setup()
    fireEvent.click(screen.getByLabelText('Vehicle breakdown'))
    fireEvent.click(screen.getByRole('button', { name: 'Reject job' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ value: 'vehicle', note: '' })))
  })
})

describe('TextSheet (appeal)', () => {
  it('requires the minimum length', async () => {
    const onConfirm = vi.fn(async () => {})
    render(<TextSheet open title="Appeal" label="Why" minLength={10} confirmLabel="Send" onClose={() => {}} onConfirm={onConfirm} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'too short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('StatusPanel keeps server truth and local intent apart', () => {
  const item = (type: QueueItem['type'], state: QueueItem['state']): QueueItem => ({ id: type, type, payload: {}, occurred_at: '', state, attempts: 0 })
  const show = (pending: QueueItem[], projected: 'NOTIFIED' | 'ACCEPTED') =>
    render(<MemoryRouter><StatusPanel serverStatus="NOTIFIED" projected={projected} pending={pending} /></MemoryRouter>)

  it('shows only the server status when nothing is pending', () => {
    show([], 'NOTIFIED')
    expect(screen.getByText('Status confirmed by server')).toBeInTheDocument()
    expect(screen.queryByText(/Not yet confirmed/)).toBeNull()
  })

  it('lists pending actions with their exact state and never calls the projection a fact', () => {
    show([item('accept', 'local')], 'ACCEPTED')
    expect(screen.getByText('Awaiting response')).toBeInTheDocument()          // the server status
    expect(screen.getByText(/Not yet confirmed \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/If accepted, the job becomes/)).toBeInTheDocument()
    expect(screen.getByText('Locally recorded')).toBeInTheDocument()
  })
})
