import { randomBytes, randomUUID } from 'node:crypto'
import type { WebSocket, WebSocketServer } from 'ws'
import { makeRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from '../src/lib/room'

const NAMES = ['çilek', 'yaprak', 'çekirdek', 'krem', 'bal', 'nane', 'tarçın', 'vanilya']
const CLIENT_SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHAT_LIMIT = 8
const CHAT_WINDOW_MS = 5_000
const REACT_LIMIT = 6
const REACT_WINDOW_MS = 3_000
const MAX_UNUSED_INVITES = 10
const HISTORY_LIMIT = 80
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000
const INVITE_TTL_MS = 24 * 60 * 60 * 1000
const SWEEP_MS = 5 * 60 * 1000
const REACTIONS = new Set(['👍', '❤️', '😂', '😮', '👏', '🍓', '🎉', '😢'])

type MemberState = { mic: boolean; cam: boolean; screen: boolean; deaf: boolean; echo: boolean }

type Member = {
  session: string
  name: string
  socket: WebSocket | null
  epoch: number
  left: boolean
  state: MemberState
  chatTimes: number[]
  reactTimes: number[]
}

type Invite = {
  roomCode: string
  used: boolean
  session: string
  createdAt: number
}

type HistoryItem = {
  id: string
  text: string
  session: string
  name: string
  at: number
}

type Room = {
  code: string
  locked: boolean
  members: Member[]
  history: HistoryItem[]
  emptySince: number
}

type Outbound = Record<string, unknown>

function occupied(room: Room) {
  return room.members.filter((member) => !member.left).length
}

function send(socket: WebSocket, message: Outbound) {
  if (socket.readyState !== 1) return
  try {
    socket.send(JSON.stringify(message))
  } catch {
    /* soket kapanırken yazmak süreci düşürmesin */
  }
}

function syncLock(room: Room) {
  room.locked = occupied(room) >= 2
}

function allow(times: number[], limit: number, windowMs: number) {
  const now = Date.now()
  while (times.length && now - times[0]! >= windowMs) times.shift()
  if (times.length >= limit) return false
  times.push(now)
  return true
}

function textOf(raw: unknown) {
  if (typeof raw === 'string') return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) {
    return Buffer.concat(raw).toString('utf8')
  }
  return ''
}

/** Kontrol karakterlerini atar, boşlukları toplar, 24 karakterde keser. */
export function cleanName(raw: unknown) {
  if (typeof raw !== 'string') return ''
  return Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim())
    .slice(0, 24)
    .join('')
}

function cleanState(raw: unknown): MemberState | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  return { mic: value.mic === true, cam: value.cam === true, screen: value.screen === true, deaf: value.deaf === true, echo: value.echo === true }
}

