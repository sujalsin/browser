import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { FindBar } from './FindBar'
import { Little } from './Little'
import { Overlay } from './Overlay'

// One bundle, four surfaces: the window (sidebar), the overlay (command bar,
// Library, Peek, peek sidebar), the find bar, and Little Arc's toolbar.
const surfaces = { '#overlay': 'overlay', '#find': 'find', '#little': 'little' } as const
const surface = surfaces[location.hash as keyof typeof surfaces] ?? 'window'
document.documentElement.dataset.surface = surface

const root = { overlay: <Overlay />, find: <FindBar />, little: <Little />, window: <App /> }[surface]
createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
