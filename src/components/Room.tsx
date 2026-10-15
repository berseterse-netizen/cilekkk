import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RemoteCall, SendStats, VideoStats } from '../hooks/useCall'
import type { LocalMedia, ScreenQuality } from '../hooks/useLocalMedia'
import type { useRoom, Reaction } from '../hooks/useRoom'
import { useSpeaking } from '../hooks/useSpeaking'
import { resumeAudio } from '../lib/audio'
import { roomLink } from '../lib/room'
import { ChatPanel } from './ChatPanel'
import { EffectsPanel } from './EffectsPanel'
import {
  CamIcon,
  ChatIcon,
  CloseIcon,
  CopyIcon,
  GearIcon,
  HeadphonesIcon,
  LeaveIcon,
  MicIcon,
  PeopleIcon,
  ScreenIcon,
  ShareIcon,
  SmileIcon,
  SparkleIcon,
} from './Icons'
import { PeoplePanel } from './PeoplePanel'
import { SettingsPanel } from './SettingsPanel'
import { StrawberryMark } from './StrawberryMark'
import { Tile } from './Tile'
import { REACTIONS, type Member, type Popover, type SideTab } from './types'
import { VideoSurface } from './VideoSurface'

type RoomState = ReturnType<typeof useRoom>

type RoomProps = {
  code: string
  media: LocalMedia
  room: RoomState
  calls: RemoteCall[]
  sending: SendStats | null
  screenQuality: ScreenQuality
  install: { canInstall: boolean; iosHint: boolean; installed: boolean; install: () => Promise<void> }
  onScreenQuality: (quality: ScreenQuality) => void
  onLeave: () => void
}

type Toast = { id: number; text: string }
type Floating = Reaction & { left: number }

const heights = [720, 1080, 1440] as const
const rates = [15, 30, 60] as const

function liveVideo(stream: MediaStream | null | undefined) {
  return !!stream?.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted)
}

const screenSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices
const sinkSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

function RemoteAudio({ stream, volume, sinkId, onBlocked }: { stream: MediaStream; volume: number; sinkId: string; onBlocked: () => void }) {
  const ref = useRef<HTMLAudioElement>(null)
  const trackKey = stream.getAudioTracks().map((track) => track.id).join('|')

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (element.srcObject !== stream) element.srcObject = stream
    if (trackKey) void element.play().catch(() => onBlocked())
  }, [stream, trackKey, onBlocked])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.volume = Math.min(1, Math.max(0, volume))
    element.muted = volume <= 0
  }, [volume])

  useEffect(() => {
    const element = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (!element || !sinkSupported) return
    void element.setSinkId?.(sinkId).catch(() => {})
  }, [sinkId])

  return <audio ref={ref} autoPlay />
}

/** Görünmez; bir üyenin konuşup konuşmadığını üst bileşene bildirir. */
function SpeakingProbe({ id, track, enabled, onSpeak }: { id: string; track: MediaStreamTrack | null; enabled: boolean; onSpeak: (id: string, speaking: boolean) => void }) {
  const speaking = useSpeaking(track, enabled)
  useEffect(() => {
    onSpeak(id, speaking)
  }, [id, speaking, onSpeak])
  useEffect(() => () => onSpeak(id, false), [id, onSpeak])
  return null
}