export function createHub() {
  const rooms = new Map<string, Room>()
  const invites = new Map<string, Invite>()

  function liveMembers(room: Room) {
    return room.members.filter((member) => !member.left && member.socket?.readyState === 1)
  }

  function roster(room: Room, viewer: Member) {
    return liveMembers(room)
      .filter((person) => person !== viewer)
      .map((person) => ({ session: person.session, name: person.name, epoch: person.epoch, state: person.state }))
  }

  function broadcastPeers(room: Room) {
    const online = liveMembers(room)
    if (online.length === 0) room.emptySince = Date.now()
    for (const member of online) {
      if (!member.socket) continue
      const members = roster(room, member)
      send(member.socket, {
        type: 'peers',
        peers: members.length,
        sessions: members.map((person) => person.session),
        members,
      })
    }
  }

  function historyFor(room: Room, member: Member) {
    return room.history.slice(-50).map((item) => ({
      id: item.id,
      text: item.text,
      name: item.name,
      self: item.session === member.session,
      at: item.at,
    }))
  }

  function welcome(room: Room, member: Member, socket: WebSocket) {
    if (member.socket && member.socket !== socket && member.socket.readyState === 1) {
      member.socket.close(4000, 'replaced')
    }
    member.socket = socket
    member.epoch += 1
    const members = roster(room, member)
    send(socket, {
      type: 'joined',
      session: member.session,
      code: room.code,
      name: member.name,
      peers: members.length,
      members,
      history: historyFor(room, member),
    })
    broadcastPeers(room)
  }

  function addMember(room: Room, requested: string, name: string) {
    const claimed = requested.toLowerCase()
    const fresh = CLIENT_SESSION.test(claimed) && !room.members.some((member) => member.session === claimed)
    const member: Member = {
      session: fresh ? claimed : randomUUID(),
      name: name || NAMES[room.members.length % NAMES.length] || 'çilek',
      socket: null,
      epoch: 0,
      left: false,
      state: { mic: false, cam: false, screen: false, deaf: false, echo: false },
      chatTimes: [],
      reactTimes: [],
    }
    room.members.push(member)
    syncLock(room)
    return member
  }

  function findSession(room: Room, session: string) {
    if (!session) return undefined
    return room.members.find((member) => member.session === session && !member.left)
  }

  function admit(input: { code?: string; invite?: string; session?: string; name: string }) {
    const inviteToken = (input.invite ?? '').trim().slice(0, 128)
    const session = (input.session ?? '').trim().slice(0, 80).toLowerCase()

    if (inviteToken) {
      const invite = invites.get(inviteToken)
      if (!invite) return { type: 'bad-invite' as const }
      const room = rooms.get(invite.roomCode)
      if (!room) return { type: 'bad-invite' as const }
      if (invite.used) {
        const existing = session && invite.session === session ? findSession(room, session) : undefined
        if (existing) return { type: 'ok' as const, room, member: existing }
        return { type: 'bad-invite' as const }
      }
      const existing = findSession(room, session)
      if (existing) return { type: 'ok' as const, room, member: existing }
      const member = addMember(room, session, input.name)
      invite.used = true
      invite.session = member.session
      return { type: 'ok' as const, room, member }
    }

    const code = normalizeRoomCode((input.code ?? '').slice(0, 200))
    if (code.length !== ROOM_CODE_LENGTH) return { type: 'bad-code' as const }
    const room = rooms.get(code)
    if (!room) return { type: 'missing' as const }
    const existing = findSession(room, session)
    if (existing) return { type: 'ok' as const, room, member: existing }
    if (occupied(room) >= 2) {
      room.locked = true
      return { type: 'locked' as const }
    }
    return { type: 'ok' as const, room, member: addMember(room, session, input.name) }
  }

  function openRoom(session: string, name: string) {
    let code = makeRoomCode()
    for (let attempt = 0; attempt < 8 && rooms.has(code); attempt += 1) code = makeRoomCode()
    const room: Room = { code, locked: false, members: [], history: [], emptySince: Date.now() }
    rooms.set(code, room)
    return { type: 'ok' as const, room, member: addMember(room, session, name) }
  }

  function relayChat(room: Room, member: Member, text: string) {
    if (!allow(member.chatTimes, CHAT_LIMIT, CHAT_WINDOW_MS)) return
    const item: HistoryItem = {
      id: randomUUID(),
      text,
      session: member.session,
      name: member.name,
      at: Date.now(),
    }
    room.history.push(item)
    if (room.history.length > HISTORY_LIMIT) room.history.shift()
    for (const person of liveMembers(room)) {
      if (!person.socket) continue
      send(person.socket, {
        type: 'chat',
        id: item.id,
        text: item.text,
        name: item.name,
        self: person.session === member.session,
        at: item.at,
      })
    }
  }

  function sweep() {
    const now = Date.now()
    for (const [code, room] of rooms) {
      if (liveMembers(room).length > 0) continue
      if (now - room.emptySince < ROOM_IDLE_MS) continue
      rooms.delete(code)
    }
    for (const [token, invite] of invites) {
      if (!rooms.has(invite.roomCode) || (!invite.used && now - invite.createdAt > INVITE_TTL_MS)) invites.delete(token)
    }
  }

  setInterval(sweep, SWEEP_MS).unref()

  return {
    stats() {
      return { rooms: rooms.size, invites: invites.size }
    },
    connect(socket: WebSocket) {
      let room: Room | null = null
      let member: Member | null = null
      let joined = false
      socket.on('error', () => {})

      socket.on('message', (raw) => {
        let data: unknown
        try {
          const text = textOf(raw)
          if (!text || text.length > 100_000) return
          data = JSON.parse(text)
        } catch {
          return
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return
        const message = data as Record<string, unknown>

        if (!joined) {
          if (message.type !== 'join' && message.type !== 'create') return
          const session = typeof message.session === 'string' ? message.session : ''
          const name = cleanName(message.name)
          const result =
            message.type === 'create'
              ? openRoom(session, name)
              : admit({
                  code: typeof message.code === 'string' ? message.code : '',
                  invite: typeof message.invite === 'string' ? message.invite : '',
                  session,
                  name,
                })
          if (result.type === 'locked') {
            send(socket, { type: 'locked' })
            socket.close(4001, 'locked')
            return
          }
          if (result.type === 'missing') {
            send(socket, { type: 'missing' })
            socket.close(4004, 'missing')
            return
          }
          if (result.type === 'bad-invite') {
            send(socket, { type: 'invite-invalid' })
            socket.close(4002, 'invite')
            return
          }
          if (result.type === 'bad-code') {
            send(socket, { type: 'error', message: 'Kod 6 karakter olmalı.' })
            socket.close(4003, 'code')
            return
          }
          room = result.room
          member = result.member
          if (name && name !== member.name) member.name = name
          const state = cleanState(message.state)
          if (state) member.state = state
          joined = true
          welcome(room, member, socket)
          return
        }

        if (!room || !member || member.left || member.socket !== socket) return

        try {
          if (message.type === 'chat' && typeof message.text === 'string') {
            const text = message.text.trim().slice(0, 600)
            if (!text) return
            relayChat(room, member, text)
            return
          }

          if (message.type === 'state') {
            const state = cleanState(message.state)
            if (!state) return
            member.state = state
            broadcastPeers(room)
            return
          }

          if (message.type === 'rename') {
            const name = cleanName(message.name)
            if (!name || name === member.name) return
            member.name = name
            broadcastPeers(room)
            return
          }

          if (message.type === 'react' && typeof message.emoji === 'string') {
            if (!REACTIONS.has(message.emoji) || !allow(member.reactTimes, REACT_LIMIT, REACT_WINDOW_MS)) return
            for (const person of liveMembers(room)) {
              if (person === member || !person.socket) continue
              send(person.socket, { type: 'react', from: member.session, name: member.name, emoji: message.emoji })
            }
            return
          }

          if (message.type === 'invite') {
            let unused = 0
            for (const invite of invites.values()) {
              if (invite.roomCode === room.code && !invite.used) unused += 1
            }
            if (unused >= MAX_UNUSED_INVITES) {
              send(socket, { type: 'invite-error', message: 'Çok fazla açık davet var.' })
              return
            }
            const token = randomBytes(16).toString('base64url')
            invites.set(token, { roomCode: room.code, used: false, session: '', createdAt: Date.now() })
            send(socket, { type: 'invite', urlPath: `/?invite=${encodeURIComponent(token)}` })
            return
          }

          if (message.type === 'signal' && typeof message.to === 'string') {
            const data = message.data
            if (!data || typeof data !== 'object' || Array.isArray(data)) return
            const record = data as Record<string, unknown>
            const description = record.description
            const candidate = record.candidate
            if (!description && !candidate) return
            const target = room.members.find(
              (person) => person.session === message.to && !person.left && person.socket?.readyState === 1,
            )
            if (!target?.socket) return
            send(target.socket, {
              type: 'signal',
              from: member.session,
              epoch: member.epoch,
              data: {
                ...(description && typeof description === 'object' ? { description } : {}),
                ...(candidate && typeof candidate === 'object' ? { candidate } : {}),
              },
            })
            return
          }

          if (message.type === 'leave') {
            member.left = true
            if (member.socket === socket) member.socket = null
            syncLock(room)
            broadcastPeers(room)
            socket.close(1000, 'leave')
          }
        } catch {
          /* bozuk bir mesaj odayı düşürmesin */
        }
      })

      socket.on('close', () => {
        if (!room || !member) return
        if (member.socket !== socket) return
        member.socket = null
        broadcastPeers(room)
      })
    },
  }
}

/** Yanıt vermeyen soketleri düşürür; böylece "hayalet" katılımcı kalmaz. */
export function heartbeat(server: WebSocketServer, everyMs = 25_000) {
  const alive = new WeakMap<WebSocket, boolean>()
  server.on('connection', (socket) => {
    alive.set(socket, true)
    socket.on('pong', () => alive.set(socket, true))
  })
  const timer = setInterval(() => {
    for (const socket of server.clients) {
      if (alive.get(socket) === false) {
        socket.terminate()
        continue
      }
      alive.set(socket, false)
      try {
        socket.ping()
      } catch {
        socket.terminate()
      }
    }
  }, everyMs)
  timer.unref()
  server.on('close', () => clearInterval(timer))
}
