import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { cilekRelay } from './server/relay'

const wasmDir = path.resolve('node_modules/@mediapipe/tasks-vision/wasm')
const wasmFiles = /^vision_wasm_(nosimd_)?internal\.(js|wasm)$/

/** Portre modu için MediaPipe dosyalarını kendi sunucumuzdan verir (dış CDN gerekmez). */
function mediapipeAssets(): Plugin {
  return {
    name: 'cilek-mediapipe',
    configureServer(server) {
      server.middlewares.use('/mediapipe', (request, response, next) => {
        const name = path.basename((request.url ?? '').split('?')[0] ?? '')
        const file = path.join(wasmDir, name)
        if (!wasmFiles.test(name) || !existsSync(file)) return next()
        response.setHeader('content-type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8')
        createReadStream(file).pipe(response)
      })
    },
    generateBundle() {
      if (!existsSync(wasmDir)) return
      for (const name of readdirSync(wasmDir)) {
        if (!wasmFiles.test(name)) continue
        this.emitFile({ type: 'asset', fileName: `mediapipe/${name}`, source: readFileSync(path.join(wasmDir, name)) })
      }
    },
  }
}

/** Her derlemede hizmet çalışanının sürümünü değiştirir; kullanıcılar yeni sürümü hemen alır. */
function serviceWorkerVersion(): Plugin {
  let outDir = 'dist'
  return {
    name: 'cilek-sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    writeBundle() {
      const file = path.resolve(outDir, 'sw.js')
      if (!existsSync(file)) return
      const stamp = Date.now().toString(36)
      writeFileSync(file, readFileSync(file, 'utf8').replace('__CILEK_BUILD__', stamp))
    },
  }
}

export default defineConfig({
  plugins: [react(), cilekRelay(), mediapipeAssets(), serviceWorkerVersion()],
  define: {
    __CILEK_LOCAL_MODEL__: JSON.stringify(existsSync(path.resolve('public/models/selfie_segmenter_landscape.tflite'))),
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
  },
})
