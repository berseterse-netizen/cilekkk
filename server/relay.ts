import type { Plugin } from 'vite'
import { WebSocketServer } from 'ws'
import { resolveIceServers } from './ice'
import { createHub, heartbeat } from './hub'

/** Geliştirme sunucusuna sinyal soketini ve /api/ice uç noktasını ekler. */
export function cilekRelay(): Plugin {
  return {
    name: 'cilek-relay',
    configureServer(server) {
      const hub = createHub()
      const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
      heartbeat(wss)
      server.middlewares.use('/api/ice', (request, response) => {
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.setHeader('cache-control', 'no-store')
        // Geliştirmede yerel TURN çalışmaz; yalnızca STUN gönderilir.
        void resolveIceServers(request.headers.host, false).then(
          (servers) => response.end(JSON.stringify({ iceServers: servers })),
          () => response.end(JSON.stringify({ iceServers: [] })),
        )
      })
      server.httpServer?.on('upgrade', (request, socket, head) => {
        const pathname = (request.url ?? '').split('?')[0]
        if (pathname !== '/cilek') return
        try {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request)
            hub.connect(ws)
          })
        } catch {
          socket.destroy()
        }
      })
    },
  }
}
