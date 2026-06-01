import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Apply the persisted theme to <html> before first paint so the surfaces /
// body background come up dark (the default) without a light flash.
try {
  const raw = localStorage.getItem('nn_prefs_v1')
  const theme = raw ? (JSON.parse(raw).theme ?? 'dark') : 'dark'
  document.documentElement.setAttribute('data-theme', theme)
} catch {
  document.documentElement.setAttribute('data-theme', 'dark')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
