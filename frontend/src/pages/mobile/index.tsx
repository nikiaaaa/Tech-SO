import { Navigate, Route, Routes } from 'react-router-dom'
import MobileLayout from './MobileLayout'
import { MobileProvider } from './MobileContext'
import MobileLogin from './MobileLogin'
import Home from './Home'
import Jobs from './Jobs'
import Incoming from './Incoming'
import JobDetails from './JobDetails'
import NavigationScreen from './Navigation'
import Arrival from './Arrival'
import Checklist from './Checklist'
import Evidence from './Evidence'
import Report from './Report'
import Performance from './Performance'
import Shift from './Shift'
import Profile from './Profile'
import SyncQueue from './SyncQueue'

/** Technician app, mounted at /m/*. Mobile-first PWA; see docs for the limits (no background push, tiles need a connection). */
export function MobileApp() {
  return (
    <MobileProvider>
      <Routes>
        <Route element={<MobileLayout />}>
          <Route index element={<Home />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="job/:id" element={<JobDetails />} />
          <Route path="job/:id/incoming" element={<Incoming />} />
          <Route path="job/:id/navigate" element={<NavigationScreen />} />
          <Route path="job/:id/arrival" element={<Arrival />} />
          <Route path="job/:id/checklist" element={<Checklist />} />
          <Route path="job/:id/evidence" element={<Evidence />} />
          <Route path="job/:id/report" element={<Report />} />
          <Route path="performance" element={<Performance />} />
          <Route path="shift" element={<Shift />} />
          <Route path="profile" element={<Profile />} />
          <Route path="sync" element={<SyncQueue />} />
          <Route path="*" element={<Navigate to="/m" replace />} />
        </Route>
      </Routes>
    </MobileProvider>
  )
}

export { MobileLogin }
