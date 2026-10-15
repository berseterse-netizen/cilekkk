import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import path from 'node:path'
import selfsigned from 'selfsigned'

/** Kendinden imzalı sertifikayı üretir; genel adres değişirse yeniler. */
export async function ensureCertificate(directory: string, publicHost: string) {
  const dir = path.resolve(directory)
  const certPath = path.join(dir, 'cert.pem')
  const keyPath = path.join(dir, 'key.pem')
  const hostsPath = path.join(dir, 'hosts.txt')
  const names = ['localhost', '127.0.0.1', publicHost].filter((item, index, list) => item && list.indexOf(item) === index)
  const wanted = names.join(',')
  const previous = existsSync(hostsPath) ? readFileSync(hostsPath, 'utf8').trim() : ''
  const stale = existsSync(hostsPath) && previous !== wanted
  if (!existsSync(certPath) || !existsSync(keyPath) || stale) {
    mkdirSync(dir, { recursive: true })
    const pems = await selfsigned.generate([{ name: 'commonName', value: publicHost || 'cilek' }], {
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: names.map((name) => (isIP(name) ? { type: 7 as const, ip: name } : { type: 2 as const, value: name })),
        },
      ],
    })
    writeFileSync(keyPath, pems.private)
    writeFileSync(certPath, pems.cert)
  }
  writeFileSync(hostsPath, wanted)
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
}