/** Değer true olduktan sonra belirtilen süre boyunca true kalır. */
function useHold(value: boolean, ms: number) {
  const [held, setHeld] = useState(value)
  useEffect(() => {
    if (value) {
      setHeld(true)
      return
    }
    const timer = window.setTimeout(() => setHeld(false), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return held
}

function statsLabel(stats: VideoStats | null) {
  if (!stats || !stats.height) return ''
  const rate = stats.kbps >= 1000 ? `${(stats.kbps / 1000).toFixed(1).replace('.', ',')} Mbps` : `${stats.kbps} kbps`
  return ` · ${stats.height}p ${stats.fps} fps · ${rate}`
}

function sendingLimit(stats: SendStats) {
  if (stats.limit === 'bandwidth') return ' · bağlantı yavaş'
  if (stats.limit === 'cpu') return ' · işlemci yetmiyor'
  return ''
}

function isTyping(target: EventTarget | null) {
  const node = target as HTMLElement | null
  if (!node) return false
  return node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)
}

export function Room({ code, media, room, calls, sending, screenQuality, install, onScreenQuality, onLeave }: RoomProps) {
  const [popover, setPopover] = useState<Popover>('none')
  const [settings, setSettings] = useState(false)
  const [side, setSide] = useState<SideTab | null>(() => (window.innerWidth >= 1100 ? 'chat' : null))
  const [watchId, setWatchId] = useState<string | null>(null)
  const [talk, setTalk] = useState<Record<string, boolean>>({})
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [needSound, setNeedSound] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [floating, setFloating] = useState<Floating[]>([])
  const [unread, setUnread] = useState(0)
  const [pipCorner, setPipCorner] = useState<'br' | 'bl' | 'tr' | 'tl'>('br')
  const toastId = useRef(0)
  const seenMessages = useRef(room.messages.length)
  const knownPeers = useRef<Map<string, string> | null>(null)
  const link = code.length === 6 ? roomLink(code) : ''
  const askForSound = useCallback(() => setNeedSound(true), [])

  const toast = useCallback((text: string) => {
    toastId.current += 1
    const id = toastId.current
    setToasts((current) => [...current.slice(-2), { id, text }])
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200)
  }, [])

  const onSpeak = useCallback((id: string, speaking: boolean) => {
    setTalk((current) => (Boolean(current[id]) === speaking ? current : { ...current, [id]: speaking }))
  }, [])

  /* ---------- üyeler ---------- */

  const callById = useMemo(() => new Map(calls.map((call) => [call.id, call])), [calls])
  const mediaRev = calls.map((call) => call.rev).join('|')

  const remoteMembers = useMemo<Member[]>(
    () =>
      room.peers.map((peer) => {
        const call = callById.get(peer.session)
        // Chrome uzak izleri bazen geç "sessiz" yapar; açık/kapalı bilgisi sunucudan gelir.
        const camera = call && peer.state.cam && liveVideo(call.camera) ? call.camera : null
        const screen = call && peer.state.screen && liveVideo(call.screen) ? call.screen : null
        return {
          id: peer.session,
          name: peer.name,
          self: false,
          camera,
          screen,
          mic: call?.mic.getAudioTracks()[0] ?? null,
          micOn: peer.state.mic,
          camOn: camera !== null,
          live: screen !== null,
          deaf: peer.state.deaf,
          connection: call?.state ?? 'new',
          rtt: call?.rtt ?? null,
          relayed: call?.relayed ?? false,
          echo: peer.state.echo,
        }
      }),
    // mediaRev: izler aynı MediaStream nesnesi içinde değiştiğinde yeniden hesaplatır.
    [room.peers, callById, mediaRev],
  )

  const selfCamera = useMemo(() => (media.videoTrack ? new MediaStream([media.videoTrack]) : null), [media.videoTrack])
  const selfMember = useMemo<Member>(
    () => ({
      id: 'self',
      name: media.prefs.name.trim() || room.selfName || 'sen',
      self: true,
      camera: selfCamera,
      screen: media.screenStream,
      mic: media.micTrack,
      micOn: media.micOn && !media.deafened,
      camOn: media.camOn,
      live: media.sharing,
      deaf: media.deafened,
      connection: 'self',
      rtt: null,
      relayed: false,
      echo: media.screenEcho,
    }),
    [media.prefs.name, room.selfName, selfCamera, media.screenStream, media.micTrack, media.micOn, media.deafened, media.camOn, media.sharing],
  )
  const members = useMemo(() => [selfMember, ...remoteMembers], [remoteMembers, selfMember])
  const alone = remoteMembers.length === 0

  /* ---------- olaylar: katılım, sohbet, tepkiler ---------- */

  useEffect(() => {
    const now = new Map(room.peers.map((peer) => [peer.session, peer.name]))
    const before = knownPeers.current
    knownPeers.current = now
    if (!before) return
    for (const [id, name] of now) if (!before.has(id)) toast(`${name} odaya katıldı`)
    for (const [id, name] of before) if (!now.has(id)) toast(`${name} ayrıldı`)
  }, [room.peers, toast])

  useEffect(() => {
    const fresh = room.messages.slice(seenMessages.current)
    seenMessages.current = room.messages.length
    const incoming = fresh.filter((line) => !line.self).length
    if (!incoming) return
    if (side !== 'chat') setUnread((count) => count + incoming)
    if (document.hidden) document.title = `(${incoming}) çilek`
  }, [room.messages, side])

  useEffect(() => {
    if (side === 'chat') setUnread(0)
  }, [side])

  useEffect(() => {
    const reset = () => {
      if (!document.hidden) document.title = 'çilek'
    }
    document.addEventListener('visibilitychange', reset)
    return () => document.removeEventListener('visibilitychange', reset)
  }, [])

  const showReaction = useCallback((reaction: Reaction) => {
    const item = { ...reaction, left: 12 + Math.random() * 70 }
    setFloating((current) => [...current.slice(-14), item])
    window.setTimeout(() => setFloating((current) => current.filter((entry) => entry.id !== item.id)), 2800)
  }, [])

  useEffect(() => room.onReaction(showReaction), [room.onReaction, showReaction])

  const localReaction = useRef(-1)
  function react(emoji: string) {
    room.react(emoji)
    localReaction.current -= 1
    showReaction({ id: localReaction.current, from: 'self', name: 'sen', emoji })
  }

  useEffect(() => {
    if (media.notice) {
      toast(media.notice)
      media.clearNotice()
    }
  }, [media.notice, media.clearNotice, toast])

  useEffect(() => {
    if (!watchId) return
    const target = remoteMembers.find((member) => member.id === watchId)
    if (!target?.live) {
      setWatchId(null)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [remoteMembers, watchId])

  /* ---------- klavye kısayolları ---------- */

  const handlers = useRef({ media, setPopover, setSide, setSettings })
  handlers.current = { media, setPopover, setSide, setSettings }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { media: current, setPopover: pop, setSide: sideTo, setSettings: settingsTo } = handlers.current
      if (event.key === 'Escape') {
        pop('none')
        settingsTo(false)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'm') void current.toggleMic()
      else if (key === 'v') void current.toggleCam()
      else if (key === 'd') current.toggleDeafen()
      else if (key === 'e') pop((open) => (open === 'effects' ? 'none' : 'effects'))
      else if (key === 'c') sideTo((open) => (open === 'chat' ? null : 'chat'))
      else return
      event.preventDefault()
    }
    const unlock = () => {
      resumeAudio()
      for (const element of document.querySelectorAll('audio')) void element.play().catch(() => {})
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', unlock)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', unlock)
    }
  }, [])

  /* ---------- yardımcılar ---------- */

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast(done)
    } catch {
      window.prompt('Kopyala:', text)
    }
  }

  async function share(url: string) {
    if ('share' in navigator) {
      try {
        await navigator.share({ title: 'çilek', text: 'Benimle görüşmeye katıl 🍓', url })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await copy(url, 'Bağlantı kopyalandı.')
  }

  function togglePopover(next: Popover) {
    setPopover((open) => (open === next ? 'none' : next))
  }

  function toggleSide(tab: SideTab) {
    setSide((open) => (open === tab ? null : tab))
  }

  const heard = media.deafened ? 0 : media.prefs.remoteVolume / 100
  // Yayın sistem sesi içeriyorsa sen konuşurken (ve hemen sonrasında) yayın sesi kısılır;
  // sesin karşı taraftan geri döndüğünde sana ulaşmaz.
  const selfTalking = useHold(Boolean(talk.self), 1100)
  const watchedEcho = Boolean(watchId && remoteMembers.find((member) => member.id === watchId)?.echo)
  const screenHeard = watchedEcho && selfTalking ? 0.08 : 1
  const watched = watchId ? remoteMembers.find((member) => member.id === watchId && member.screen) ?? null : null

  /* ---------- sahne ---------- */

  const remoteTiles = remoteMembers.map((member) => (
    <Tile key={member.id} member={member} stream={member.camera} label={member.name} speaking={Boolean(talk[member.id])}>
      {member.live && watchId !== member.id ? (
        <button className="tile-watch" type="button" onClick={() => setWatchId(member.id)}>
          <ScreenIcon /> Ekranını izle
        </button>
      ) : null}
    </Tile>
  ))

  const fsCameras = (
    <div className="fs-cams">
      {remoteMembers
        .filter((member) => member.camera)
        .map((member) => (
          <div key={member.id} className={talk[member.id] ? 'fs-cam is-speaking' : 'fs-cam'}>
            <VideoSurface stream={member.camera} />
          </div>
        ))}
      {selfCamera ? (
        <div className={talk.self ? 'fs-cam is-speaking' : 'fs-cam'}>
          <VideoSurface stream={selfCamera} mirror={media.prefs.mirror} />
        </div>
      ) : null}
    </div>
  )

  const tileCount = remoteTiles.length + (watched ? 1 : 0)
  const columns = watched ? 1 : tileCount <= 1 ? 1 : tileCount <= 4 ? 2 : 3

  return (
    <main className={['room', side ? 'has-side' : ''].filter(Boolean).join(' ')}>
      {members.map((member) => (
        <SpeakingProbe key={member.id} id={member.id} track={member.mic} enabled={member.micOn} onSpeak={onSpeak} />
      ))}
      {calls.map((call) => (
        <span key={call.id} hidden>
          <RemoteAudio stream={call.mic} volume={heard * (volumes[call.id] ?? 1)} sinkId={media.prefs.speakerId} onBlocked={askForSound} />
          {watchId === call.id ? (
            <RemoteAudio stream={call.screenAudio} volume={heard * screenHeard * (volumes[call.id] ?? 1)} sinkId={media.prefs.speakerId} onBlocked={askForSound} />
          ) : null}
        </span>
      ))}

      <header className="topbar">
        <div className="brand">
          <StrawberryMark size={34} />
          <span>çilek</span>
        </div>
        <button className="code-chip" type="button" onClick={() => void copy(link, 'Oda bağlantısı kopyalandı.')} disabled={!link} title="Bağlantıyı kopyala">
          <span>oda</span>
          {code}
          <CopyIcon />
        </button>
        {room.reconnecting ? (
          <span className="status-pill is-warn" role="status">
            <span className="spinner" aria-hidden="true" /> Yeniden bağlanıyor…
          </span>
        ) : null}
        <div className="topbar-end">
          <button className="icon-btn ghost" type="button" onClick={() => void share(link)} disabled={!link} aria-label="Bağlantıyı paylaş" title="Bağlantıyı paylaş">
            <ShareIcon />
          </button>
          <button
            className={side === 'people' ? 'icon-btn ghost is-on' : 'icon-btn ghost'}
            type="button"
            onClick={() => toggleSide('people')}
            aria-label="Kişiler"
            title="Kişiler"
          >
            <PeopleIcon />
            <span className="count">{members.length}</span>
          </button>
        </div>
      </header>

      <section className="stage" aria-label="Görüntü">
        {alone ? (
          <div className="solo">
            <Tile
              member={selfMember}
              stream={selfCamera}
              label={`${selfMember.name} (sen)`}
              mirror={media.prefs.mirror}
              speaking={Boolean(talk.self)}
              className="is-solo"
            />
            <div className="solo-card">
              <p className="empty-kicker">{code ? 'Oda hazır' : 'Bağlanıyor…'}</p>
              {code ? (
                <>
                  <p className="code-big" aria-label={code.split('').join(' ')}>
                    {code.split('').map((char, index) => (
                      <span key={`${char}-${index}`}>{char}</span>
                    ))}
                  </p>
                  <p className="empty-copy">Kodu ya da bağlantıyı diğer kişiye gönder. İkinci kişi gelince oda kilitlenir.</p>
                  <div className="solo-actions">
                    <button className="btn primary small" type="button" onClick={() => void share(link)}>
                      <ShareIcon /> Bağlantıyı paylaş
                    </button>
                    <button className="btn ghost small" type="button" onClick={() => void copy(link, 'Oda bağlantısı kopyalandı.')}>
                      <CopyIcon /> Kopyala
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={watched ? 'grid has-pin' : 'grid'} style={{ ['--cols' as string]: columns }}>
            {watched ? (
              <Tile
                key={`${watched.id}-screen`}
                member={watched}
                stream={watched.screen}
                label={`${watched.name} · ekran${statsLabel(callById.get(watched.id)?.screenStats ?? null)}`}
                screen
                pinned
                speaking={false}
                fullscreenExtras={fsCameras}
              >
                <button className="tile-leave" type="button" onClick={() => setWatchId(null)}>
                  Yayından ayrıl
                </button>
              </Tile>
            ) : null}
            {watched ? (
              <div className="strip">
                {remoteTiles}
                {/* Yayın izlenirken kendi görüntün yayının üstüne binmesin diye şeride geçer. */}
                <Tile
                  member={selfMember}
                  stream={selfCamera}
                  label={`${selfMember.name} (sen)`}
                  mirror={media.prefs.mirror}
                  speaking={Boolean(talk.self)}
                />
              </div>
            ) : (
              remoteTiles
            )}
          </div>
        )}

        {!alone && !watched ? (
          <button
            type="button"
            className={['self-pip', `at-${pipCorner}`, talk.self ? 'is-speaking' : '', selfCamera ? '' : 'is-avatar'].filter(Boolean).join(' ')}
            onClick={() => setPipCorner((corner) => (corner === 'br' ? 'bl' : corner === 'bl' ? 'tl' : corner === 'tl' ? 'tr' : 'br'))}
            title="Köşeyi değiştir"
            aria-label="Kendi görüntün; köşeyi değiştirmek için tıkla"
          >
            {selfCamera ? <VideoSurface stream={selfCamera} mirror={media.prefs.mirror} /> : <span className="pip-name">{selfMember.name}</span>}
            {!selfMember.micOn ? (
              <span className="pip-mute">
                <MicIcon off />
              </span>
            ) : null}
          </button>
        ) : null}

        {media.sharing ? (
          <div className="share-pill" role="status">
            <span className="live-dot" aria-hidden="true" /> Ekranını paylaşıyorsun
            {sending && sending.height ? (
              <span className="share-stats">
                {sending.height}p · {sending.fps} fps{sendingLimit(sending)}
              </span>
            ) : null}
            {media.screenEcho ? (
              <span className="share-warn" title="Tüm ekran sesi paylaşılıyor; karşı tarafta ses bastırma açık. En temiz ses için Sekme paylaş.">
                sistem sesi
              </span>
            ) : null}
            <button type="button" onClick={media.stopScreen}>
              Durdur
            </button>
          </div>
        ) : null}

        <div className="reactions" aria-hidden="true">
          {floating.map((item) => (
            <span key={item.id} className="float-emoji" style={{ left: `${item.left}%` }}>
              {item.emoji}
              <small>{item.name}</small>
            </span>
          ))}
        </div>

        {media.error ? (
          <div className="banner" role="alert">
            <p>{media.error}</p>
            <button className="btn leaf small" type="button" onClick={media.retry}>
              Tekrar dene
            </button>
          </div>
        ) : null}

        {media.waitingPermission && !media.error ? (
          <div className="banner" role="status">
            <p>Kamera ve mikrofon izni bekleniyor. Tarayıcının adres çubuğundaki izin penceresine bak.</p>
          </div>
        ) : null}

        {room.status === 'error' ? (
          <div className="banner is-error" role="alert">
            <p>{room.detail || 'Sunucuyla bağlantı koptu.'}</p>
            <button className="btn leaf small" type="button" onClick={() => window.location.reload()}>
              Yeniden bağlan
            </button>
          </div>
        ) : null}

        {needSound ? (
          <button
            className="btn leaf sound-unlock"
            type="button"
            onClick={() => {
              resumeAudio()
              for (const element of document.querySelectorAll('audio, video')) void (element as HTMLMediaElement).play().catch(() => {})
              setNeedSound(false)
            }}
          >
            🔊 Sesi aç
          </button>
        ) : null}
      </section>

      {side ? (
        <aside className="side" aria-label={side === 'chat' ? 'Sohbet' : 'Kişiler'}>
          <header className="side-head">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={side === 'chat'} className={side === 'chat' ? 'tab is-on' : 'tab'} type="button" onClick={() => setSide('chat')}>
                Sohbet
              </button>
              <button role="tab" aria-selected={side === 'people'} className={side === 'people' ? 'tab is-on' : 'tab'} type="button" onClick={() => setSide('people')}>
                Kişiler <span className="tab-count">{members.length}</span>
              </button>
            </div>
            <button className="icon-btn" type="button" onClick={() => setSide(null)} aria-label="Paneli kapat">
              <CloseIcon />
            </button>
          </header>
          {side === 'chat' ? (
            <ChatPanel status={room.status} messages={room.messages} onSend={room.send} autoFocus />
          ) : (
            <PeoplePanel
              members={members}
              talk={talk}
              watchId={watchId}
              volumes={volumes}
              inviteLink={room.inviteLink}
              canInvite={room.status === 'in'}
              detail={room.detail}
              onWatch={setWatchId}
              onVolume={(id, value) => setVolumes((current) => ({ ...current, [id]: value }))}
              onInvite={room.createInvite}
              onCopy={(text, done) => void copy(text, done)}
              onShare={(url) => void share(url)}
            />
          )}
        </aside>
      ) : null}

      {popover === 'effects' ? <EffectsPanel media={media} onClose={() => setPopover('none')} onToast={toast} /> : null}

      {popover === 'screen' ? (
        <form
          className="popover screen-picker"
          aria-label="Ekran paylaşımı"
          onSubmit={(event) => {
            event.preventDefault()
            setPopover('none')
            void media.startScreen(screenQuality)
          }}
        >
          <header className="popover-head">
            <strong>Ekranı paylaş</strong>
            <button className="icon-btn" type="button" onClick={() => setPopover('none')} aria-label="Kapat">
              <CloseIcon />
            </button>
          </header>
          <p className="section-label">Çözünürlük</p>
          <div className="seg">
            {heights.map((item) => (
              <button key={item} className={item === screenQuality.height ? 'pick is-on' : 'pick'} type="button" onClick={() => onScreenQuality({ ...screenQuality, height: item })}>
                {item}p
              </button>
            ))}
          </div>
          <p className="section-label">Akıcılık</p>
          <div className="seg">
            {rates.map((item) => (
              <button key={item} className={item === screenQuality.fps ? 'pick is-on' : 'pick'} type="button" onClick={() => onScreenQuality({ ...screenQuality, fps: item })}>
                {item} fps
              </button>
            ))}
          </div>
          <p className="picker-note">Film ve müzik için açılan pencerede <b>Sekme</b>’yi seçip “Sekme sesini de paylaş”ı işaretle; böylece karşı taraf kendi sesini duymaz. Tüm ekran sesinde karşı tarafta otomatik ses bastırma devreye girer. Yazı ve sunum için 15 fps en net görüntüyü verir.</p>
          <button className="btn primary" type="submit">
            <ScreenIcon /> Paylaşmaya başla
          </button>
        </form>
      ) : null}

      {popover === 'react' ? (
        <div className="popover react-picker" role="dialog" aria-label="Tepki gönder">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" onClick={() => react(emoji)} aria-label={`${emoji} gönder`}>
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      <nav className="dock" aria-label="Görüşme kontrolleri">
        <div className="dock-group">
          <button
            className={media.micOn ? 'ctrl' : 'ctrl is-off'}
            type="button"
            onClick={() => void media.toggleMic()}
            disabled={media.pending}
            aria-pressed={media.micOn}
            title="Mikrofon (M)"
          >
            <MicIcon off={!media.micOn} />
            <span>{media.micOn ? 'Mikrofon' : 'Sessiz'}</span>
          </button>
          <button
            className={media.camOn ? 'ctrl' : 'ctrl is-off'}
            type="button"
            onClick={() => void media.toggleCam()}
            disabled={media.pending}
            aria-pressed={media.camOn}
            title="Kamera (V)"
          >
            <CamIcon off={!media.camOn} />
            <span>{media.camOn ? 'Kamera' : 'Kapalı'}</span>
          </button>
          <button
            className={[popover === 'effects' ? 'ctrl is-active' : 'ctrl', media.effectsOn ? 'has-dot' : ''].join(' ')}
            type="button"
            onClick={() => togglePopover('effects')}
            aria-expanded={popover === 'effects'}
            title="Efektler (E)"
          >
            <SparkleIcon />
            <span>Efektler</span>
          </button>
          {screenSupported ? (
            <button
              className={media.sharing ? 'ctrl is-live' : popover === 'screen' ? 'ctrl is-active' : 'ctrl'}
              type="button"
              onClick={() => (media.sharing ? media.stopScreen() : togglePopover('screen'))}
              aria-pressed={media.sharing}
              title="Ekran paylaş"
            >
              <ScreenIcon />
              <span>{media.sharing ? 'Durdur' : 'Ekran'}</span>
            </button>
          ) : null}
        </div>
        <div className="dock-group">
          <button className={popover === 'react' ? 'ctrl is-active' : 'ctrl'} type="button" onClick={() => togglePopover('react')} aria-expanded={popover === 'react'} title="Tepki">
            <SmileIcon />
            <span>Tepki</span>
          </button>
          <button
            className={media.deafened ? 'ctrl is-off hide-sm' : 'ctrl hide-sm'}
            type="button"
            onClick={media.toggleDeafen}
            aria-pressed={media.deafened}
            title="Sesi tamamen kapat (D)"
          >
            <HeadphonesIcon off={media.deafened} />
            <span>{media.deafened ? 'Sağır' : 'Dinle'}</span>
          </button>
          <button className={side === 'chat' ? 'ctrl is-active' : 'ctrl'} type="button" onClick={() => toggleSide('chat')} aria-pressed={side === 'chat'} title="Sohbet (C)">
            <ChatIcon />
            <span>Sohbet</span>
            {unread > 0 ? <b className="badge">{unread > 9 ? '9+' : unread}</b> : null}
          </button>
          <button className="ctrl" type="button" onClick={() => setSettings(true)} title="Ayarlar">
            <GearIcon />
            <span>Ayarlar</span>
          </button>
          <button className="ctrl leave" type="button" onClick={onLeave} title="Ayrıl">
            <LeaveIcon />
            <span>Ayrıl</span>
          </button>
        </div>
      </nav>

      {settings ? <SettingsPanel media={media} install={install} onClose={() => setSettings(false)} /> : null}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <p key={item.id} className="toast">
            {item.text}
          </p>
        ))}
      </div>
    </main>
  )
}
