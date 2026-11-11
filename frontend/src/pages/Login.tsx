import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/api'
import { Button, Field, Input } from '../components/ui'

const DEMO = ['admin', 'manager', 'supervisor', 'scheduler', 'tech1']

/** D00 — staff sign-in. Technicians are sent to the mobile app after login. */
export default function Login() {
  const { user, login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (user) return <Navigate to={user.role === 'technician' ? '/m' : (loc.state?.from ?? '/')} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const u = await login(email.trim(), password, false)
      nav(u.role === 'technician' ? '/m' : (loc.state?.from ?? '/'), { replace: true })
    } catch (e2) { setErr(errorMessage(e2)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full grid place-items-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo.png" alt="TechSO" className="w-24 h-24" />
          <div className="text-xs text-muted mt-1">Technical Service Operations</div>
        </div>
        <form onSubmit={submit} className="card p-5 space-y-4" aria-label="Sign in">
          <h1 className="text-lg">Sign in</h1>
          <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password" error={err}><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Sign in</Button>
          <p className="text-xs text-muted text-center">Field technician? <a className="text-primary hover:underline" href="/m/login">Open the technician app</a></p>
        </form>
        {import.meta.env.DEV && (
          <div className="mt-4 text-xs text-muted card p-3">
            <div className="font-medium text-ink mb-1">Demo accounts (dev build only)</div>
            <div className="flex flex-wrap gap-1.5">{DEMO.map((d) => <button key={d} type="button" className="rounded border border-line px-1.5 py-0.5 hover:bg-canvas" onClick={() => setEmail(`${d}@demo.techso.local`)}>{d}@demo.techso.local</button>)}</div>
            <div className="mt-1.5">Password: see <code>backend/.env.example</code> (<code>TECHSO_DEMO_PASSWORD</code>).</div>
          </div>
        )}
      </div>
    </div>
  )
}
