import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, session } from './api'
import type { Role, User } from './types'

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (email: string, password: string, persistent?: boolean) => Promise<User>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export const STAFF_ROLES: Role[] = ['super_admin', 'management', 'supervisor', 'scheduler']

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session.get()) { setLoading(false); return }
    api.get<User>('/auth/me').then(setUser).catch(() => session.clear()).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onExpired = () => { session.clear(); setUser(null) }
    window.addEventListener('techso:unauthorized', onExpired)
    return () => window.removeEventListener('techso:unauthorized', onExpired)
  }, [])

  // Slide the session while the app is open: tokens are short-lived.
  useEffect(() => {
    if (!user) return
    const t = setInterval(() => {
      api.post<{ access_token: string }>('/auth/refresh').then((r) => {
        const persistent = localStorage.getItem('techso.token') !== null
        session.set(r.access_token, persistent)
      }).catch(() => { /* offline: keep working with the current token until it expires */ })
    }, 20 * 60 * 1000)
    return () => clearInterval(t)
  }, [user])

  const login = useCallback(async (email: string, password: string, persistent = false) => {
    const r = await api.post<{ access_token: string; user: User }>('/auth/login', { email, password })
    session.set(r.access_token, persistent)
    setUser(r.user)
    return r.user
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout') } catch { /* already signed out or offline */ }
    session.clear()
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used inside AuthProvider')
  return c
}

/** UI hint only. The API enforces every permission; this just hides controls a role cannot use. */
export const isOneOf = (user: User | null, roles: Role[]) => !!user && roles.includes(user.role)
