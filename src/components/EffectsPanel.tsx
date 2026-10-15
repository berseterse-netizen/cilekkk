import { useMemo, useState } from 'react'
import type { LocalMedia } from '../hooks/useLocalMedia'
import { BACKGROUNDS, FILTERS } from '../lib/effects/filters'
import { defaultEffects } from '../lib/prefs'
import { CamIcon, CloseIcon, FlipIcon, PhotoIcon } from './Icons'
import { VideoSurface } from './VideoSurface'

type EffectsPanelProps = {
  media: LocalMedia
  onClose: () => void
  onToast: (text: string) => void
}

function fileStamp() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export function EffectsPanel({ media, onClose, onToast }: EffectsPanelProps) {
  const { effects, mirror } = media.prefs
  const [flash, setFlash] = useState(false)
  const preview = useMemo(() => (media.videoTrack ? new MediaStream([media.videoTrack]) : null), [media.videoTrack])
  const raw = useMemo(() => (media.camTrack ? new MediaStream([media.camTrack]) : null), [media.camTrack])
  const canSwitch = media.devices.cams.length > 1 || /Android|iPhone|iPad/i.test(navigator.userAgent)

  async function takePhoto() {
    setFlash(true)
    window.setTimeout(() => setFlash(false), 180)
    const blob = await media.snapshot()
    if (!blob) {
      onToast('Fotoğraf çekilemedi.')
      return
    }
    const file = new File([blob], `cilek-${fileStamp()}.jpg`, { type: 'image/jpeg' })
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
    if (nav.canShare?.({ files: [file] }) && window.matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ files: [file], title: 'çilek' }).catch(() => {})
      return
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    onToast('Fotoğraf kaydedildi.')
  }

  return (
    <section className="popover effects" role="dialog" aria-label="Kamera efektleri">
      <header className="popover-head">
        <strong>Kamera</strong>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Kapat">
          <CloseIcon />
        </button>
      </header>

      {!media.camOn ? (
        <div className="effects-off">
          <p>Efektleri görmek için kamerayı aç.</p>
          <button className="btn primary" type="button" onClick={() => void media.toggleCam()} disabled={media.pending}>
            <CamIcon /> Kamerayı aç
          </button>
        </div>
      ) : (
        <>
          <div className={flash ? 'effects-preview is-flash' : 'effects-preview'}>
            <VideoSurface stream={preview} mirror={mirror} />
            {media.effectsStatus === 'loading' ? <p className="preview-chip">Portre modu hazırlanıyor…</p> : null}
            {media.effectsStatus === 'error' ? <p className="preview-chip is-error">Portre modu yüklenemedi</p> : null}
            <div className="preview-tools">
              {canSwitch ? (
                <button className="tile-btn" type="button" onClick={() => void media.switchCamera()} aria-label="Kamerayı çevir" title="Kamerayı çevir">
                  <FlipIcon />
                </button>
              ) : null}
              <button className="tile-btn" type="button" onClick={() => void takePhoto()} aria-label="Fotoğraf çek" title="Fotoğraf çek">
                <PhotoIcon />
              </button>
            </div>
          </div>

          {!media.effectsCapable ? (
            <p className="effects-note">Bu tarayıcı kamera efektlerini desteklemiyor. Güncel Chrome, Edge, Firefox ya da Safari dene.</p>
          ) : (
            <>
              <p className="section-label">Arka plan</p>
              <div className="chip-row" role="radiogroup" aria-label="Arka plan">
                {BACKGROUNDS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={effects.background === item.id}
                    title={item.hint}
                    className={effects.background === item.id ? `bg-chip bg-${item.id} is-on` : `bg-chip bg-${item.id}`}
                    onClick={() => media.setEffects({ background: item.id })}
                  >
                    <span className="bg-swatch" aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>

              <p className="section-label">Filtre</p>
              <div className="filter-grid" role="radiogroup" aria-label="Filtre">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={effects.filter === item.id}
                    className={effects.filter === item.id ? 'filter-chip is-on' : 'filter-chip'}
                    onClick={() => media.setEffects({ filter: item.id })}
                  >
                    <VideoSurface stream={raw} mirror={mirror} style={{ filter: item.css }} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              <label className="slider">
                <span>
                  Işık <b>{Math.round(effects.brightness * 200)}</b>
                </span>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  value={Math.round(effects.brightness * 100)}
                  onChange={(event) => media.setEffects({ brightness: Number(event.target.value) / 100 })}
                />
              </label>
              <label className="slider">
                <span>
                  Cilt yumuşatma <b>{Math.round(effects.smooth * 100)}</b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(effects.smooth * 100)}
                  onChange={(event) => media.setEffects({ smooth: Number(event.target.value) / 100 })}
                />
              </label>
            </>
          )}

          <div className="popover-foot">
            <label className="switch">
              <input type="checkbox" checked={mirror} onChange={(event) => media.setMirror(event.target.checked)} />
              <span>Kendimi ayna gibi gör</span>
            </label>
            <button className="btn ghost small" type="button" onClick={() => media.setEffects(defaultEffects)}>
              Sıfırla
            </button>
          </div>
        </>
      )}
    </section>
  )
}
