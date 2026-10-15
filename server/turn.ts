import { createRequire } from 'node:module'
import os from 'node:os'
import { isIP } from 'node:net'
import { config } from './config'

const require = createRequire(import.meta.url)

function relayAddresses() {
  const addresses: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      const version = item.family as string | number
      const ipv4 = version === 'IPv4' || version === 4
      if (!item.internal && ipv4) addresses.push(item.address)
    }
  }
  return addresses.length > 0 ? addresses : ['0.0.0.0']
}

export function startTurn() {
  const turnConfig = config.turn
  if (!turnConfig.enabled) return
  try {
    const Turn = require('node-turn') as new (options: Record<string, unknown>) => { start: () => void }
    const turn = new Turn({
      listeningPort: turnConfig.port,
      listeningIps: ['0.0.0.0'],
      relayIps: relayAddresses(),
      ...(isIP(config.publicHost) ? { externalIps: config.publicHost } : {}),
      minPort: turnConfig.minPort,
      maxPort: Math.max(turnConfig.minPort, turnConfig.maxPort),
      authMech: 'long-term',
      credentials: { [turnConfig.user]: turnConfig.pass },
      realm: 'cilek',
      debugLevel: 'ERROR',
    })
    turn.start()
    console.log(`ses ve görüntü aktarımı (TURN) hazır: ${turnConfig.port}`)
  } catch (error) {
    console.error('ses aktarımı (TURN) açılmadı', error)
  }
}
