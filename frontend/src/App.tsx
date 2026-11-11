import { BrowserRouter, Navigate, Route, Routes, useLocation, type RouteObject } from 'react-router-dom'
import { Suspense, lazy, type ReactNode } from 'react'
import { AuthProvider, STAFF_ROLES, isOneOf, useAuth } from './lib/auth'
import { RealtimeProvider } from './lib/realtime'
import { Loading, ToastProvider } from './components/ui'
import Shell from './components/desktop/Shell'
import Login from './pages/Login'
import { desktopRoutes } from './pages/desktop'
import type { Role } from './lib/types'

// The technician app and the desktop screens are separate downloads: a phone never loads the scheduler UI.
const MobileApp = lazy(() => import('./pages/mobile').then((m) => ({ default: m.MobileApp })))
const MobileLogin = lazy(() => import('./pages/mobile').then((m) => ({ default: m.MobileLogin })))

function Guard({ roles, loginPath, children }: { roles: Role[]; loginPath: string; children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Loading label="Starting TechSO…" />
  if (!user) return <Navigate to={loginPath} replace state={{ from: loc.pathname + loc.search }} />
  if (!isOneOf(user, roles)) return <Navigate to={user.role === 'technician' ? '/m' : '/'} replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <RealtimeProvider>
            <Suspense fallback={<Loading label="Loading…" />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/m/login" element={<MobileLogin />} />
              <Route path="/m/*" element={<Guard roles={['technician']} loginPath="/m/login"><MobileApp /></Guard>} />
              <Route element={<Guard roles={STAFF_ROLES} loginPath="/login"><Shell /></Guard>}>
                {(desktopRoutes as RouteObject[]).map((r, i) => <Route key={r.path ?? `i${i}`} {...(r as object)} />)}
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </RealtimeProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
