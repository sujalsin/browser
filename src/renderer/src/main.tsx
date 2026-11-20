import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { FindBar } from './FindBar'
import { Overlay } from './Overlay'

// One bundle, three surfaces: the window (sidebar), the overlay (command bar,
// Library, peek sidebar) and the find bar.
const surface = location.hash === '#overlay' ? 'overlay' : location.hash === '#find' ? 'find' : 'window'
document.documentElement.dataset.surface = surface

const root = surface === 'overlay' ? <Overlay /> : surface === 'find' ? <FindBar /> : <App />
createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
