import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CommandBar } from './CommandBar'

const isOverlay = location.hash === '#overlay'
document.documentElement.dataset.surface = isOverlay ? 'overlay' : 'window'

createRoot(document.getElementById('root')!).render(<StrictMode>{isOverlay ? <CommandBar /> : <App />}</StrictMode>)
