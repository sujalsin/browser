import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Overlay } from './Overlay'

const isOverlay = location.hash === '#overlay'
document.documentElement.dataset.surface = isOverlay ? 'overlay' : 'window'

createRoot(document.getElementById('root')!).render(<StrictMode>{isOverlay ? <Overlay /> : <App />}</StrictMode>)
