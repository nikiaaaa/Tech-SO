import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Satellite } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { ROLE_LABEL } from '../../lib/format'
import { askNotificationPermission, playOnce } from '../../lib/alerts'
import { useAsync } from '../../lib/hooks'
import { Async, Button, Card, Field, Input, useAction } from '../../components/ui'
import { useMobile } from './MobileContext'
import { SectionTitle } from './parts'

interface GpsPolicy { enabled: boolean; min_interval_s: number; max_accuracy_m: number; stale_after_s: number; retention_days: number }

/** M11 — Profile: phone, password, alert test, what is tracked, sign out. */
export default function Profile() {
  const { user, logout } = useAuth()
  const { unsynced, trackerState } = useMobile()
  const nav = useNavigate()
  const act = useAction()
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [perm, setPerm] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const policy = useAsync(() => api.get<GpsPolicy>('/settings/gps_policy'), [])

  const signOut = async () => {
    if (unsynced > 0 && !window.confirm(`${unsynced} action(s) are not yet confirmed by the server. They stay on this device and are sent the next time you sign in on it. Sign out anyway?`)) return
    await logout()
    nav('/m/login', { replace: true })
  }

  return (
    <div>
      <h1 className="text-xl mb-3">Profile</h1>
      <Card className="p-4">
        <div className="text-lg font-semibold">{user?.full_name}</div>
        <div className="text-sm text-muted">{user && ROLE_LABEL[user.role]} · {user?.company?.name}</div>
        <div className="text-sm text-muted">{user?.email}</div>
      </Card>

      <SectionTitle>Contact</SectionTitle>
      <Card className="p-4 space-y-3">
        <Field label="Phone"><Input className="tap" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Button size="lg" className="w-full" onClick={() => void act(() => api.patch('/me', { phone }), 'Phone saved')}>Save phone</Button>
      </Card>

      <SectionTitle>Change password</SectionTitle>
      <Card className="p-4 space-y-3">
        <Field label="Current password"><Input className="tap" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" hint="At least 10 characters"><Input className="tap" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Button size="lg" className="w-full" disabled={next.length < 10 || !cur}
          onClick={async () => { if (await act(() => api.patch('/me', { current_password: cur, password: next }), 'Password changed')) { setCur(''); setNext('') } }}>Change password</Button>
      </Card>

      <SectionTitle>New-job alerts</SectionTitle>
      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2"><Bell size={18} aria-hidden /><b>Sound and vibration</b></div>
        <p className="text-sm text-muted">Alerts sound only while this app is open. This version has no background push notifications and no Android notification channel; your phone's silent or Do Not Disturb mode still applies.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" onClick={() => playOnce('urgent')}>Test urgent</Button>
          <Button size="lg" onClick={() => playOnce('normal')}>Test normal</Button>
        </div>
        <Button size="lg" className="w-full" disabled={perm === 'granted' || perm === 'unsupported'} onClick={async () => setPerm(await askNotificationPermission())}>
          {perm === 'granted' ? 'Pop-up notifications allowed' : perm === 'unsupported' ? 'Pop-up notifications not supported here' : perm === 'denied' ? 'Blocked in browser settings' : 'Allow pop-up notifications'}
        </Button>
      </Card>

      <SectionTitle>What is tracked</SectionTitle>
      <Card className="p-4 space-y-1 text-sm">
        <div className="flex items-center gap-2"><Satellite size={18} aria-hidden /><b>Location</b> {trackerState.running ? '(tracking now)' : '(not tracking now)'}</div>
        <Async a={policy}>
          {(p) => <p className="text-muted">{p.enabled ? `Only during an active shift or an active job. Sent at most every ${p.min_interval_s} s, kept ${p.retention_days} days, visible to dispatch and management.` : 'Location tracking is switched off by your company.'}</p>}
        </Async>
      </Card>

      <div className="mt-6"><Button size="lg" variant="danger" className="w-full" onClick={() => void signOut()}>Sign out</Button></div>
      {unsynced > 0 && <p className="text-xs text-warn mt-2">{unsynced} action(s) are still waiting to be confirmed by the server.</p>}
    </div>
  )
}
