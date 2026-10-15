import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Avatar } from './Avatar'
import { ExpandIcon, MicIcon, PipIcon } from './Icons'
import type { Member } from './types'
import { connectionLabel } from './types'
import { VideoSurface } from './VideoSurface'

type TileProps = {
  member: Member
  stream: MediaStream | null
  label: string
  screen?: boolean
  mirror?: boolean
  speaking: boolean
  pinned?: boolean
  className?: string
  children?: ReactNode
  fullscreenExtras?: ReactNode
  onFullscreen?: (open: boolean) => void
}

const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled

/** Tek bir görüntü kutusu: video ya da avatar, ad etiketi, tam ekran ve pencere içinde oynatma. */
export function Tile({
  member,
  stream,
  label,
  screen = false,
  mirror = false,
  speaking,
  pinned = false,
  className,
  children,
  fullscreenExtras,
  onFullscreen,
}: TileProps) {
  const ref = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [full, setFull] = useState(false)
  const bindVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element
  }, [])
  const hasVideo = stream !== null
  const waiting = !member.self && member.connection !== 'connected'

  function toggleFull() {
    const node = ref.current
    if (!node) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    if (node.requestFullscreen) {
      void node
        .requestFullscreen()
        .then(() => {
          setFull(true)
          onFullscreen?.(true)
          const done = () => {
            if (document.fullscreenElement === node) return
            setFull(false)
            onFullscreen?.(false)
            document.removeEventListener('fullscreenchange', done)
          }
          document.addEventListener('fullscreenchange', done)
        })
        .catch(() => {})
      return
    }
    // iPhone Safari yalnızca videonun kendisini tam ekran yapabilir.
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    video?.webkitEnterFullscreen?.()
  }

  function togglePip() {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {})
    else void video.requestPictureInPicture().catch(() => {})
  }

  return (
    <div
      ref={ref}
      className={[
        'tile',
        screen ? 'is-screen' : '',
        pinned ? 'is-pin' : '',
        speaking && !screen ? 'is-speaking' : '',
        hasVideo ? '' : 'is-avatar',
        full ? 'is-full' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {hasVideo ? (
        <VideoSurface stream={stream} mirror={mirror} contain={screen} onElement={bindVideo} />
      ) : (
        <div className="tile-avatar">
          <Avatar name={member.name} seed={member.id} size={96} />
          {waiting ? <p className="tile-wait">{connectionLabel(member)}</p> : null}
        </div>
      )}

      <p className="tile-label">
        {!screen && !member.micOn ? (
          <span className="tile-mute" aria-label="Mikrofon kapalı">
            <MicIcon off />
          </span>
        ) : null}
        <span>{label}</span>
      </p>

      {hasVideo ? (
        <div className="tile-tools">
          {pipSupported && !member.self ? (
            <button className="tile-btn" type="button" onClick={togglePip} title="Pencere içinde oynat" aria-label="Pencere içinde oynat">
              <PipIcon />
            </button>
          ) : null}
          <button className="tile-btn" type="button" onClick={toggleFull} title={full ? 'Küçült' : 'Tam ekran'} aria-label={full ? 'Küçült' : 'Tam ekran'}>
            <ExpandIcon off={full} />
          </button>
        </div>
      ) : null}

      {children}
      {full ? fullscreenExtras : null}
    </div>
  )
}
