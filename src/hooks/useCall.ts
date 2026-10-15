import { useEffect, useRef, useState } from 'react'
import type { CameraQuality } from '../lib/prefs'
import type { ScreenQuality } from './useLocalMedia'

type SignalData = {
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

/**
 * Her bağlantıda dört sabit şerit vardır ve sırası iki tarafta da aynıdır:
 * 0 mikrofon, 1 ekran sesi, 2 kamera, 3 ekran. Şeritleri yalnızca teklifi açan taraf
 * oluşturur; karşı taraf teklifle gelen şeritleri kullanır. Böylece görüntü ve ses
 * doğru kutuya düşer ve fazladan şerit açılmaz.
 */
const LANES = 4
const MIC = 0
const SCREEN_AUDIO = 1
const CAMERA = 2
const SCREEN = 3

type Link = {
  id: string
  epoch: number
  pc: RTCPeerConnection
  offerer: boolean
  buckets: [MediaStream, MediaStream, MediaStream, MediaStream]
  candidates: RTCIceCandidateInit[]
  makingOffer: boolean
  ignoreOffer: boolean
  queue: Promise<void>
  restartTimer: number
  rtt: number | null
  relayed: boolean
  ice: RTCIceServer[]
  codecsSet: boolean
  screenIn: VideoStats | null
  screenOut: SendStats | null
  lastIn: { bytes: number; at: number } | null
  lastOut: { bytes: number; at: number } | null
}

export type VideoStats = { width: number; height: number; fps: number; kbps: number }
export type SendStats = VideoStats & { limit: 'none' | 'cpu' | 'bandwidth' | 'other' }

export type RemoteCall = {
  id: string
  camera: MediaStream
  screen: MediaStream
  mic: MediaStream
  screenAudio: MediaStream
  state: RTCPeerConnectionState
  rtt: number | null
  relayed: boolean
  screenStats: VideoStats | null
  rev: string
}

export type RemoteRef = { id: string; epoch: number }

type UseCallOptions = {
  active: boolean
  selfId: string
  remotes: RemoteRef[]
  iceServers: RTCIceServer[] | null
  mic: MediaStreamTrack | null
  camera: MediaStreamTrack | null
  screen: MediaStream | null
  cameraQuality: CameraQuality
  screenQuality: ScreenQuality
  sendSignal: (to: string, data: SignalData) => void
  bindSignal: (handler: (from: string, data: unknown, epoch: number) => void) => () => void
}

const cameraBitrate: Record<CameraQuality, number> = { 360: 600_000, 720: 1_600_000, 1080: 3_000_000 }
/** Ekran paylaşılırken kamera geri çekilir; bant genişliği yayına kalır. */
const CAMERA_WHILE_SHARING = 450_000

function screenBitrate(quality: ScreenQuality) {
  const base = quality.height === 1440 ? 9_000_000 : quality.height === 1080 ? 6_000_000 : 3_000_000
  return Math.round(base * (quality.fps >= 60 ? 1.5 : quality.fps <= 15 ? 0.6 : 1))
}

type Tuning = {
  maxBitrate: number
  preference: RTCDegradationPreference
  maxFramerate?: number
  priority?: 'very-low' | 'low' | 'medium' | 'high'
}

/**
 * Ekran şeridinde VP9 öne alınır: aynı bit hızında yazı ve film çok daha net görünür.
 * Desteklenmezse H.264 ve VP8 sırayla denenir.
 */
function preferScreenCodecs(transceiver: RTCRtpTransceiver) {
  const capabilities = typeof RTCRtpReceiver !== 'undefined' ? RTCRtpReceiver.getCapabilities?.('video') : null
  if (!capabilities || typeof transceiver.setCodecPreferences !== 'function') return
  const rank = (codec: RTCRtpCodec) => {
    if (codec.mimeType === 'video/VP9') return /profile-id=(1|2|3)/.test(codec.sdpFmtpLine ?? '') ? 1 : 0
    if (codec.mimeType === 'video/H264') return 2
    if (codec.mimeType === 'video/VP8') return 3
    return 4
  }
  try {
    transceiver.setCodecPreferences([...capabilities.codecs].sort((a, b) => rank(a) - rank(b)))
  } catch {
    /* tarayıcı kendi sırasını kullanır */
  }
}

/** İkinci ses bölümünü (ekran sesi) stereo ve yüksek bit hızlı Opus yapar; film ve müzik için. */
function stereoScreenAudio(sdp: string) {
  const parts = sdp.split('\r\nm=')
  let audio = 0
  for (let index = 1; index < parts.length; index += 1) {
    if (!parts[index]!.startsWith('audio')) continue
    audio += 1
    if (audio !== 2) continue
    const opus = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(parts[index]!)?.[1]
    if (!opus) break
    parts[index] = parts[index]!.replace(new RegExp(`a=fmtp:${opus} ([^\\r\\n]*)`), (line, params: string) =>
      params.includes('stereo=') ? line : `a=fmtp:${opus} ${params};stereo=1;sprop-stereo=1;maxaveragebitrate=192000`,
    )
    break
  }
  return parts.join('\r\nm=')
}

async function setLocal(pc: RTCPeerConnection, kind: 'offer' | 'answer') {
  const description = kind === 'offer' ? await pc.createOffer() : await pc.createAnswer()
  if (kind === 'offer' && pc.signalingState !== 'stable') return false
  try {
    await pc.setLocalDescription({ type: description.type, sdp: stereoScreenAudio(description.sdp ?? '') })
  } catch {
    await pc.setLocalDescription(description)
  }
  return true
}

function copy(description: RTCSessionDescription | null): RTCSessionDescriptionInit | undefined {
  if (!description?.sdp || !description.type) return undefined
  return { type: description.type, sdp: description.sdp }
}

function asSignal(data: unknown): SignalData | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const next: SignalData = {}
  if (record.description && typeof record.description === 'object') {
    next.description = record.description as RTCSessionDescriptionInit
  }
  if (record.candidate && typeof record.candidate === 'object') {
    next.candidate = record.candidate as RTCIceCandidateInit
  }
  return next.description || next.candidate ? next : null
}

