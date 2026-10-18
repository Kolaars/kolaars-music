import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/base.css'
import './styles/layout.css'
import './styles/views.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container is missing from index.html')

// StrictMode is intentionally not used: the media element and download listeners
// are side-effectful singletons that must not be created twice.
createRoot(container).render(<App />)
