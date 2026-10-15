import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { audioContext } from '../lib/audio'
import { effectsActive, type Effects } from '../lib/effects/filters'
import { CameraProcessor, canProcess, type EffectsStatus } from '../lib/effects/processor'
import { loadPrefs, savePrefs, type CameraQuality, type Prefs } from '../lib/prefs'

export type ScreenQuality = { height: 720 | 1080 | 1440; fps: 15 | 30 | 60 }

export type DeviceList = { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }

const screenSizes: Record<ScreenQuality['height'], { width: number; height: number }> = {
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
  1440: { width: 2560, height: 1440 },
}

const cameraSizes: Record<CameraQuality, { width: number; height: number }> = {
  360: { width: 640, height: 360 },
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
}

function mediaErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'İzin verilmedi. Adres çubuğundaki kilit simgesinden mikrofon ve kameraya izin ver.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Bu cihazda mikrofon veya kamera bulunamadı.'
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Kamera veya mikrofon şu an kullanılamıyor. Başka bir uygulama tutuyor olabilir.'
  }
  return 'Mikrofon veya kamera açılamadı. Tekrar dene.'
}

function canCapture() {
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
}

function ownAudioSupported() {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() as (MediaTrackSupportedConstraints & { restrictOwnAudio?: boolean }) | undefined
  return supported?.restrictOwnAudio === true
}

const insecureMessage = 'Kamera ve mikrofon yalnızca güvenli (https) bağlantıda açılır. Sayfayı https:// ile aç.'

function audioConstraints(prefs: Prefs, withDevice = true): MediaTrackConstraints {
  return {
    ...(withDevice && prefs.micId ? { deviceId: { exact: prefs.micId } } : {}),
    echoCancellation: prefs.echo,
    noiseSuppression: prefs.noise,
    autoGainControl: prefs.agc,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    // Desteklenen tarayıcılarda (Chrome/Safari) ses yalıtımı; desteklemeyen yok sayar.
    ...({ voiceIsolation: prefs.noise } as MediaTrackConstraints),
  }
}

function videoConstraints(prefs: Prefs, withDevice = true, facing?: 'user' | 'environment'): MediaTrackConstraints {
  const size = cameraSizes[prefs.quality]
  return {
    ...(withDevice && prefs.camId ? { deviceId: { exact: prefs.camId } } : { facingMode: facing ?? 'user' }),
    width: { ideal: size.width },
    height: { ideal: size.height },
    aspectRatio: { ideal: 16 / 9 },
    frameRate: { ideal: 30, max: 30 },
  }
}

async function capture(kind: 'audio' | 'video', prefs: Prefs, facing?: 'user' | 'environment') {
  const build = (withDevice: boolean) =>
    kind === 'audio'
      ? { audio: audioConstraints(prefs, withDevice), video: false }
      : { audio: false, video: videoConstraints(prefs, withDevice, facing) }
  try {
    return await navigator.mediaDevices.getUserMedia(build(true))
  } catch (error) {
    // Kayıtlı cihaz çıkarılmışsa varsayılana dön.
    const name = error instanceof DOMException ? error.name : ''
    if ((name === 'OverconstrainedError' || name === 'NotFoundError') && (kind === 'audio' ? prefs.micId : prefs.camId)) {
      return navigator.mediaDevices.getUserMedia(build(false))
    }
    throw error
  }
}

function matchesProcessing(track: MediaStreamTrack, prefs: Prefs) {
  const settings = track.getSettings()
  const same = (value: boolean | undefined, wanted: boolean) => value === undefined || value === wanted
  // Yeni tarayıcılar yankı engellemeyi "all" / "remote-only" gibi metinle bildirebilir.
  const echo = settings.echoCancellation as unknown
  const echoOn = typeof echo === 'string' ? echo !== 'none' : (echo as boolean | undefined)
  return same(echoOn, prefs.echo) && same(settings.noiseSuppression, prefs.noise) && same(settings.autoGainControl, prefs.agc)
}

