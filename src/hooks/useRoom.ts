import { useCallback, useEffect, useRef, useState } from 'react'

export type RoomStatus = 'idle' | 'connecting' | 'in' | 'locked' | 'bad-invite' | 'missing' | 'error'

export type ChatLine = {
  id: string
  text: string
  name: string
  self: boolean
  at: number
}

export type RoomEntry = {
  code: string
  invite: string
  create: boolean
}

/** echo: yayın sistem sesi içeriyor ve görüşme sesi ayrılamıyor (izleyen tarafta ses bastırma açılır). */
export type PeerState = { mic: boolean; cam: boolean; screen: boolean; deaf: boolean; echo: boolean }

export type Peer = {
  session: string
  name: string
  epoch: number
  state: PeerState
}

export type Reaction = { id: number; from: string; name: string; emoji: string }

const sessionPattern = /^[A-Za-z0-9-]{16,64}$/

function readStorage(key: string) {
  try {
    return sessionStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeStorage(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* depolama kapalı olabilir */
  }
}

function removeStorage(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* yoksay */
  }
}

function readSession(key: string) {
  const existing = readStorage(key)
  return sessionPattern.test(existing) ? existing : ''
}

function newId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function socketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/cilek`
}

function asLines(value: unknown): ChatLine[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const line = item as Record<string, unknown>
    if (typeof line.id !== 'string' || typeof line.text !== 'string') return []
    return [
      {
        id: line.id,
        text: line.text,
        name: typeof line.name === 'string' ? line.name : 'çilek',
        self: line.self === true,
        at: typeof line.at === 'number' ? line.at : Date.now(),
      },
    ]
  })
}

function asPeers(value: unknown): Peer[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    if (typeof raw.session !== 'string') return []
    const state = (raw.state && typeof raw.state === 'object' ? raw.state : {}) as Record<string, unknown>
    return [
      {
        session: raw.session,
        name: typeof raw.name === 'string' && raw.name ? raw.name : 'misafir',
        epoch: typeof raw.epoch === 'number' ? raw.epoch : 0,
        state: { mic: state.mic === true, cam: state.cam === true, screen: state.screen === true, deaf: state.deaf === true, echo: state.echo === true },
      },
    ]
  })
}

const closeCodes = new Set([4000, 4001, 4002, 4003, 4004])

export function useRoom(entry: RoomEntry | null, name: string, state: PeerState) {
  const code = entry?.code ?? ''
  const invite = entry?.invite ?? ''
  const create = Boolean(entry?.create)
  const enabled = create || code.length > 0 || invite.length > 0
  const [status, setStatus] = useState<RoomStatus>('idle')
  const [messages, setMessages] = useState<ChatLine[]>([])
  const [peers, setPeers] = useState<Peer[]>([])
  const [roomCode, setRoomCode] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [session, setSession] = useState('')
  const [selfName, setSelfName] = useState('')
  const [reconnecting, setReconnecting] = useState(false)
  const signalRef = useRef<(from: string, data: unknown, epoch: number) => void>(() => {})
  const reactionRef = useRef<(reaction: Reaction) => void>(() => {})
  const wsRef = useRef<WebSocket | null>(null)
  const codeRef = useRef('')
  const inviteKeyRef = useRef('')
  const statusRef = useRef<RoomStatus>('idle')
  const intentional = useRef(false)
  const nameRef = useRef(name)
  const stateRef = useRef(state)
  const reactionId = useRef(0)
  nameRef.current = name
  stateRef.current = state

  function updateStatus(next: RoomStatus) {
    statusRef.current = next
    setStatus(next)
  }

  const sendRaw = useCallback((message: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || statusRef.current !== 'in') return false
    ws.send(JSON.stringify(message))
    return true
  }, [])

  useEffect(() => {
    if (!enabled) {
      updateStatus('idle')
      setMessages([])
      setPeers([])
      setRoomCode('')
      setSession('')
      setInviteLink(null)
      setDetail('')
      setReconnecting(false)
      return
    }

    intentional.current = false
    updateStatus('connecting')
    setMessages([])
    setPeers([])
    setSession('')
    setInviteLink(null)
    setDetail('')
    let currentSession = invite
      ? readSession(`cilek-invite:${invite}`) || newId()
      : code
        ? readSession(`cilek-session:${code}`) || newId()
        : newId()
    inviteKeyRef.current = invite ? `cilek-invite:${invite}` : ''
    if (code) codeRef.current = code
    let cancelled = false
    let generation = 0
    let attempts = 0
    let timer = 0
    // İlk bağlantı "create" ise yeniden bağlanırken açılan odaya "join" ile dönülür.
    let joinedCode = ''

    const connect = () => {
      const ticket = ++generation
      const ws = new WebSocket(socketUrl())
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled || intentional.current || ticket !== generation) {
          ws.close()
          return
        }
        const base = { session: currentSession, name: nameRef.current, state: stateRef.current }
        if (joinedCode) ws.send(JSON.stringify({ type: 'join', code: joinedCode, ...base }))
        else ws.send(JSON.stringify(create ? { type: 'create', ...base } : { type: 'join', code, invite, ...base }))
      }

      ws.onmessage = (event) => {
        if (cancelled || ticket !== generation) return
        handleMessage(event.data)
      }

      ws.onclose = (event) => {
        if (cancelled || intentional.current || ticket !== generation) return
        if (statusRef.current === 'locked' || statusRef.current === 'bad-invite' || statusRef.current === 'missing') return
        if (closeCodes.has(event.code)) {
          if (event.code === 4000 && statusRef.current === 'in') {
            setDetail('Bu oda başka bir sekmede açıldı.')
            updateStatus('error')
          }
          return
        }
        // Ağ koparsa artan aralıklarla (en çok ~10 sn) sürekli yeniden dene.
        attempts += 1
        if (statusRef.current === 'in' || joinedCode) setReconnecting(true)
        if (attempts > 8 && statusRef.current !== 'in' && !joinedCode) {
          setDetail('Sunucuya bağlanılamadı.')
          updateStatus('error')
          return
        }
        const delay = Math.min(10_000, 400 * 2 ** Math.min(attempts, 5)) + Math.random() * 300
        timer = window.setTimeout(() => {
          if (!cancelled && !intentional.current) connect()
        }, delay)
      }
    }

    const handleMessage = (payload: unknown) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(String(payload)) as Record<string, unknown>
      } catch {
        return
      }

      switch (message.type) {
        case 'joined': {
          if (typeof message.code !== 'string' || typeof message.session !== 'string') return
          attempts = 0
          joinedCode = message.code
          currentSession = message.session
          codeRef.current = message.code
          writeStorage(`cilek-session:${message.code}`, message.session)
          if (invite) writeStorage(`cilek-invite:${invite}`, message.session)
          const url = new URL(window.location.href)
          url.searchParams.delete('invite')
          url.searchParams.set('room', message.code)
          window.history.replaceState(null, '', url)
          setRoomCode(message.code)
          setSession(message.session)
          setSelfName(typeof message.name === 'string' ? message.name : '')
          setPeers(asPeers(message.members))
          setMessages(asLines(message.history))
          setDetail('')
          setReconnecting(false)
          updateStatus('in')
          return
        }
        case 'locked':
          updateStatus('locked')
          return
        case 'invite-invalid':
          updateStatus('bad-invite')
          return
        case 'missing': {
          if (code) removeStorage(`cilek-session:${code}`)
          const url = new URL(window.location.href)
          url.searchParams.delete('room')
          window.history.replaceState(null, '', url)
          updateStatus('missing')
          return
        }
        case 'peers':
          setPeers(asPeers(message.members))
          return
        case 'signal':
          if (typeof message.from === 'string') signalRef.current(message.from, message.data, typeof message.epoch === 'number' ? message.epoch : 0)
          return
        case 'chat': {
          const [line] = asLines([message])
          if (!line) return
          setMessages((current) => (current.some((item) => item.id === line.id) ? current : [...current.slice(-199), line]))
          return
        }
        case 'react':
          if (typeof message.emoji === 'string' && typeof message.from === 'string') {
            reactionId.current += 1
            reactionRef.current({
              id: reactionId.current,
              from: message.from,
              name: typeof message.name === 'string' ? message.name : '',
              emoji: message.emoji,
            })
          }
          return
        case 'invite':
          if (typeof message.urlPath === 'string') {
            setDetail('')
            setInviteLink(new URL(message.urlPath, window.location.origin).toString())
          }
          return
        case 'invite-error':
          setDetail(typeof message.message === 'string' ? message.message : 'Davet açılamadı.')
          return
        case 'error':
          if (statusRef.current !== 'in') {
            setDetail(typeof message.message === 'string' ? message.message : 'Bağlantı kurulamadı.')
            updateStatus('error')
          }
          return
      }
    }

    const wake = () => {
      // Telefon uykudan dönünce bekleme süresini atla.
      const ws = wsRef.current
      if (document.visibilityState !== 'visible' || cancelled || intentional.current) return
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
      window.clearTimeout(timer)
      connect()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)

    connect()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [enabled, code, invite, create])

  const stateKey = `${state.mic}|${state.cam}|${state.screen}|${state.deaf}|${state.echo}`
  useEffect(() => {
    if (status === 'in') sendRaw({ type: 'state', state: stateRef.current })
  }, [stateKey, status, sendRaw])

  useEffect(() => {
    const clean = name.trim()
    if (status !== 'in' || !clean || clean === selfName) return
    const timer = window.setTimeout(() => {
      if (sendRaw({ type: 'rename', name: clean })) setSelfName(clean)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [name, selfName, status, sendRaw])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, 600)
      if (trimmed) sendRaw({ type: 'chat', text: trimmed })
    },
    [sendRaw],
  )

  const sendSignal = useCallback((to: string, data: unknown) => {
    if (to) sendRaw({ type: 'signal', to, data })
  }, [sendRaw])

  const react = useCallback((emoji: string) => sendRaw({ type: 'react', emoji }), [sendRaw])

  const bindSignal = useCallback((handler: (from: string, data: unknown, epoch: number) => void) => {
    signalRef.current = handler
    return () => {
      if (signalRef.current === handler) signalRef.current = () => {}
    }
  }, [])

  const onReaction = useCallback((handler: (reaction: Reaction) => void) => {
    reactionRef.current = handler
    return () => {
      if (reactionRef.current === handler) reactionRef.current = () => {}
    }
  }, [])

  const createInvite = useCallback(() => {
    sendRaw({ type: 'invite' })
  }, [sendRaw])

  const leave = useCallback(() => {
    intentional.current = true
    const roomCode = codeRef.current
    const session = roomCode ? readStorage(`cilek-session:${roomCode}`) : ''
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'leave' }))
      ws.close()
    } else if (roomCode && session) {
      const goodbye = new WebSocket(socketUrl())
      goodbye.onopen = () => {
        goodbye.send(JSON.stringify({ type: 'join', code: roomCode, session }))
        goodbye.send(JSON.stringify({ type: 'leave' }))
      }
      window.setTimeout(() => goodbye.close(), 1500)
    } else {
      ws?.close()
    }
    if (roomCode) removeStorage(`cilek-session:${roomCode}`)
    if (inviteKeyRef.current) removeStorage(inviteKeyRef.current)
  }, [])

  return {
    status,
    messages,
    peers,
    session,
    selfName,
    roomCode,
    inviteLink,
    detail,
    reconnecting,
    send,
    sendSignal,
    bindSignal,
    onReaction,
    react,
    createInvite,
    leave,
  }
}
