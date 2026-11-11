import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'

export interface CheckItem { label: string; done: boolean }

const key = (jobId: string) => `techso.m.cl.${jobId}`
const tplKey = (categoryId: string) => `techso.m.cltpl.${categoryId}`

/** Merge the template from the server with what the technician already ticked on this device. */
export function mergeChecks(template: string[], saved: CheckItem[]): CheckItem[] {
  const done = new Map(saved.map((s) => [s.label, s.done]))
  return template.map((label) => ({ label, done: done.get(label) ?? false }))
}

export const checkSummary = (items: CheckItem[]) => ({ done: items.filter((i) => i.done).length, total: items.length })

function read<T>(k: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(k) ?? 'null') as T) ?? fallback } catch { return fallback }
}

/** Checklist template (cached for offline use) plus the ticks, saved on the device per job. */
export function useChecklist(jobId: string, categoryId: string | null | undefined) {
  const [template, setTemplate] = useState<string[]>(() => (categoryId ? read<string[]>(tplKey(categoryId), []) : []))
  const [loaded, setLoaded] = useState(!categoryId)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<CheckItem[]>(() => mergeChecks(template, read<CheckItem[]>(key(jobId), [])))

  useEffect(() => {
    if (!categoryId) { setLoaded(true); return }
    let alive = true
    api.get<CheckItem[]>(`/checklists/${categoryId}`)
      .then((r) => { if (!alive) return; const t = r.map((x) => x.label); setTemplate(t); try { localStorage.setItem(tplKey(categoryId), JSON.stringify(t)) } catch { /* full */ } setError(null) })
      .catch((e: Error) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [categoryId])

  useEffect(() => { setItems(mergeChecks(template, read<CheckItem[]>(key(jobId), []))) }, [template, jobId])

  const toggle = useCallback((label: string) => {
    setItems((cur) => {
      const next = cur.map((i) => (i.label === label ? { ...i, done: !i.done } : i))
      try { localStorage.setItem(key(jobId), JSON.stringify(next)) } catch { /* full */ }
      return next
    })
  }, [jobId])

  return { items, toggle, loaded, error, hasTemplate: template.length > 0 }
}
