import { existsSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import os from 'node:os'
import path from 'node:path'

export type IceServer = { urls: string | string[]; username?: string; credential?: string }

/** Proje kökündeki .env dosyasını okur; ortamda zaten tanımlı değişkenleri ezmez. */
function loadEnvFile() {
  const file = path.resolve(process.cwd(), '.env')
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const split = line.indexOf('=')
    if (split <= 0) continue
    const key = line.slice(0, split).trim()
    let value = line.slice(split + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile()

function envText(name: string, fallback: string) {
  const raw = process.env[name]
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim()
}

function envInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    console.error(`${name} geçersiz: ${raw}. ${min} ile ${max} arasında bir tam sayı olmalı.`)
    process.exit(1)
  }
  return parsed
}

function envFlag(name: string, fallback: boolean) {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  return !['0', 'false', 'no', 'off', 'hayir', 'hayır'].includes(raw.trim().toLowerCase())
}

const cloudflareKeyId = envText('CF_TURN_KEY_ID', '')
const cloudflareToken = envText('CF_TURN_API_TOKEN', '')
const cloudflareEnabled = Boolean(cloudflareKeyId && cloudflareToken)

const certFile = envText('CERT_FILE', '')
const keyFile = envText('KEY_FILE', '')

export const config = {
  port: envInt('PORT', 38471, 1, 65535),
  /** Sunucunun dinlediği arayüz. Varsayılan tüm arayüzler. */
  host: envText('HOST', '0.0.0.0'),
  /**
   * Kullanıcıların eriştiği genel adres (IP ya da alan adı). Sertifika ve TURN için kullanılır.
   * Boşsa açılışta resolvePublicHost kendi dış IP'sini bulur.
   */
  publicHost: envText('PUBLIC_HOST', ''),
  tls: {
    /** self: kendinden imzalı, file: CERT_FILE/KEY_FILE, off: düz http (ters vekil arkasında) */
    mode: !envFlag('HTTPS', true) ? ('off' as const) : certFile && keyFile ? ('file' as const) : ('self' as const),
    certFile,
    keyFile,
  },
  /** Cloudflare TURN ayarlıysa önce o kullanılır; yerel TURN yalnızca yedek olarak bekler. */
  cloudflare: {
    enabled: cloudflareEnabled,
    keyId: cloudflareKeyId,
    token: cloudflareToken,
    ttl: envInt('CF_TURN_TTL', 86_400, 600, 172_800),
  },
  turn: {
    enabled: envFlag('TURN', true),
    port: envInt('TURN_PORT', 3478, 1, 65535),
    user: envText('TURN_USER', 'cilek'),
    pass: envText('TURN_PASS', 'cilek-ses'),
    minPort: envInt('TURN_MIN_PORT', 49160, 1024, 65535),
    maxPort: envInt('TURN_MAX_PORT', 49180, 1024, 65535),
  },
  iceOverride: envText('ICE_SERVERS', ''),
}

export const publicStun: IceServer = { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }

/** Otomatik bulunamazsa kullanılan adres. VDS değişince asıl kaynak yine otomatik keşif. */
const fallbackPublicHost = '13.53.198.78'

function isPrivateIpv4(address: string) {
  const [a, b] = address.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function publicIpv4FromInterfaces() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      const family = item.family as string | number
      const ipv4 = family === 'IPv4' || family === 4
      if (item.internal || !ipv4 || isIP(item.address) !== 4 || isPrivateIpv4(item.address)) continue
      return item.address
    }
  }
  return ''
}

async function lookupPublicIpv4() {
  const urls = ['https://api.ipify.org', 'https://checkip.amazonaws.com', 'https://ifconfig.me/ip']
  const attempts = urls.map(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) throw new Error(String(response.status))
    const text = (await response.text()).trim()
    if (isIP(text) !== 4 || isPrivateIpv4(text)) throw new Error('geçersiz')
    return text
  })
  try {
    return await Promise.any(attempts)
  } catch {
    return ''
  }
}

/** PUBLIC_HOST boşsa dış IP'yi ağ kartından ya da bir IP servisinden bulur. */
export async function resolvePublicHost() {
  if (config.publicHost) {
    console.log(`Genel adres PUBLIC_HOST ile sabit: ${config.publicHost}`)
    return
  }
  const fromNic = publicIpv4FromInterfaces()
  if (fromNic) {
    config.publicHost = fromNic
    console.log(`Genel adres ağ kartından bulundu: ${fromNic}`)
    return
  }
  const lookedUp = await lookupPublicIpv4()
  if (lookedUp) {
    config.publicHost = lookedUp
    console.log(`Genel adres otomatik bulundu: ${lookedUp}`)
    return
  }
  config.publicHost = fallbackPublicHost
  console.log(`Genel adres bulunamadı, yedek kullanılıyor: ${fallbackPublicHost}`)
}

function hostOnly(value: string) {
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1)
  return value.split(':')[0] ?? value
}

/** İstemcinin kullanacağı STUN/TURN listesi. ICE_SERVERS (JSON) her şeyi ezer. */
export function iceServers(requestHost?: string, withTurn = config.turn.enabled): IceServer[] {
  const turn = config.turn
  if (config.iceOverride) {
    try {
      const source = config.iceOverride.startsWith('[') ? config.iceOverride : readFileSync(config.iceOverride, 'utf8')
      const parsed = JSON.parse(source) as IceServer[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch {
      console.error('ICE_SERVERS okunamadı, varsayılan liste kullanılıyor.')
    }
  }
  const list: IceServer[] = [publicStun]
  if (withTurn) {
    const host = config.publicHost || hostOnly(requestHost ?? '')
    if (host) {
      list.push({
        urls: [`turn:${host}:${turn.port}?transport=udp`, `turn:${host}:${turn.port}?transport=tcp`],
        username: turn.user,
        credential: turn.pass,
      })
    }
  }
  return list
}
