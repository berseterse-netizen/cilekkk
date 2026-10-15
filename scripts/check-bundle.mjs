// Derleme sonrası hızlı kontrol: kritik özelliklerin pakette olduğundan emin olur.
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const assets = readdirSync(new URL('assets/', dist))
const js = assets.filter((name) => name.endsWith('.js')).map((name) => readFileSync(new URL(`assets/${name}`, dist), 'utf8')).join('\n')
const css = assets.filter((name) => name.endsWith('.css')).map((name) => readFileSync(new URL(`assets/${name}`, dist), 'utf8')).join('\n')
const sw = readFileSync(new URL('sw.js', dist), 'utf8')

const checks = {
  echoCancellation: js.includes('echoCancellation'),
  noiseSuppression: js.includes('noiseSuppression'),
  restrictOwnAudio: js.includes('restrictOwnAudio'),
  effectsPipeline: js.includes('webgl2'),
  portraitLazyChunk: assets.some((name) => name.startsWith('vision_bundle')),
  mediapipeWasm: existsSync(new URL('mediapipe/vision_wasm_internal.wasm', dist)),
  manifest: existsSync(new URL('manifest.webmanifest', dist)),
  serviceWorkerVersioned: !sw.includes('__CILEK_BUILD__'),
  darkMode: css.includes('prefers-color-scheme'),
  compressed: assets.some((name) => name.endsWith('.br')),
}
console.log(JSON.stringify(checks, null, 2))
const failed = Object.entries(checks).filter(([, value]) => value === false)
if (failed.length) process.exit(1)
