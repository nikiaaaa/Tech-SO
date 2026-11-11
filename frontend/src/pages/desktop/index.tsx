import { lazy } from 'react'

// Each screen is its own chunk: the scheduler does not download charts, the map or Settings until they open them.
const Overview = lazy(() => import('./Overview'))
const LiveOps = lazy(() => import('./LiveOps'))
const Dispatch = lazy(() => import('./Dispatch'))
const JobDetail = lazy(() => import('./JobDetail'))
const History = lazy(() => import('./History'))
const Technicians = lazy(() => import('./Technicians').then((m) => ({ default: m.Technicians })))
const TechnicianDetail = lazy(() => import('./Technicians').then((m) => ({ default: m.TechnicianDetail })))
const Devices = lazy(() => import('./Devices').then((m) => ({ default: m.Devices })))
const DeviceDetail = lazy(() => import('./Devices').then((m) => ({ default: m.DeviceDetail })))
const Sla = lazy(() => import('./Sla'))
const Performance = lazy(() => import('./Performance'))
const Reports = lazy(() => import('./Reports'))
const Settings = lazy(() => import('./Settings'))
const Notifications = lazy(() => import('./Notifications'))

// Route contract (children of the desktop Shell):
//   /  /live  /dispatch  /jobs/:id  /history  /technicians  /technicians/:id  /devices  /devices/:id
//   /sla  /performance  /reports  /settings/:tab?  /notifications
export const desktopRoutes = [
  { index: true, element: <Overview /> },
  { path: 'live', element: <LiveOps /> },
  { path: 'dispatch', element: <Dispatch /> },
  { path: 'jobs/:id', element: <JobDetail /> },
  { path: 'history', element: <History /> },
  { path: 'technicians', element: <Technicians /> },
  { path: 'technicians/:id', element: <TechnicianDetail /> },
  { path: 'devices', element: <Devices /> },
  { path: 'devices/:id', element: <DeviceDetail /> },
  { path: 'sla', element: <Sla /> },
  { path: 'performance', element: <Performance /> },
  { path: 'reports', element: <Reports /> },
  { path: 'settings/:tab?', element: <Settings /> },
  { path: 'notifications', element: <Notifications /> },
]
