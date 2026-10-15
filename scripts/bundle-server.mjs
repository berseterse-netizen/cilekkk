import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'

await mkdir(new URL('../build/', import.meta.url), { recursive: true })

await build({
  entryPoints: ['server/prod.ts'],
  outfile: 'build/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['ws', 'selfsigned', 'node-turn'],
  logLevel: 'info',
})
