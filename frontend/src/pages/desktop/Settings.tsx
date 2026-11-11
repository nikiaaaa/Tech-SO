import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import type { Role } from '../../lib/types'
import { PageHeader, Tabs } from '../../components/ui'
import { DevicesSettingsTab, NotificationsTab, SlaPolicyTab, TeamsTab } from './SettingsA'
import { AuditTab, GeneralTab, GpsTab, ScoringTab, UsersTab } from './SettingsB'
import { DEVICE_WRITE_ROLES, has } from './common'

export type SettingsTabId = 'sla' | 'notifications' | 'teams' | 'devices' | 'general' | 'users' | 'scoring' | 'gps' | 'audit'
const ALL: Role[] = ['super_admin', 'management', 'supervisor', 'scheduler']
const TABS: { id: SettingsTabId; label: string; view: Role[]; edit: Role[] }[] = [
  { id: 'sla', label: 'SLA Policy', view: ALL, edit: ['super_admin', 'management'] },
  { id: 'notifications', label: 'Notifications', view: ALL, edit: ['super_admin', 'supervisor'] },
  { id: 'teams', label: 'Teams', view: ALL, edit: ['super_admin', 'supervisor'] },
  { id: 'devices', label: 'Devices', view: ALL, edit: ['super_admin'] },
  { id: 'general', label: 'General', view: ['super_admin'], edit: ['super_admin'] },
  { id: 'users', label: 'Users & Roles', view: ['super_admin', 'management', 'supervisor'], edit: ['super_admin'] },
  { id: 'scoring', label: 'Scoring', view: ['super_admin', 'management'], edit: ['super_admin', 'management'] },
  { id: 'gps', label: 'GPS & Retention', view: ALL, edit: ['super_admin'] },
  { id: 'audit', label: 'Audit Logs', view: ['super_admin', 'management'], edit: [] },
]

/** Which settings tabs a role can open, and whether it may change them (UI hint; the API enforces it). */
export function settingsTabs(role: Role) {
  return TABS.filter((t) => t.view.includes(role)).map((t) => ({ id: t.id, label: t.label, canEdit: t.edit.includes(role) }))
}

/** D10 — settings shell with every configuration tab. */
export default function Settings() {
  const { tab } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  if (!user) return null
  const tabs = settingsTabs(user.role)
  const current = tabs.find((t) => t.id === tab)
  if (!current) return <Navigate to={`/settings/${tabs[0].id}`} replace />
  const edit = current.canEdit
  return (
    <>
      <PageHeader title="Settings" subtitle="Configuration for your organization" />
      <Tabs<SettingsTabId> value={current.id} onChange={(t) => nav(`/settings/${t}`)} tabs={tabs.map((t) => ({ id: t.id, label: t.label }))} />
      <div className="mt-4">
        {current.id === 'sla' && <SlaPolicyTab canEdit={edit} />}
        {current.id === 'notifications' && <NotificationsTab canEdit={edit} />}
        {current.id === 'teams' && <TeamsTab canEdit={edit} />}
        {current.id === 'devices' && <DevicesSettingsTab canAdmin={edit} canImport={has(user.role, DEVICE_WRITE_ROLES)} />}
        {current.id === 'general' && <GeneralTab canEdit={edit} />}
        {current.id === 'users' && <UsersTab canEdit={edit} />}
        {current.id === 'scoring' && <ScoringTab canEdit={edit} />}
        {current.id === 'gps' && <GpsTab canEdit={edit} />}
        {current.id === 'audit' && <AuditTab />}
      </div>
    </>
  )
}
