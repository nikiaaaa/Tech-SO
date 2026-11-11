import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { errorMessage } from '../../lib/api'
import { Button, Field, Input } from '../../components/ui'

/** M00 — technician sign-in. The token is kept on the device so the app keeps working offline. */
export default function MobileLogin() {
  const { user, login, logout } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (user?.role === 'technician') return <Navigate to="/m" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const u = await login(email.trim(), password, true)
      if (u.role !== 'technician') {
        await logout()
        setErr('This app is for field technicians. Dispatch and management staff: use the desktop sign-in.')
        return
      }
      nav('/m', { replace: true })
    } catch (e2) { setErr(errorMessage(e2)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full flex flex-col justify-center bg-canvas p-5">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo.png" alt="TechSO" className="w-28 h-28" />
          <div className="text-sm text-muted">Technical Service Operations · Field app</div>
        </div>
        <form onSubmit={submit} className="card p-5 space-y-4" aria-label="Technician sign in">
          <h1 className="text-xl">Sign in</h1>
          <Field label="Email"><Input className="tap" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password" error={err}><Input className="tap" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button size="lg" type="submit" variant="primary" className="w-full" loading={busy}>Sign in</Button>
          <p className="text-xs text-muted">Your session stays on this device so you can keep working without a connection. Sign out when you hand the phone to someone else.</p>
        </form>
        <p className="text-xs text-muted text-center mt-4">Dispatch or management? <a className="text-primary underline" href="/login">Desktop sign-in</a></p>
      </div>
    </div>
  )
}
