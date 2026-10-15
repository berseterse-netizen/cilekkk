import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttps } from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { ensureCertificate } from './cert'
import { config, resolvePublicHost } from './config'
import { checkCloudflare, iceStatus, resolveIceServers } from './ice'
import { createHub, heartbeat } from './hub'
import { startTurn } from './turn'

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.resolve(here, '../dist')
const root = path.resolve(publicDir)

if (!existsSync(path.join(publicDir, 'index.html'))) {
  console.error('dist/index.html yok. Önce npm run build çalıştır.')
  process.exit(1)
}

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), picture-in-picture=(self)',
  'cross-origin-opener-policy': 'same-origin',
}

function fileFromPath(pathname: string) {
  const full = path.resolve(publicDir, pathname.replace(/^[/\\]+/, ''))
  if (full !== root && !full.startsWith(root + path.sep)) return null
  return full
}

function isFile(file: string) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function cacheControl(pathname: string) {
  if (pathname.startsWith('/assets/') || pathname.startsWith('/mediapipe/')) return 'public, max-age=31536000, immutable'
  if (pathname === '/sw.js' || pathname.endsWith('.html') || pathname === '/' || pathname.endsWith('.webmanifest')) return 'no-cache'
  return 'public, max-age=86400'
}

/** Derleme sırasında üretilen .br/.gz dosyası varsa onu gönderir. */
function pickEncoding(request: IncomingMessage, file: string) {
  const accepted = String(request.headers['accept-encoding'] ?? '')
  if (/\bbr\b/.test(accepted) && isFile(`${file}.br`)) return { file: `${file}.br`, encoding: 'br' }
  if (/\bgzip\b/.test(accepted) && isFile(`${file}.gz`)) return { file: `${file}.gz`, encoding: 'gzip' }
  return { file, encoding: '' }
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders })
  response.end(JSON.stringify(body))
}

function sendText(response: ServerResponse, status: number, text: string) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...securityHeaders })
  response.end(text)
}

function sendFile(request: IncomingMessage, response: ServerResponse, file: string, pathname: string) {
  const original = statSync(file)
  const etag = `W/"${original.size.toString(16)}-${Math.floor(original.mtimeMs).toString(16)}"`
  const headers: Record<string, string> = {
    'content-type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': cacheControl(pathname),
    etag,
    vary: 'accept-encoding',
    ...securityHeaders,
  }
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers)
    response.end()
    return
  }
  const chosen = pickEncoding(request, file)
  if (chosen.encoding) headers['content-encoding'] = chosen.encoding
  headers['content-length'] = String(statSync(chosen.file).size)
  response.writeHead(200, headers)
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  createReadStream(chosen.file)
    .on('error', () => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
    .pipe(response)
}

const hub = createHub()
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
heartbeat(sockets)

function handle(request: IncomingMessage, response: ServerResponse) {
  let pathname = '/'
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://cilek.local').pathname)
  } catch {
    sendText(response, 400, 'yok')
    return
  }

  if (pathname === '/api/ice') {
    void resolveIceServers(request.headers.host).then(
      (servers) => sendJson(response, 200, { iceServers: servers }),
      () => sendJson(response, 200, { iceServers: [] }),
    )
    return
  }

  if (pathname === '/healthz') {
    sendJson(response, 200, { ok: true, ...hub.stats(), ...iceStatus() })
    return
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'yok')
    return
  }

  const full = fileFromPath(pathname)
  if (!full) {
    sendText(response, 400, 'yok')
    return
  }

  let file = full
  try {
    if (statSync(full).isDirectory()) file = path.join(full, 'index.html')
  } catch {
    /* dosya yok; aşağıda karar verilir */
  }

  if (!isFile(file)) {
    const extension = path.extname(pathname)
    if (extension && extension !== '.html') {
      sendText(response, 404, 'yok')
      return
    }
    file = path.join(publicDir, 'index.html')
    pathname = '/index.html'
  }

  sendFile(request, response, file, pathname)
}

async function createWebServer() {
  if (config.tls.mode === 'off') return createHttp(handle)
  const credentials =
    config.tls.mode === 'file'
      ? { cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile) }
      : await ensureCertificate(path.resolve(here, '../certs'), config.publicHost)
  return createHttps(credentials, handle)
}

await resolvePublicHost()

const server = await createWebServer()

server.on('upgrade', (request, socket, head) => {
  const pathname = (request.url ?? '').split('?')[0]
  if (pathname !== '/cilek') {
    socket.destroy()
    return
  }
  try {
    sockets.handleUpgrade(request, socket, head, (ws) => {
      sockets.emit('connection', ws, request)
      hub.connect(ws)
    })
  } catch {
    socket.destroy()
  }
})

server.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

startTurn()
void checkCloudflare()

server.listen(config.port, config.host, () => {
  const scheme = config.tls.mode === 'off' ? 'http' : 'https'
  console.log(`çilek hazır: ${scheme}://${config.publicHost || 'localhost'}:${config.port}`)
  if (config.tls.mode === 'self') {
    console.log('Kendinden imzalı sertifika kullanılıyor. Tarayıcı uyarısında Gelişmiş deyip devam et.')
    console.log('Uygulama olarak yüklemek için gerçek bir sertifika gerekir (CERT_FILE ve KEY_FILE).')
  }
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    sockets.close()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  })
}
