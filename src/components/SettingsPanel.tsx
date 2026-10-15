import { useEffect, useRef } from 'react'
import type { LocalMedia } from '../hooks/useLocalMedia'
import { useLevel } from '../hooks/useSpeaking'
import type { CameraQuality } from '../lib/prefs'
import { CloseIcon, DownloadIcon } from './Icons'

type SettingsPanelProps = {
  media: LocalMedia
  install: { canInstall: boolean; iosHint: boolean; installed: boolean; install: () => Promise<void> }
  onClose: () => void
}

const speakerSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
const qualities: Array<{ value: CameraQuality; label: string }> = [
  { value: 360, label: 'Düşük (360p)' },
  { value: 720, label: 'HD (720p)' },
  { value: 1080, label: 'Full HD (1080p)' },
]

const shortcuts: Array<[string, string]> = [
  ['M', 'Mikrofonu aç/kapat'],
  ['V', 'Kamerayı aç/kapat'],
  ['D', 'Sesi tamamen kapat (sağırlaştır)'],
  ['E', 'Kamera efektleri'],
  ['C', 'Sohbet'],
  ['Esc', 'Açık pencereyi kapat'],
]

function deviceLabel(device: MediaDeviceInfo, index: number, fallback: string) {
  return device.label || `${fallback} ${index + 1}`
}

export function SettingsPanel({ media, install, onClose }: SettingsPanelProps) {
  const { prefs, devices } = media
  const level = useLevel(media.micTrack, media.micOn)
  const dialogRef = useRef<HTMLDivElement>(null)
  const currentMic = media.micTrack?.getSettings().deviceId ?? prefs.micId
  const currentCam = media.camTrack?.getSettings().deviceId ?? prefs.camId

  useEffect(() => {
    void media.refreshDevices()
    dialogRef.current?.focus()
  }, [media.refreshDevices])

  return (
    <div className="modal-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Ayarlar" tabIndex={-1} ref={dialogRef}>
        <header className="popover-head">
          <strong>Ayarlar</strong>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Kapat">
            <CloseIcon />
          </button>
        </header>

        <div className="modal-body">
          <section className="settings-group">
            <h3>Profil</h3>
            <label className="field">
              <span>Görünen adın</span>
              <input value={prefs.name} maxLength={24} placeholder="ör. Deniz" onChange={(event) => media.setName(event.target.value)} />
            </label>
          </section>

          <section className="settings-group">
            <h3>Ses</h3>
            <label className="field">
              <span>Mikrofon</span>
              <select value={currentMic} onChange={(event) => void media.setDevice('audio', event.target.value)}>
                {devices.mics.length === 0 ? <option value="">Varsayılan</option> : null}
                {devices.mics.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {deviceLabel(device, index, 'Mikrofon')}
                  </option>
                ))}
              </select>
            </label>
            <div className="meter" aria-hidden="true">
              <span style={{ transform: `scaleX(${level})` }} />
            </div>
            {speakerSupported && devices.speakers.length > 0 ? (
              <label className="field">
                <span>Hoparlör</span>
                <select value={prefs.speakerId} onChange={(event) => media.setSpeaker(event.target.value)}>
                  <option value="">Sistem varsayılanı</option>
                  {devices.speakers
                    .filter((device) => device.deviceId !== 'default')
                    .map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {deviceLabel(device, index, 'Hoparlör')}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <label className="slider">
              <span>
                Mikrofon seviyesi <b>%{prefs.micVolume}</b>
              </span>
              <input type="range" min={0} max={200} step={5} value={prefs.micVolume} onChange={(event) => media.setMicVolume(Number(event.target.value))} />
            </label>
            <label className="slider">
              <span>
                Gelen ses <b>%{prefs.remoteVolume}</b>
              </span>
              <input type="range" min={0} max={100} step={5} value={prefs.remoteVolume} onChange={(event) => media.setRemoteVolume(Number(event.target.value))} />
            </label>
            <label className="switch">
              <input type="checkbox" checked={prefs.echo} onChange={(event) => void media.setProcessing({ echo: event.target.checked })} />
              <span>
                Yankı engelleme
                <small>Hoparlörden çıkan sesin mikrofona geri dönmesini önler. Kulaklık yoksa açık tut.</small>
              </span>
            </label>
            <label className="switch">
              <input type="checkbox" checked={prefs.noise} onChange={(event) => void media.setProcessing({ noise: event.target.checked })} />
              <span>
                Gürültü engelleme
                <small>Klavye, fan ve sokak sesini bastırır. Müzik çalıyorsan kapat.</small>
              </span>
            </label>
            <label className="switch">
              <input type="checkbox" checked={prefs.agc} onChange={(event) => void media.setProcessing({ agc: event.target.checked })} />
              <span>
                Otomatik ses seviyesi
                <small>Uzaktan ya da yakından konuşsan da sesini dengeler.</small>
              </span>
            </label>
          </section>

          <section className="settings-group">
            <h3>Görüntü</h3>
            <label className="field">
              <span>Kamera</span>
              <select value={currentCam} onChange={(event) => void media.setDevice('video', event.target.value)}>
                {devices.cams.length === 0 ? <option value="">Varsayılan</option> : null}
                {devices.cams.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {deviceLabel(device, index, 'Kamera')}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Kamera kalitesi</span>
              <div className="seg" role="radiogroup" aria-label="Kamera kalitesi">
                {qualities.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={prefs.quality === item.value}
                    className={prefs.quality === item.value ? 'pick is-on' : 'pick'}
                    onClick={() => void media.setQuality(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={prefs.mirror} onChange={(event) => media.setMirror(event.target.checked)} />
              <span>Kendimi ayna gibi gör</span>
            </label>
          </section>

          <section className="settings-group">
            <h3>Uygulama</h3>
            {install.installed ? (
              <p className="muted">Çilek bu cihazda uygulama olarak yüklü.</p>
            ) : install.canInstall ? (
              <button className="btn ghost" type="button" onClick={() => void install.install()}>
                <DownloadIcon /> Uygulamayı yükle
              </button>
            ) : install.iosHint ? (
              <p className="muted">Safari’de Paylaş → Ana Ekrana Ekle ile uygulama olarak yükleyebilirsin.</p>
            ) : (
              <p className="muted">Tarayıcı menüsündeki “Uygulamayı yükle” seçeneğiyle masaüstüne ya da ana ekrana ekleyebilirsin.</p>
            )}
            <dl className="shortcuts">
              {shortcuts.map(([key, label]) => (
                <div key={key}>
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