export function useLocalMedia() {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [micTrack, setMicTrack] = useState<MediaStreamTrack | null>(null)
  const [camTrack, setCamTrack] = useState<MediaStreamTrack | null>(null)
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null)
  const [outgoingMic, setOutgoingMic] = useState<MediaStreamTrack | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  /** Tüm ekran sesi paylaşılıyor ve tarayıcı görüşmenin sesini ayıramıyor: karşı taraf kendi sesini duyabilir. */
  const [screenEcho, setScreenEcho] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [pending, setPending] = useState(false)
  const [waitingPermission, setWaitingPermission] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [effectsStatus, setEffectsStatus] = useState<EffectsStatus>('idle')
  const [devices, setDevices] = useState<DeviceList>({ mics: [], cams: [], speakers: [] })
  const [facing, setFacing] = useState<'user' | 'environment'>('user')

  const prefsRef = useRef(prefs)
  const micRef = useRef<MediaStreamTrack | null>(null)
  const camRef = useRef<MediaStreamTrack | null>(null)
  const screenRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<CameraProcessor | null>(null)
  const gainRef = useRef<{ source: MediaStreamAudioSourceNode; gain: GainNode; track: MediaStreamTrack } | null>(null)
  const generation = useRef(0)
  const started = useRef(false)
  const micOnRef = useRef(false)
  const deafRef = useRef(false)
  const micBeforeDeafen = useRef(true)
  const facingRef = useRef<'user' | 'environment'>('user')
  const effectsCapable = useMemo(canProcess, [])

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch }
    prefsRef.current = next
    setPrefsState(next)
    savePrefs(next)
    return next
  }, [])

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices({
        mics: list.filter((item) => item.kind === 'audioinput' && item.deviceId),
        cams: list.filter((item) => item.kind === 'videoinput' && item.deviceId),
        speakers: list.filter((item) => item.kind === 'audiooutput' && item.deviceId),
      })
    } catch {
      /* cihaz listesi alınamazsa seçim menüsü boş kalır */
    }
  }, [])

  /* ---------- giden mikrofon (kazanç) ---------- */

  const closeGain = useCallback(() => {
    const graph = gainRef.current
    if (!graph) return
    graph.source.disconnect()
    graph.gain.disconnect()
    graph.track.stop()
    gainRef.current = null
  }, [])

  const publishOutgoing = useCallback(() => {
    const track = micRef.current
    if (!track || track.readyState !== 'live' || !micOnRef.current || deafRef.current) {
      closeGain()
      setOutgoingMic(null)
      return
    }
    track.enabled = true
    const volume = prefsRef.current.micVolume
    if (volume === 100) {
      closeGain()
      setOutgoingMic(track)
      return
    }
    if (gainRef.current) {
      gainRef.current.gain.gain.value = volume / 100
      setOutgoingMic(gainRef.current.track)
      return
    }
    try {
      const context = audioContext()
      const source = context.createMediaStreamSource(new MediaStream([track]))
      const gain = context.createGain()
      gain.gain.value = volume / 100
      const destination = context.createMediaStreamDestination()
      destination.channelCount = 1
      source.connect(gain)
      gain.connect(destination)
      const sent = destination.stream.getAudioTracks()[0]
      if (!sent) throw new Error('gain')
      gainRef.current = { source, gain, track: sent }
      setOutgoingMic(sent)
    } catch {
      setOutgoingMic(track)
    }
  }, [closeGain])

  /* ---------- iz yönetimi ---------- */

  const adoptMic = useCallback(
    (track: MediaStreamTrack | null) => {
      const previous = micRef.current
      if (previous && previous !== track) previous.stop()
      closeGain()
      micRef.current = track
      setMicTrack(track)
      if (track) {
        track.enabled = micOnRef.current && !deafRef.current
        track.addEventListener('ended', () => {
          if (micRef.current !== track) return
          micRef.current = null
          setMicTrack(null)
          micOnRef.current = false
          setMicOn(false)
          closeGain()
          setOutgoingMic(null)
          setNotice('Mikrofon bağlantısı kesildi.')
        })
      }
      publishOutgoing()
    },
    [closeGain, publishOutgoing],
  )

  const adoptCam = useCallback((track: MediaStreamTrack | null) => {
    const previous = camRef.current
    if (previous && previous !== track) previous.stop()
    camRef.current = track
    setCamTrack(track)
    if (track) {
      track.contentHint = 'motion'
      track.addEventListener('ended', () => {
        if (camRef.current !== track) return
        camRef.current = null
        setCamTrack(null)
        setNotice('Kamera bağlantısı kesildi.')
      })
    }
  }, [])

  const acquire = useCallback(
    async (kind: 'audio' | 'video') => {
      if (!canCapture()) {
        setError(insecureMessage)
        return null
      }
      const ticket = generation.current
      const media = await capture(kind, prefsRef.current, facingRef.current)
      const track = kind === 'audio' ? media.getAudioTracks()[0] : media.getVideoTracks()[0]
      if (!track || ticket !== generation.current) {
        media.getTracks().forEach((item) => item.stop())
        return null
      }
      if (kind === 'audio') adoptMic(track)
      else adoptCam(track)
      setError(null)
      void refreshDevices()
      return track
    },
    [adoptCam, adoptMic, refreshDevices],
  )

  /* ---------- efekt işlem hattı ---------- */

  const active = effectsCapable && effectsActive(prefs.effects)

  useEffect(() => {
    if (!camTrack) {
      processorRef.current?.stop()
      processorRef.current = null
      setVideoTrack(null)
      setEffectsStatus('idle')
      return
    }
    if (!active) {
      processorRef.current?.stop()
      processorRef.current = null
      setVideoTrack(camTrack)
      setEffectsStatus('idle')
      return
    }
    if (processorRef.current) {
      processorRef.current.setSource(camTrack)
      return
    }
    try {
      const processor = new CameraProcessor(camTrack, prefsRef.current.effects, setEffectsStatus, () => {
        if (processorRef.current !== processor) return
        processor.stop()
        processorRef.current = null
        setVideoTrack(camRef.current)
        setNotice('Efektler durduruldu; kamera doğrudan gönderiliyor.')
      })
      processorRef.current = processor
      setVideoTrack(processor.track)
    } catch {
      processorRef.current = null
      setVideoTrack(camTrack)
      setEffectsStatus('error')
    }
  }, [camTrack, active])

  useEffect(() => {
    processorRef.current?.setEffects(prefs.effects)
  }, [prefs.effects])

  /* ---------- dışa açık işlemler ---------- */

  // İzin penceresi gözden kaçarsa birkaç saniye sonra kullanıcıya ipucu ver.
  useEffect(() => {
    if (!pending) {
      setWaitingPermission(false)
      return
    }
    const timer = window.setTimeout(() => setWaitingPermission(true), 5000)
    return () => window.clearTimeout(timer)
  }, [pending])

  const start = useCallback(async () => {
    if (started.current) return
    started.current = true
    if (!canCapture()) {
      setError(insecureMessage)
      return
    }
    const ticket = generation.current
    const wanted = prefsRef.current
    setPending(true)
    setError(null)
    let failure: unknown = null
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(wanted),
        video: wanted.joinWithCam ? videoConstraints(wanted, true, facingRef.current) : false,
      })
      if (ticket !== generation.current) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      micOnRef.current = wanted.joinWithMic
      setMicOn(wanted.joinWithMic)
      adoptMic(media.getAudioTracks()[0] ?? null)
      adoptCam(media.getVideoTracks()[0] ?? null)
    } catch (err) {
      failure = err
      // Birlikte açılamadıysa ayrı ayrı dene (ör. kamerası olmayan cihaz).
      micOnRef.current = wanted.joinWithMic
      setMicOn(wanted.joinWithMic)
      const audio = await acquire('audio').catch((inner: unknown) => {
        failure = inner
        return null
      })
      if (!audio) {
        micOnRef.current = false
        setMicOn(false)
      }
      const video = wanted.joinWithCam
        ? await acquire('video').catch((inner: unknown) => {
            failure = failure ?? inner
            return null
          })
        : null
      if (audio || video) failure = null
    }
    if (ticket !== generation.current) return
    setError(failure ? mediaErrorMessage(failure) : null)
    setPending(false)
    void refreshDevices()
  }, [acquire, adoptCam, adoptMic, refreshDevices])

  const retry = useCallback(() => {
    started.current = false
    void start()
  }, [start])

  const stopScreen = useCallback(() => {
    screenRef.current?.getTracks().forEach((track) => track.stop())
    screenRef.current = null
    setScreenStream(null)
  }, [])

  const stopAll = useCallback(() => {
    generation.current += 1
    started.current = false
    stopScreen()
    processorRef.current?.stop()
    processorRef.current = null
    closeGain()
    micRef.current?.stop()
    camRef.current?.stop()
    micRef.current = null
    camRef.current = null
    micOnRef.current = false
    deafRef.current = false
    setMicTrack(null)
    setCamTrack(null)
    setVideoTrack(null)
    setOutgoingMic(null)
    setMicOn(false)
    setDeafened(false)
    setPending(false)
    setError(null)
  }, [closeGain, stopScreen])

  const toggleMic = useCallback(async () => {
    if (deafRef.current) {
      deafRef.current = false
      setDeafened(false)
    }
    const track = micRef.current
    if (!track || track.readyState !== 'live') {
      setPending(true)
      try {
        micOnRef.current = true
        setMicOn(true)
        const fresh = await acquire('audio')
        if (!fresh) {
          micOnRef.current = false
          setMicOn(false)
        }
      } catch (err) {
        micOnRef.current = false
        setMicOn(false)
        setError(mediaErrorMessage(err))
      } finally {
        setPending(false)
      }
      return
    }
    const next = !micOnRef.current
    micOnRef.current = next
    track.enabled = next
    setMicOn(next)
    publishOutgoing()
  }, [acquire, publishOutgoing])

  const toggleCam = useCallback(async () => {
    if (camRef.current) {
      // Kamerayı gerçekten kapat; ışık söner, pil ve bant genişliği korunur.
      adoptCam(null)
      return
    }
    setPending(true)
    try {
      await acquire('video')
    } catch (err) {
      setError(mediaErrorMessage(err))
    } finally {
      setPending(false)
    }
  }, [acquire, adoptCam])

  const toggleDeafen = useCallback(() => {
    const next = !deafRef.current
    deafRef.current = next
    setDeafened(next)
    if (next) {
      micBeforeDeafen.current = micOnRef.current
      micOnRef.current = false
      setMicOn(false)
      if (micRef.current) micRef.current.enabled = false
    } else if (micBeforeDeafen.current && micRef.current) {
      micOnRef.current = true
      setMicOn(true)
      micRef.current.enabled = true
    }
    publishOutgoing()
  }, [publishOutgoing])

  const setDevice = useCallback(
    async (kind: 'audio' | 'video', deviceId: string) => {
      updatePrefs(kind === 'audio' ? { micId: deviceId } : { camId: deviceId })
      const live = kind === 'audio' ? micRef.current : camRef.current
      if (!live) return
      try {
        await acquire(kind)
      } catch (err) {
        setError(mediaErrorMessage(err))
      }
    },
    [acquire, updatePrefs],
  )

  const switchCamera = useCallback(async () => {
    const cams = devices.cams
    if (cams.length > 1) {
      const currentId = camRef.current?.getSettings().deviceId ?? prefsRef.current.camId
      const index = cams.findIndex((item) => item.deviceId === currentId)
      const next = cams[(index + 1) % cams.length]!
      await setDevice('video', next.deviceId)
      return
    }
    // Etiketsiz mobil tarayıcılarda ön/arka kamera arasında geç.
    const nextFacing = facingRef.current === 'user' ? 'environment' : 'user'
    facingRef.current = nextFacing
    setFacing(nextFacing)
    updatePrefs({ camId: '' })
    if (camRef.current) await acquire('video').catch((err: unknown) => setError(mediaErrorMessage(err)))
  }, [acquire, devices.cams, setDevice, updatePrefs])

  const setSpeaker = useCallback((deviceId: string) => updatePrefs({ speakerId: deviceId }), [updatePrefs])

  const setProcessing = useCallback(
    async (patch: Partial<Pick<Prefs, 'echo' | 'noise' | 'agc'>>) => {
      const next = updatePrefs(patch)
      const track = micRef.current
      if (!track) return
      try {
        await track.applyConstraints(audioConstraints(next))
      } catch {
        /* bazı tarayıcılar canlı değişikliği reddeder; aşağıda yeniden alınır */
      }
      if (!matchesProcessing(track, next)) {
        await acquire('audio').catch((err: unknown) => setError(mediaErrorMessage(err)))
      }
    },
    [acquire, updatePrefs],
  )

  const setMicVolume = useCallback(
    (value: number) => {
      updatePrefs({ micVolume: Math.round(Math.min(200, Math.max(0, value))) })
      publishOutgoing()
    },
    [publishOutgoing, updatePrefs],
  )

  const setRemoteVolume = useCallback((value: number) => updatePrefs({ remoteVolume: Math.round(Math.min(100, Math.max(0, value))) }), [updatePrefs])

  const setQuality = useCallback(
    async (quality: CameraQuality) => {
      const next = updatePrefs({ quality })
      const track = camRef.current
      if (!track) return
      try {
        await track.applyConstraints(videoConstraints(next, true, facingRef.current))
      } catch {
        await acquire('video').catch((err: unknown) => setError(mediaErrorMessage(err)))
      }
    },
    [acquire, updatePrefs],
  )

  const setEffects = useCallback(
    (patch: Partial<Effects>) => updatePrefs({ effects: { ...prefsRef.current.effects, ...patch } }),
    [updatePrefs],
  )

  const setMirror = useCallback((mirror: boolean) => updatePrefs({ mirror }), [updatePrefs])
  const setName = useCallback((name: string) => updatePrefs({ name: name.slice(0, 24) }), [updatePrefs])
  const setJoinDefaults = useCallback(
    (patch: Partial<Pick<Prefs, 'joinWithCam' | 'joinWithMic'>>) => updatePrefs(patch),
    [updatePrefs],
  )

  const snapshot = useCallback(async () => {
    if (processorRef.current) return processorRef.current.snapshot()
    const track = camRef.current
    if (!track) return null
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = new MediaStream([track])
    await video.play().catch(() => {})
    if (!video.videoWidth) await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }))
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    video.srcObject = null
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  }, [])

  const startScreen = useCallback(
    async (choice: ScreenQuality) => {
      if (screenRef.current) {
        stopScreen()
        return
      }
      if (!canCapture() || !navigator.mediaDevices.getDisplayMedia) {
        setError('Bu tarayıcı ekran paylaşımını desteklemiyor.')
        return
      }
      try {
        const ticket = generation.current
        const size = screenSizes[choice.height]
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: size.width, max: size.width },
            height: { ideal: size.height, max: size.height },
            frameRate: { ideal: choice.fps, max: choice.fps },
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 2 },
            sampleRate: { ideal: 48000 },
            // Sistem sesi paylaşılırken görüşmenin kendi sesi (karşı tarafın konuşması) geri gönderilmesin.
            ...(ownAudioSupported() ? { restrictOwnAudio: true } : {}),
            suppressLocalAudioPlayback: false,
          } as MediaTrackConstraints,
          ...({ systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include' } as object),
        } as DisplayMediaStreamOptions)
        if (ticket !== generation.current) {
          display.getTracks().forEach((track) => track.stop())
          return
        }
        const screenTrack = display.getVideoTracks()[0]
        // "detail": kodlayıcı çözünürlüğü korur; bant daralırsa görüntü 240p'ye düşmek yerine akıcılıktan verir.
        if (screenTrack) screenTrack.contentHint = choice.fps >= 60 ? 'motion' : 'detail'
        const screenAudio = display.getAudioTracks()[0]
        if (screenAudio) screenAudio.contentHint = 'music'
        const surface = (screenTrack?.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface
        const restricted = (screenAudio?.getSettings() as (MediaTrackSettings & { restrictOwnAudio?: boolean }) | undefined)?.restrictOwnAudio === true
        // Sekme paylaşımında yalnızca o sekmenin sesi gider; risk tüm ekran (sistem) sesindedir.
        const echo = Boolean(screenAudio) && surface !== 'browser' && !restricted
        setScreenEcho(echo)
        if (echo) setNotice('Sistem sesi paylaşılıyor. Film için “Sekme” paylaşmak daha temiz ses verir.')
        screenRef.current = display
        setScreenStream(display)
        setError(null)
        screenTrack?.addEventListener('ended', () => {
          if (screenRef.current === display) {
            display.getTracks().forEach((track) => track.stop())
            screenRef.current = null
            setScreenStream(null)
          }
        })
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        if (name === 'AbortError' || name === 'NotAllowedError') return
        setError('Ekran paylaşılamadı. Tekrar dene.')
      }
    },
    [stopScreen],
  )

  const clearNotice = useCallback(() => setNotice(null), [])

  useEffect(() => {
    const media = navigator.mediaDevices
    if (!media?.addEventListener) return
    const onChange = () => void refreshDevices()
    media.addEventListener('devicechange', onChange)
    return () => media.removeEventListener('devicechange', onChange)
  }, [refreshDevices])

  useEffect(() => {
    return () => {
      generation.current += 1
      processorRef.current?.stop()
      micRef.current?.stop()
      camRef.current?.stop()
      screenRef.current?.getTracks().forEach((track) => track.stop())
      const graph = gainRef.current
      if (graph) {
        graph.source.disconnect()
        graph.track.stop()
      }
    }
  }, [])

  return {
    prefs,
    devices,
    facing,
    micTrack,
    camTrack,
    videoTrack,
    outgoingMic,
    screenStream,
    micOn,
    camOn: videoTrack !== null,
    deafened,
    pending,
    waitingPermission,
    error,
    notice,
    sharing: screenStream !== null,
    screenEcho: screenStream !== null && screenEcho,
    effectsCapable,
    effectsStatus,
    effectsOn: active,
    start,
    retry,
    stopAll,
    toggleMic,
    toggleCam,
    toggleDeafen,
    switchCamera,
    setDevice,
    setSpeaker,
    setProcessing,
    setMicVolume,
    setRemoteVolume,
    setQuality,
    setEffects,
    setMirror,
    setName,
    setJoinDefaults,
    snapshot,
    startScreen,
    stopScreen,
    refreshDevices,
    clearNotice,
  }
}

export type LocalMedia = ReturnType<typeof useLocalMedia>
