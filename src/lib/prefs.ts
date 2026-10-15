import { BACKGROUNDS, FILTERS, type BackgroundId, type Effects, type FilterId } from './effects/filters'

export type CameraQuality = 360 | 720 | 1080

export type Prefs = {
  name: string
  micId: string
  camId: string
  speakerId: string
  echo: boolean
  noise: boolean
  agc: boolean
  micVolume: number
  remoteVolume: number
  quality: CameraQuality
  mirror: boolean
  joinWithCam: boolean
  joinWithMic: boolean
  effects: Effects
}

export const defaultEffects: Effects = { filter: 'none', background: 'none', brightness: 0, smooth: 0 }

export const defaultPrefs: Prefs = {
  name: '',
  micId: '',
  camId: '',
  speakerId: '',
  echo: true,
  noise: true,
  agc: true,
  micVolume: 100,
  remoteVolume: 100,
  quality: 720,
  mirror: true,
  joinWithCam: true,
  joinWithMic: true,
  effects: defaultEffects,
}

const KEY = 'cilek-prefs'

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function text(value: unknown, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function num(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function effectsFrom(value: unknown): Effects {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const filter = FILTERS.some((item) => item.id === raw.filter) ? (raw.filter as FilterId) : 'none'
  const background = BACKGROUNDS.some((item) => item.id === raw.background) ? (raw.background as BackgroundId) : 'none'
  return {
    filter,
    background,
    brightness: num(raw.brightness, 0, -0.5, 0.5),
    smooth: num(raw.smooth, 0, 0, 1),
  }
}

export function loadPrefs(): Prefs {
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>
  } catch {
    raw = {}
  }
  const quality = raw.quality === 360 || raw.quality === 1080 ? raw.quality : 720
  return {
    name: text(raw.name, 24),
    micId: text(raw.micId),
    camId: text(raw.camId),
    speakerId: text(raw.speakerId),
    echo: bool(raw.echo, true),
    noise: bool(raw.noise, true),
    agc: bool(raw.agc, true),
    micVolume: num(raw.micVolume, 100, 0, 200),
    remoteVolume: num(raw.remoteVolume, 100, 0, 100),
    quality,
    mirror: bool(raw.mirror, true),
    joinWithCam: bool(raw.joinWithCam, true),
    joinWithMic: bool(raw.joinWithMic, true),
    effects: effectsFrom(raw.effects),
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* gizli pencerede depolama kapalı olabilir */
  }
}
