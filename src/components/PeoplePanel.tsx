import { Avatar } from './Avatar'
import { CamIcon, CopyIcon, HeadphonesIcon, LinkIcon, MicIcon, ShareIcon, SignalIcon } from './Icons'
import type { Member } from './types'
import { connectionLabel, signalLevel } from './types'

type PeoplePanelProps = {
  members: Member[]
  talk: Record<string, boolean>
  watchId: string | null
  volumes: Record<string, number>
  inviteLink: string | null
  canInvite: boolean
  detail: string
  onWatch: (id: string | null) => void
  onVolume: (id: string, value: number) => void
  onInvite: () => void
  onCopy: (text: string, done: string) => void
  onShare: (url: string) => void
}

export function PeoplePanel({
  members,
  talk,
  watchId,
  volumes,
  inviteLink,
  canInvite,
  detail,
  onWatch,
  onVolume,
  onInvite,
  onCopy,
  onShare,
}: PeoplePanelProps) {
  return (
    <div className="people">
      <ul className="member-list">
        {members.map((member) => (
          <li key={member.id} className={['member', talk[member.id] ? 'is-speaking' : '', watchId === member.id ? 'is-focus' : ''].filter(Boolean).join(' ')}>
            <span className="member-ava">
              <Avatar name={member.name} seed={member.id} size={38} />
            </span>
            <span className="member-meta">
              <span className="member-name">
                {member.name}
                {member.self ? <em> (sen)</em> : null}
              </span>
              <span className="member-sub">
                {member.live ? <span className="live-badge">YAYINDA</span> : null}
                {!member.self ? (
                  <span className="member-net" title={connectionLabel(member)}>
                    <SignalIcon level={signalLevel(member)} />
                    {connectionLabel(member)}
                  </span>
                ) : null}
                {member.relayed ? (
                  <span className="relay-badge" title="Doğrudan bağlantı kurulamadı; görüntü sunucu (TURN) üzerinden geçiyor">
                    TURN
                  </span>
                ) : null}
              </span>
            </span>
            <span className="member-flags">
              {member.deaf ? (
                <span className="is-mute" title="Sesi kapalı">
                  <HeadphonesIcon off />
                </span>
              ) : null}
              <span className={member.camOn ? '' : 'is-dim'} title={member.camOn ? 'Kamera açık' : 'Kamera kapalı'}>
                <CamIcon off={!member.camOn} />
              </span>
              <span className={member.micOn ? '' : 'is-mute'} title={member.micOn ? 'Mikrofon açık' : 'Mikrofon kapalı'}>
                <MicIcon off={!member.micOn} />
              </span>
            </span>
            {!member.self ? (
              <label className="member-volume">
                <span>Ses %{Math.round((volumes[member.id] ?? 1) * 100)}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round((volumes[member.id] ?? 1) * 100)}
                  onChange={(event) => onVolume(member.id, Number(event.target.value) / 100)}
                  aria-label={`${member.name} ses seviyesi`}
                />
              </label>
            ) : null}
            {!member.self && member.live ? (
              watchId === member.id ? (
                <button className="live-action is-leave" type="button" onClick={() => onWatch(null)}>
                  Yayından ayrıl
                </button>
              ) : (
                <button className="live-action" type="button" onClick={() => onWatch(member.id)}>
                  Yayını izle
                </button>
              )
            ) : null}
          </li>
        ))}
      </ul>

      <div className="invite-card">
        <strong>Bir kişi daha çağır</strong>
        <p>Oda iki kişide kilitlenir. Üçüncü kişi için tek kullanımlık davet bağlantısı oluştur.</p>
        {inviteLink ? (
          <div className="invite-link">
            <input readOnly value={inviteLink} aria-label="Davet bağlantısı" onFocus={(event) => event.currentTarget.select()} />
            <button className="icon-btn" type="button" onClick={() => onCopy(inviteLink, 'Davet bağlantısı kopyalandı.')} aria-label="Kopyala" title="Kopyala">
              <CopyIcon />
            </button>
            {'share' in navigator ? (
              <button className="icon-btn" type="button" onClick={() => onShare(inviteLink)} aria-label="Paylaş" title="Paylaş">
                <ShareIcon />
              </button>
            ) : null}
          </div>
        ) : null}
        {detail ? <p className="invite-error">{detail}</p> : null}
        <button className="btn leaf small" type="button" onClick={onInvite} disabled={!canInvite}>
          <LinkIcon /> {inviteLink ? 'Yeni davet oluştur' : 'Davet oluştur'}
        </button>
      </div>
    </div>
  )
}
