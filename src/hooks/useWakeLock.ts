import { useEffect } from 'react'

type Sentinel = { release: () => Promise<void> }

/** Görüşme sürerken telefonun ekranı kararmasın. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }).wakeLock
    if (!enabled || !api) return
    let sentinel: Sentinel | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      api
        .request('screen')
        .then((lock) => {
          if (cancelled) void lock.release()
          else sentinel = lock
        })
        .catch(() => {})
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void sentinel?.release().catch(() => {})
    }
  }, [enabled])
}
