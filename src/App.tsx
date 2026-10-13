import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Companion } from './components/Companion'
import { Home } from './pages/Home'
import { Insights } from './pages/Insights'
import { Rules } from './pages/Rules'
import { Sources } from './pages/Sources'
import { Settings } from './pages/Settings'
import { checkForUpdates } from './lib/updater'

export default function App() {
  useEffect(() => { checkForUpdates(); }, [])
  return (
    <HashRouter>
      <Routes>
        {/* standalone OS windows */}
        <Route path="companion" element={<Companion />} />

        {/* the main window */}
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="insights" element={<Insights />} />
          <Route path="rules" element={<Rules />} />
          <Route path="sources" element={<Sources />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
