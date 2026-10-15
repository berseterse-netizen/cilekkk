const fallback: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
/** TURN kimlikleri süreli; liste bir saatten eskiyse yeniden istenir. */
const MAX_AGE_MS = 60 * 60 * 1000

let pending: Promise<RTCIceServer[]> | null = null
let loadedAt = 0

function valid(value: unknown): value is RTCIceServer[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => item && typeof item === 'object' && 'urls' in item)
}

/** Sunucunun verdiği STUN/TURN listesini yükler; olmazsa genel STUN kullanılır. */
export function loadIceServers() {
  if (pending && Date.now() - loadedAt > MAX_AGE_MS) pending = null
  if (!pending) {
    loadedAt = Date.now()
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 8000)
    pending = fetch('/api/ice', { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { iceServers?: unknown } | null) => {
        if (valid(data?.iceServers)) return data.iceServers
        pending = null
        return fallback
      })
      .catch(() => {
        pending = null
        return fallback
      })
      .finally(() => window.clearTimeout(timer))
  }
  return pending
}
