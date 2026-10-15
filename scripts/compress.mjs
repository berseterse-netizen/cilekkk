// Derlenen dosyaların .br ve .gz kopyalarını üretir; sunucu bunları doğrudan gönderir.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const root = path.resolve('dist')
const compressible = /\.(js|mjs|css|html|svg|json|webmanifest|wasm|txt)$/

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

let saved = 0
for (const file of walk(root)) {
  if (!compressible.test(file)) continue
  const source = readFileSync(file)
  if (source.length < 1024) continue
  const big = source.length > 4 * 1024 * 1024
  const br = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: big ? 9 : 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  })
  const gz = gzipSync(source, { level: 9 })
  if (br.length < source.length) writeFileSync(`${file}.br`, br)
  if (gz.length < source.length) writeFileSync(`${file}.gz`, gz)
  saved += source.length - Math.min(br.length, source.length)
}
console.log(`sıkıştırma tamam: ~${(saved / 1024 / 1024).toFixed(1)} MB tasarruf`)
