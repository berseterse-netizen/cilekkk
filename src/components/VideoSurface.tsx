import { useEffect, useRef, type CSSProperties } from 'react'

type VideoSurfaceProps = {
  stream: MediaStream | null
  mirror?: boolean
  contain?: boolean
  className?: string
  style?: CSSProperties
  onElement?: (element: HTMLVideoElement | null) => void
}

function liveKey(stream: MediaStream | null) {
  if (!stream) return ''
  return stream
    .getVideoTracks()
    .filter((track) => track.readyState === 'live')
    .map((track) => track.id)
    .join('|')
}

/** Her zaman sessiz video; ses ayrı <audio> öğelerinden çalınır (yankı engelleme için önemli). */
export function VideoSurface({ stream, mirror = false, contain = false, className, style, onElement }: VideoSurfaceProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const key = liveKey(stream)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (!stream || !key) {
      element.srcObject = null
      return
    }
    if (element.srcObject !== stream) element.srcObject = stream
    void element.play().catch(() => {})
  }, [stream, key])

  useEffect(() => {
    onElement?.(ref.current)
    return () => onElement?.(null)
  }, [onElement])

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      style={style}
      className={['surface', mirror ? 'is-mirror' : '', contain ? 'is-contain' : '', className ?? ''].filter(Boolean).join(' ')}
    />
  )
}
