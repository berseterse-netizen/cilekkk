export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6

export function makeRoomCode() {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('')
}

export function normalizeRoomCode(raw: string) {
  const fromLink = raw.match(/[?&]room=([a-z0-9]+)/i)?.[1] ?? raw
  return fromLink
    .toUpperCase()
    .split('')
    .filter((char) => ROOM_ALPHABET.includes(char))
    .join('')
    .slice(0, ROOM_CODE_LENGTH)
}

export function roomLink(code: string) {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('room', code)
  return url.toString()
}
