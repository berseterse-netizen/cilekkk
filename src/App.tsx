import { useCallback, useEffect, useMemo, useState } from 'react'
import { Lobby } from './components/Lobby'
import { Notice } from './components/Notice'
import { Room } from './components/Room'
import { useCall } from './hooks/useCall'
import { useInstall } from './hooks/useInstall'
import { useLocalMedia, type ScreenQuality } from './hooks/useLocalMedia'
import { useRoom, type RoomEntry } from './hooks/useRoom'
import { useWakeLock } from './hooks/useWakeLock'
import { loadIceServers } from './lib/ice'
import { normalizeRoomCode } from './lib/room'

function entryFromLocation(): RoomEntry | null {
  const params = new URLSearchParams(window.location.search)
  if ((params.get('invite') ?? '').trim()) return null
  const code = normalizeRoomCode(params.get('room') ?? '')
  if (code.length === 6) return { code, invite: '', create: false }
  return null
}

export default function App() {
  const [inviteOffer, setInviteOffer] = useState(() => {
    const raw = new URLSearchParams(window.location.search).get('invite') ?? ''
    return raw.trim().slice(0, 128)
  })
  const [entry, setEntry] = useState<RoomEntry | null>(entryFromLocation)
  const [ice, setIce] = useState<RTCIceServer[] | null>(null)
  const [screenQuality, setScreenQuality] = useState<ScreenQuality>({ height: 1080, fps: 30 })
  const media = useLocalMedia()
  const install = useInstall()
  const presence = useMemo(
    () => ({ mic: media.micOn && !media.deafened, cam: media.camOn, screen: media.sharing, deaf: media.deafened, echo: media.screenEcho }),
    [media.micOn, media.deafened, media.camOn, media.sharing, media.screenEcho],
  )
  const room = useRoom(entry, media.prefs.name.trim(), presence)
  const inRoom = room.status === 'in'
  const remotes = useMemo(() => room.peers.map((peer) => ({ id: peer.session, epoch: peer.epoch })), [room.peers])
  const { calls, sending } = useCall({
    active: inRoom,
    selfId: room.session,
    remotes,
    iceServers: ice,
    mic: media.outgoingMic,
    camera: media.videoTrack,
    screen: media.screenStream,
    cameraQuality: media.prefs.quality,
    screenQuality,
    sendSignal: room.sendSignal,
    bindSignal: room.bindSignal,
  })
  useWakeLock(inRoom)

  useEffect(() => {
    if (!entry) return
    void loadIceServers().then(setIce)
    // Uzun görüşmelerde TURN kimlikleri tazelenir (bağlantı kopup yenilenirse geçerli kimlik kullanılır).
    const timer = window.setInterval(() => void loadIceServers().then(setIce), 30 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [entry])

  useEffect(() => {
    if (room.status === 'locked' || room.status === 'bad-invite' || room.status === 'missing') media.stopAll()
  }, [room.status, media.stopAll])

  // Odaya bağlantıyla doğrudan gelindiyse (ör. ?room=…) medya burada başlar; start tek sefer çalışır.
  useEffect(() => {
    if (inRoom) void media.start()
  }, [inRoom, media.start])

  const goLobby = useCallback(() => {
    room.leave()
    media.stopAll()
    setEntry(null)
    setInviteOffer('')
    const url = new URL(window.location.href)
    url.search = ''
    window.history.replaceState(null, '', url)
    document.title = 'çilek'
  }, [room.leave, media.stopAll])

  function enter(next: RoomEntry) {
    setEntry(next)
    void media.start()
  }

  if (room.status === 'locked') {
    return <Notice title="Oda dolu" copy="Bu odada zaten iki kişi var. Üçüncü kişi yalnızca davet bağlantısıyla girebilir." action="Geri dön" onAction={goLobby} />
  }

  if (room.status === 'bad-invite') {
    return <Notice title="Davet geçersiz" copy="Bu davet kullanılmış ya da süresi dolmuş. Her davet tek kişiliktir." action="Geri dön" onAction={goLobby} />
  }

  if (room.status === 'missing') {
    return <Notice title="Bu oda kapalı" copy="Bu kodla açık bir oda yok. Yeni bir oda açmak için Oda aç’a dokun." action="Geri dön" onAction={goLobby} />
  }

  if (!entry) {
    return (
      <Lobby
        inviteReady={inviteOffer.length > 0}
        name={media.prefs.name}
        joinWithCam={media.prefs.joinWithCam}
        joinWithMic={media.prefs.joinWithMic}
        install={install}
        onName={media.setName}
        onJoinDefaults={media.setJoinDefaults}
        onCreate={() => enter({ code: '', invite: '', create: true })}
        onJoin={(code) => enter({ code, invite: '', create: false })}
        onAcceptInvite={() => enter({ code: '', invite: inviteOffer, create: false })}
      />
    )
  }

  if (room.status === 'error' && !room.roomCode) {
    return <Notice title="Bağlanılamadı" copy={room.detail || 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.'} action="Geri dön" onAction={goLobby} />
  }

  if (!inRoom && room.status !== 'error') {
    return <Notice title="Bir saniye" copy="Odaya bağlanıyorum…" action="Vazgeç" onAction={goLobby} busy />
  }

  return (
    <Room
      code={room.roomCode || entry.code}
      media={media}
      room={room}
      calls={calls}
      sending={sending}
      screenQuality={screenQuality}
      install={install}
      onScreenQuality={setScreenQuality}
      onLeave={goLobby}
    />
  )
}
