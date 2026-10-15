import { useState, type FormEvent } from 'react'
import { normalizeRoomCode } from '../lib/room'
import { CamIcon, DownloadIcon, MicIcon, ShareIcon } from './Icons'
import { StrawberryMark } from './StrawberryMark'

type LobbyProps = {
  inviteReady: boolean
  name: string
  joinWithCam: boolean
  joinWithMic: boolean
  install: { canInstall: boolean; iosHint: boolean; install: () => Promise<void> }
  onName: (name: string) => void
  onJoinDefaults: (patch: { joinWithCam?: boolean; joinWithMic?: boolean }) => void
  onCreate: () => void
  onJoin: (code: string) => void
  onAcceptInvite: () => void
}

export function Lobby({
  inviteReady,
  name,
  joinWithCam,
  joinWithMic,
  install,
  onName,
  onJoinDefaults,
  onCreate,
  onJoin,
  onAcceptInvite,
}: LobbyProps) {
  const [code, setCode] = useState('')
  const ready = code.length === 6

  function submit(event: FormEvent) {
    event.preventDefault()
    if (ready) onJoin(code)
  }

  return (
    <main className="lobby">
      <section className="hero">
        <StrawberryMark size={180} float />
        <p className="eyebrow">iki kişilik oda</p>
        <h1>çilek</h1>
        <p className="lead">Sesli ve görüntülü görüşme, ekran paylaşımı, filtreler ve portre modu. Kayıt yok, kurulum yok.</p>
        <ul className="perks">
          <li>Yankı ve gürültü engelleme</li>
          <li>Portre modu ve filtreler</li>
          <li>Ekran ve ses paylaşımı</li>
        </ul>
        {install.canInstall ? (
          <button className="btn ghost install" type="button" onClick={() => void install.install()}>
            <DownloadIcon />
            Uygulamayı yükle
          </button>
        ) : install.iosHint ? (
          <p className="install-hint">
            <ShareIcon /> Uygulama gibi kullanmak için Paylaş → <b>Ana Ekrana Ekle</b>.
          </p>
        ) : null}
      </section>

      <section className="panel">
        <label className="field">
          <span>Adın</span>
          <input
            value={name}
            maxLength={24}
            placeholder="ör. Deniz"
            autoComplete="nickname"
            onChange={(event) => onName(event.target.value)}
          />
        </label>

        <div className="join-prefs" role="group" aria-label="Katılırken">
          <button
            type="button"
            className={joinWithMic ? 'toggle is-on' : 'toggle'}
            aria-pressed={joinWithMic}
            onClick={() => onJoinDefaults({ joinWithMic: !joinWithMic })}
          >
            <MicIcon off={!joinWithMic} />
            {joinWithMic ? 'Mikrofon açık' : 'Mikrofon kapalı'}
          </button>
          <button
            type="button"
            className={joinWithCam ? 'toggle is-on' : 'toggle'}
            aria-pressed={joinWithCam}
            onClick={() => onJoinDefaults({ joinWithCam: !joinWithCam })}
          >
            <CamIcon off={!joinWithCam} />
            {joinWithCam ? 'Kamera açık' : 'Kamera kapalı'}
          </button>
        </div>

        {inviteReady ? (
          <>
            <h2>Seni çağırdılar</h2>
            <p className="panel-copy">Bu davet tek kişiliktir, kullanılınca geçersiz olur.</p>
            <button className="btn primary" type="button" onClick={onAcceptInvite}>
              Görüşmeye katıl
            </button>
          </>
        ) : (
          <>
            <h2>Bir oda aç</h2>
            <p className="panel-copy">Altı karakterlik bir kod oluşur. İkinci kişi gelince oda kilitlenir.</p>
            <button className="btn primary" type="button" onClick={onCreate}>
              Oda aç
            </button>

            <div className="split" role="separator">
              <span>ya da</span>
            </div>

            <form onSubmit={submit}>
              <label htmlFor="room-code">Kodun ya da bağlantın varsa</label>
              <div className="join-row">
                <input
                  id="room-code"
                  value={code}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={200}
                  placeholder="K7QMPL"
                  onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
                  onPaste={(event) => {
                    event.preventDefault()
                    setCode(normalizeRoomCode(event.clipboardData.getData('text')))
                  }}
                />
                <button className="btn leaf" type="submit" disabled={!ready}>
                  Katıl
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
