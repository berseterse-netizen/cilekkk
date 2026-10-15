import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Uygulama olarak yükleme ve hızlı açılış için hizmet çalışanı (yalnızca derlemede).
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* kendinden imzalı sertifikada tarayıcı kaydı reddeder; uygulama yine çalışır */
    })
  })
}