function stamp(stream: MediaStream) {
  return stream.getTracks().map((track) => `${track.id}:${track.readyState}:${track.muted}`).join('|')
}

function live(track: MediaStreamTrack | null | undefined) {
  return track && track.readyState === 'live' ? track : null
}

function putTrack(bucket: MediaStream, track: MediaStreamTrack) {
  for (const old of bucket.getTracks()) {
    if (old.id !== track.id) bucket.removeTrack(old)
  }
  if (!bucket.getTracks().some((item) => item.id === track.id)) bucket.addTrack(track)
}

function dropTrack(bucket: MediaStream, track: MediaStreamTrack) {
  if (bucket.getTracks().some((item) => item.id === track.id)) bucket.removeTrack(track)
}

export function useCall({
  active,
  selfId,
  remotes,
  iceServers,
  mic,
  camera,
  screen,
  cameraQuality,
  screenQuality,
  sendSignal,
  bindSignal,
}: UseCallOptions) {
  const [calls, setCalls] = useState<RemoteCall[]>([])
  const links = useRef(new Map<string, Link>())
  const pending = useRef(new Map<string, { epoch: number; list: SignalData[] }>())
  const sendRef = useRef(sendSignal)
  const mediaRef = useRef({ mic, camera, screen, cameraQuality, screenQuality })
  const selfRef = useRef(selfId)
  const publishTimer = useRef(0)
  sendRef.current = sendSignal
  selfRef.current = selfId
  mediaRef.current = { mic, camera, screen, cameraQuality, screenQuality }
  const remoteKey = remotes
    .filter((item) => item.id && item.id !== selfId)
    .map((item) => `${item.id}:${item.epoch}`)
    .sort()
    .join('|')

  function publishNow() {
    publishTimer.current = 0
    setCalls(
      [...links.current.values()].map((link) => {
        const [micBucket, screenAudio, cameraBucket, screenBucket] = link.buckets
        return {
          id: link.id,
          camera: cameraBucket,
          screen: screenBucket,
          mic: micBucket,
          screenAudio,
          state: link.pc.connectionState,
          rtt: link.rtt,
          relayed: link.relayed,
          screenStats: link.screenIn,
          rev: [
            stamp(cameraBucket),
            stamp(screenBucket),
            stamp(micBucket),
            stamp(screenAudio),
            link.pc.connectionState,
            link.rtt,
            link.relayed,
            link.screenIn ? `${link.screenIn.width}x${link.screenIn.height}@${link.screenIn.fps}/${link.screenIn.kbps}` : '',
          ].join('/'),
        }
      }),
    )
  }

  /** Aynı anda gelen olayları tek bir React güncellemesinde toplar. */
  function publish() {
    if (publishTimer.current) return
    publishTimer.current = window.setTimeout(publishNow, 16)
  }

  function run(link: Link, task: () => Promise<void>) {
    link.queue = link.queue.then(task).catch(() => {})
    return link.queue
  }

  function lanes(link: Link) {
    const list = link.pc.getTransceivers()
    return list.length >= LANES ? list.slice(0, LANES) : null
  }

  async function tune(sender: RTCRtpSender, wanted: Tuning) {
    try {
      const parameters = sender.getParameters()
      if (!parameters.encodings?.length) return
      const encoding = parameters.encodings[0]! as RTCRtpEncodingParameters & {
        priority?: Tuning['priority']
        networkPriority?: Tuning['priority']
      }
      const priority = wanted.priority ?? 'low'
      if (
        encoding.maxBitrate === wanted.maxBitrate &&
        parameters.degradationPreference === wanted.preference &&
        encoding.maxFramerate === wanted.maxFramerate &&
        (encoding.priority === undefined || encoding.priority === priority)
      ) {
        return
      }
      encoding.maxBitrate = wanted.maxBitrate
      if (wanted.maxFramerate) encoding.maxFramerate = wanted.maxFramerate
      if (sender.track?.kind === 'video') encoding.scaleResolutionDownBy = 1
      encoding.priority = priority
      encoding.networkPriority = priority
      parameters.degradationPreference = wanted.preference
      await sender.setParameters(parameters)
    } catch {
      /* bazı tarayıcılar bu ayarları desteklemez */
    }
  }

  async function apply(link: Link) {
    const transceivers = lanes(link)
    if (!transceivers) return
    const media = mediaRef.current
    const screenStream = media.screen
    const wanted = [
      live(media.mic),
      live(screenStream?.getAudioTracks()[0]),
      live(media.camera),
      live(screenStream?.getVideoTracks()[0]),
    ]
    for (let index = 0; index < LANES; index += 1) {
      const transceiver = transceivers[index]!
      if (transceiver.currentDirection === 'stopped') continue
      if (transceiver.direction !== 'sendrecv') transceiver.direction = 'sendrecv'
      if (transceiver.sender.track !== wanted[index]) await transceiver.sender.replaceTrack(wanted[index] ?? null)
    }
    const sharing = wanted[SCREEN] !== null
    await tune(transceivers[MIC]!.sender, { maxBitrate: 64_000, preference: 'balanced', priority: 'high' })
    await tune(transceivers[SCREEN_AUDIO]!.sender, { maxBitrate: 192_000, preference: 'balanced', priority: 'high' })
    await tune(transceivers[CAMERA]!.sender, {
      maxBitrate: sharing ? Math.min(CAMERA_WHILE_SHARING, cameraBitrate[media.cameraQuality]) : cameraBitrate[media.cameraQuality],
      preference: 'balanced',
      priority: sharing ? 'low' : 'medium',
    })
    // Yayında çözünürlük korunur; ağ zorlanırsa önce akıcılık düşer, görüntü bulanıklaşmaz.
    await tune(transceivers[SCREEN]!.sender, {
      maxBitrate: screenBitrate(media.screenQuality),
      preference: media.screenQuality.fps >= 60 ? 'balanced' : 'maintain-resolution',
      maxFramerate: media.screenQuality.fps,
      priority: 'high',
    })
  }

  async function drain(link: Link) {
    const waiting = link.candidates.splice(0)
    for (const candidate of waiting) {
      try {
        await link.pc.addIceCandidate(candidate)
      } catch {
        /* eski adaylar düşebilir */
      }
    }
  }

  async function offer(link: Link) {
    const pc = link.pc
    if (pc.signalingState !== 'stable' || !lanes(link)) return
    link.makingOffer = true
    try {
      await apply(link)
      if (!(await setLocal(pc, 'offer'))) return
      const description = copy(pc.localDescription)
      if (description) sendRef.current(link.id, { description })
    } finally {
      link.makingOffer = false
    }
  }

  async function accept(link: Link, data: SignalData) {
    const pc = link.pc
    const polite = !link.offerer
    try {
      if (data.description?.type && data.description.sdp) {
        const description = data.description
        const collision = description.type === 'offer' && (link.makingOffer || pc.signalingState !== 'stable')
        link.ignoreOffer = !polite && collision
        if (link.ignoreOffer) return
        await pc.setRemoteDescription(description)
        await drain(link)
        if (description.type === 'offer') {
          const transceivers = lanes(link)
          if (transceivers && !link.codecsSet) {
            preferScreenCodecs(transceivers[SCREEN]!)
            link.codecsSet = true
          }
          await apply(link)
          await setLocal(pc, 'answer')
          const answer = copy(pc.localDescription)
          if (answer) sendRef.current(link.id, { description: answer })
          // Bit hızı ayarları ancak yanıt kurulduktan sonra uygulanabilir.
          await apply(link)
        } else {
          await apply(link)
        }
        publish()
      }
      if (data.candidate) {
        if (!pc.remoteDescription) {
          link.candidates.push(data.candidate)
          return
        }
        try {
          await pc.addIceCandidate(data.candidate)
        } catch {
          /* yok sayılan teklifin ya da eski oturumun adayı */
        }
      }
    } catch {
      /* bozuk bir paket görüşmeyi düşürmesin */
    }
  }

  function bucketOf(link: Link, transceiver: RTCRtpTransceiver) {
    const index = link.pc.getTransceivers().indexOf(transceiver)
    return index >= 0 && index < LANES ? link.buckets[index as 0 | 1 | 2 | 3] : null
  }

  function watchTrack(link: Link, transceiver: RTCRtpTransceiver, track: MediaStreamTrack) {
    const bucket = bucketOf(link, transceiver)
    if (!bucket) return
    const sync = () => {
      // Karşı taraf izi kaldırdığında iz "muted" olur; boş görüntü göstermeyelim.
      if (track.readyState === 'ended' || track.muted) dropTrack(bucket, track)
      else putTrack(bucket, track)
      publish()
    }
    track.addEventListener('unmute', sync)
    track.addEventListener('mute', sync)
    track.addEventListener('ended', sync)
    sync()
  }

  function close(link: Link) {
    window.clearTimeout(link.restartTimer)
    link.pc.onicecandidate = null
    link.pc.ontrack = null
    link.pc.onnegotiationneeded = null
    link.pc.onconnectionstatechange = null
    link.pc.close()
  }

  function open(remoteId: string, epoch: number, ice: RTCIceServer[]) {
    const pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' })
    const offerer = selfRef.current < remoteId
    const link: Link = {
      id: remoteId,
      epoch,
      pc,
      offerer,
      buckets: [new MediaStream(), new MediaStream(), new MediaStream(), new MediaStream()],
      candidates: [],
      makingOffer: false,
      ignoreOffer: false,
      queue: Promise.resolve(),
      restartTimer: 0,
      rtt: null,
      relayed: false,
      ice,
      codecsSet: false,
      screenIn: null,
      screenOut: null,
      lastIn: null,
      lastOut: null,
    }
    links.current.set(remoteId, link)

    if (offerer) {
      for (const kind of ['audio', 'audio', 'video', 'video'] as const) pc.addTransceiver(kind, { direction: 'sendrecv' })
      preferScreenCodecs(pc.getTransceivers()[SCREEN]!)
      link.codecsSet = true
      void run(link, () => apply(link))
    }

    pc.onnegotiationneeded = () => {
      void run(link, () => offer(link))
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) sendRef.current(remoteId, { candidate: event.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      window.clearTimeout(link.restartTimer)
      const state = pc.connectionState
      if (state === 'failed') {
        if (link.offerer) pc.restartIce()
      } else if (state === 'disconnected') {
        // Kısa kopmalar kendiliğinden düzelir; 4 sn sonra hâlâ kopuksa ICE yenilenir.
        link.restartTimer = window.setTimeout(() => {
          if (pc.connectionState === 'disconnected' && link.offerer) pc.restartIce()
        }, 4000)
      }
      publish()
    }
    pc.ontrack = (event) => watchTrack(link, event.transceiver, event.track)

    const waiting = pending.current.get(remoteId)
    pending.current.delete(remoteId)
    if (waiting && waiting.epoch === epoch) for (const data of waiting.list) void run(link, () => accept(link, data))
  }

  useEffect(() => {
    if (!active || !selfId || !iceServers) {
      for (const link of links.current.values()) close(link)
      links.current.clear()
      pending.current.clear()
      setCalls([])
      return
    }

    const wanted = new Map<string, number>()
    for (const part of remoteKey ? remoteKey.split('|') : []) {
      const split = part.lastIndexOf(':')
      wanted.set(part.slice(0, split), Number(part.slice(split + 1)))
    }
    for (const [id, link] of links.current) {
      // Karşı taraf yeniden bağlandıysa (yeni epoch) eski bağlantı atılır.
      if (wanted.get(id) === link.epoch) continue
      close(link)
      links.current.delete(id)
    }
    for (const [remoteId, epoch] of wanted) {
      const existing = links.current.get(remoteId)
      if (!existing) {
        open(remoteId, epoch, iceServers)
        continue
      }
      // Yeni TURN kimlikleri açık bağlantılara da verilir; ICE yenilemesinde kullanılır.
      if (existing.ice === iceServers) continue
      existing.ice = iceServers
      try {
        existing.pc.setConfiguration({ ...existing.pc.getConfiguration(), iceServers })
      } catch {
        /* bazı tarayıcılar canlı değişikliğe izin vermez */
      }
    }
    publish()
  }, [active, selfId, remoteKey, iceServers])

  useEffect(() => {
    for (const link of links.current.values()) void run(link, () => apply(link))
  }, [mic, camera, screen, cameraQuality, screenQuality])

  useEffect(() => {
    return bindSignal((from, data, epoch) => {
      const signal = asSignal(data)
      if (!signal) return
      const link = links.current.get(from)
      if (link && link.epoch === epoch) {
        void run(link, () => accept(link, signal))
        return
      }
      // Eski oturumdan kalan paketler atılır.
      if (link && link.epoch > epoch) return
      // Karşı taraf yeniden bağlandı ama oda listesi henüz gelmedi: eski bağlantıyı kapat,
      // paketi sakla; yeni bağlantı açılınca işlenir. Böylece teklif eski bağlantıya düşmez.
      if (link) {
        close(link)
        links.current.delete(from)
        publish()
      }
      const queued = pending.current.get(from)
      const list = queued && queued.epoch === epoch ? queued.list : []
      if (signal.description?.type === 'offer') list.length = 0
      list.push(signal)
      pending.current.set(from, { epoch, list: list.slice(-60) })
    })
  }, [bindSignal])

  /* Bağlantı kalitesi: gidiş-dönüş süresi, TURN kullanımı ve yayının gerçek çözünürlüğü. */
  const [sending, setSending] = useState<SendStats | null>(null)
  useEffect(() => {
    if (!active) return
    const rate = (bytes: number, previous: { bytes: number; at: number } | null, now: number) =>
      previous && now > previous.at ? Math.max(0, Math.round(((bytes - previous.bytes) * 8) / (now - previous.at))) : 0
    const timer = window.setInterval(async () => {
      let changed = false
      let out: SendStats | null = null
      for (const link of links.current.values()) {
        if (link.pc.connectionState !== 'connected') continue
        try {
          const stats = await link.pc.getStats()
          const byId = new Map<string, Record<string, unknown>>()
          stats.forEach((report: Record<string, unknown>) => byId.set(report.id as string, report))
          let rtt: number | null = null
          let relayed = false
          stats.forEach((report: Record<string, unknown>) => {
            if (report.type !== 'candidate-pair' || !report.nominated || report.state !== 'succeeded') return
            if (typeof report.currentRoundTripTime === 'number') rtt = Math.round(report.currentRoundTripTime * 1000)
            const local = byId.get(report.localCandidateId as string)
            const remote = byId.get(report.remoteCandidateId as string)
            relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay'
          })
          const transceivers = lanes(link)
          let screenIn: VideoStats | null = null
          if (transceivers && link.buckets[SCREEN].getVideoTracks().length) {
            const now = performance.now()
            ;(await transceivers[SCREEN]!.receiver.getStats()).forEach((report: Record<string, unknown>) => {
              if (report.type !== 'inbound-rtp' || report.kind !== 'video') return
              const bytes = Number(report.bytesReceived ?? 0)
              screenIn = {
                width: Number(report.frameWidth ?? 0),
                height: Number(report.frameHeight ?? 0),
                fps: Math.round(Number(report.framesPerSecond ?? 0)),
                kbps: rate(bytes, link.lastIn, now),
              }
              link.lastIn = { bytes, at: now }
            })
          } else {
            link.lastIn = null
          }
          if (transceivers && transceivers[SCREEN]!.sender.track) {
            const now = performance.now()
            ;(await transceivers[SCREEN]!.sender.getStats()).forEach((report: Record<string, unknown>) => {
              if (report.type !== 'outbound-rtp' || report.kind !== 'video') return
              const bytes = Number(report.bytesSent ?? 0)
              const reason = String(report.qualityLimitationReason ?? 'none')
              out = {
                width: Number(report.frameWidth ?? 0),
                height: Number(report.frameHeight ?? 0),
                fps: Math.round(Number(report.framesPerSecond ?? 0)),
                kbps: rate(bytes, link.lastOut, now),
                limit: reason === 'cpu' || reason === 'bandwidth' || reason === 'none' ? reason : 'other',
              }
              link.lastOut = { bytes, at: now }
            })
          } else {
            link.lastOut = null
          }
          const before = JSON.stringify([link.rtt, link.relayed, link.screenIn])
          link.rtt = rtt
          link.relayed = relayed
          link.screenIn = screenIn
          if (JSON.stringify([rtt, relayed, screenIn]) !== before) changed = true
        } catch {
          /* istatistik alınamazsa geç */
        }
      }
      setSending((current) => (JSON.stringify(current) === JSON.stringify(out) ? current : out))
      if (changed) publish()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [active])

  useEffect(() => {
    const current = links.current
    return () => {
      window.clearTimeout(publishTimer.current)
      for (const link of current.values()) close(link)
      current.clear()
    }
  }, [])

  return { calls, sending }
}
