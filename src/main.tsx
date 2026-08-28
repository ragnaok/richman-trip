import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { disableZoomGestures } from './lib/disableGestures'
import './styles/tokens.css'
import './styles/app.css'

disableZoomGestures()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
