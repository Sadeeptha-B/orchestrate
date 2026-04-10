import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

// Register service worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/orchestrate/sw.js').catch(() => { });
    });
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter basename="/orchestrate/">
            <App />
        </BrowserRouter>
    </StrictMode>,
)
