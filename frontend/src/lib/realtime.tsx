import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { session } from './api'
import { useAuth } from './auth'
import type { RealtimeEvent } from './types'

export type RtStatus = 'connected' | 'connecting' | 'offline'
type Listener = (e: RealtimeEvent) => void

interface RtCtx { status: RtStatus; subscribe: (fn: Listener) => () => void }
const Ctx = createContext<RtCtx>({ status: 'offline', subscribe: () => () => {} })

/** One WebSocket per signed-in tab with automatic reconnect. Events are hints to refetch; the API stays the source of truth. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [status, setStatus] = useState<RtStatus>('offline')
  const listeners = useRef(new Set<Listener>())
  const subscribe = useRef((fn: Listener) => {
    listeners.current.add(fn)
    return () => { listeners.current.delete(fn) }
  }).current

  useEffect(() => {
    if (!user) { setStatus('offline'); return }
    let ws: WebSocket | null = null
    let retry = 1000
    let timer: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined
    let stopped = false

    const connect = () => {
      const token = session.get()
      if (!token || stopped) return
      setStatus('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
      ws.onopen = () => { retry = 1000; setStatus('connected'); ping = setInterval(() => ws?.readyState === 1 && ws.send('ping'), 25000) }
      ws.onmessage = (m) => {
        try { const e = JSON.parse(m.data) as RealtimeEvent; listeners.current.forEach((fn) => fn(e)) } catch { /* ignore malformed frames */ }
      }
      ws.onclose = () => {
        clearInterval(ping)
        if (stopped) return
        setStatus('offline')
        timer = setTimeout(connect, retry)
        retry = Math.min(retry * 2, 30000)
      }
      ws.onerror = () => ws?.close()
    }
    connect()
    return () => { stopped = true; clearTimeout(timer); clearInterval(ping); ws?.close() }
  }, [user])

  return <Ctx.Provider value={{ status, subscribe }}>{children}</Ctx.Provider>
}

export const useRealtimeStatus = () => useContext(Ctx).status

/** Subscribe to events for the lifetime of a component. `fn` may change every render. */
export function useRealtime(fn: Listener) {
  const { subscribe } = useContext(Ctx)
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe])
}
