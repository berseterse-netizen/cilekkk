export type Member = {
  id: string
  name: string
  self: boolean
  camera: MediaStream | null
  screen: MediaStream | null
  mic: MediaStreamTrack | null
  micOn: boolean
  camOn: boolean
  live: boolean
  deaf: boolean
  connection: RTCPeerConnectionState | 'self'
  rtt: number | null
  relayed: boolean
  echo: boolean
}

export type Popover = 'none' | 'effects' | 'screen' | 'react'
export type SideTab = 'chat' | 'people'

export const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🍓', '🎉', '😢'] as const

export function initials(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
  return (Array.from(letters).slice(0, 2).join('') || '🍓').toLocaleUpperCase('tr-TR')
}

export function signalLevel(member: Member): 0 | 1 | 2 | 3 {
  if (member.self) return 3
  if (member.connection !== 'connected') return 0
  if (member.rtt === null || member.rtt < 150) return 3
  if (member.rtt < 350) return 2
  return 1
}

export function connectionLabel(member: Member) {
  switch (member.connection) {
    case 'self':
    case 'connected':
      return member.rtt === null ? 'bağlı' : `${member.rtt} ms`
    case 'new':
    case 'connecting':
      return 'bağlanıyor…'
    case 'disconnected':
      return 'bağlantı zayıf'
    case 'failed':
      return 'bağlantı koptu'
    default:
      return 'bekleniyor'
  }
}
