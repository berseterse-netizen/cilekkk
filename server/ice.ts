import { config, iceServers, publicStun, type IceServer } from './config'

type Cache = { servers: IceServer[]; fetchedAt: number; expiresAt: number }

let cache: Cache | null = null
let inflight: Promise<Cache | null> | null = null
let lastError = ''
let failedAt = 0
const RETRY_MS = 60_000

const ENDPOINT = process.env.CF_TURN_ENDPOINT || 'https://rtc.live.cloudflare.com/v1/turn/keys'

function clean(list: unknown): IceServer[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const urls = (Array.isArray(raw.urls) ? raw.urls : [raw.urls])
      .filter((url): url is string => typeof url === 'string')
      // Tarayıcılar 53 numaralı portu engelleyebilir; bekleme yaratmasın diye çıkarılır.
      .filter((url) => !/:53(\?|$)/.test(url))
    if (urls.length === 0) return []
    return [
      {
        urls,
        ...(typeof raw.username === 'string' ? { username: raw.username } : {}),
        ...(typeof raw.credential === 'string' ? { credential: raw.credential } : {}),
      },
    ]
  })
}

async function fetchCloudflare(): Promise<Cache | null> {
  const { keyId, token, ttl } = config.cloudflare
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(`${ENDPOINT}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl }),
      signal: controller.signal,
    })
    if (!response.ok) {
      lastError = `Cloudflare TURN ${response.status}: ${(await response.text()).slice(0, 200)}`
      return null
    }
    const body = (await response.json()) as { iceServers?: unknown }
    const servers = clean(Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers])
    if (!servers.some((server) => server.username && server.credential)) {
      lastError = 'Cloudflare TURN yanıtında kimlik bilgisi yok'
      return null
    }
    const now = Date.now()
    lastError = ''
    return { servers, fetchedAt: now, expiresAt: now + ttl * 1000 }
  } catch (error) {
    lastError = `Cloudflare TURN'e ulaşılamadı: ${error instanceof Error ? error.message : String(error)}`
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Kimlikler TTL'nin dörtte biri dolunca yenilenir; böylece istemciye verilen kimlik en az 3/4 TTL geçerlidir. */
async function cloudflareServers() {
  const now = Date.now()
  const fresh = cache && now - cache.fetchedAt < (config.cloudflare.ttl * 1000) / 4
  if (fresh) return cache!.servers
  // Son deneme başarısızsa bir dakika beklenir; sayfa açılışları Cloudflare'i beklemez.
  if (failedAt && now - failedAt < RETRY_MS) return cache && cache.expiresAt - now > 60 * 60 * 1000 ? cache.servers : null
  if (!inflight) {
    inflight = fetchCloudflare().finally(() => {
      inflight = null
    })
  }
  const next = await inflight
  if (next) {
    cache = next
    failedAt = 0
  } else if (!failedAt || now - failedAt >= RETRY_MS) {
    failedAt = Date.now()
    console.error(`Cloudflare TURN kullanılamıyor, yedek bağlantı kullanılıyor. ${lastError}`)
  }
  if (cache && cache.expiresAt - now > 60 * 60 * 1000) return cache.servers
  return null
}

/** /api/ice yanıtı: Cloudflare çalışıyorsa Cloudflare + STUN, çalışmıyorsa yerel TURN + STUN. */
export async function resolveIceServers(requestHost?: string, allowLocalTurn = true): Promise<IceServer[]> {
  const local = iceServers(requestHost, allowLocalTurn && config.turn.enabled)
  if (config.iceOverride || !config.cloudflare.enabled) return local
  const cloudflare = await cloudflareServers()
  if (!cloudflare) return local
  const hasStun = cloudflare.some((server) => [server.urls].flat().some((url) => url.startsWith('stun:')))
  return hasStun ? cloudflare : [...cloudflare, publicStun]
}

export function iceStatus() {
  return {
    turn: config.cloudflare.enabled ? 'cloudflare' : config.turn.enabled ? 'local' : 'none',
    localFallback: config.turn.enabled,
    cloudflareReady: Boolean(cache && cache.expiresAt > Date.now()),
    ...(lastError ? { error: lastError } : {}),
  }
}

/** Açılışta bir kez dener; yanlış anahtar varsa hemen konsolda görünür. */
export async function checkCloudflare() {
  if (!config.cloudflare.enabled) return
  if (await cloudflareServers()) console.log('Cloudflare TURN hazır.')
}
