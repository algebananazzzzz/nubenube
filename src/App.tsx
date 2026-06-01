import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Companion } from './components/Companion'
import { Home } from './pages/Home'
import { ProjectDetail } from './pages/ProjectDetail'
import { Insights } from './pages/Insights'
import { Settings } from './pages/Settings'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/* standalone OS windows */}
        <Route path="companion" element={<Companion />} />

        {/* the main window */}
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="project/:id" element={<ProjectDetail />} />
          <Route path="insights" element={<Insights />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
