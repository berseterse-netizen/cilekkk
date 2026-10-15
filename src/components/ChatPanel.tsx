import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ChatLine, RoomStatus } from '../hooks/useRoom'
import { SendIcon } from './Icons'

type ChatPanelProps = {
  status: RoomStatus
  messages: ChatLine[]
  onSend: (text: string) => void
  autoFocus?: boolean
}

const timeFormat = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' })
const linkPattern = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g

/** Metindeki bağlantıları güvenli <a> öğelerine çevirir. */
function withLinks(text: string): ReactNode[] {
  const parts = text.split(linkPattern)
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <a key={index} href={part} target="_blank" rel="noopener noreferrer nofollow">
        {part}
      </a>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  )
}

export function ChatPanel({ status, messages, onSend, autoFocus = false }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const list = listRef.current
    if (list && stick.current) list.scrollTop = list.scrollHeight
  }, [messages])

  useEffect(() => {
    if (!autoFocus || !window.matchMedia('(pointer: fine)').matches) return
    // Kısayol tuşunun (C) harfi kutuya yazılmasın diye odak bir sonraki karede verilir.
    const frame = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(frame)
  }, [autoFocus])

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || status !== 'in') return
    onSend(text)
    setDraft('')
    stick.current = true
  }

  return (
    <div className="chat">
      <div
        className="chat-log"
        ref={listRef}
        aria-live="polite"
        onScroll={(event) => {
          const node = event.currentTarget
          stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
        }}
      >
        {messages.length === 0 ? <p className="chat-empty">Henüz mesaj yok. Bir merhaba yaz 🍓</p> : null}
        {messages.map((line, index) => {
          const previous = messages[index - 1]
          const grouped = previous && previous.self === line.self && previous.name === line.name && line.at - previous.at < 120_000
          return (
            <div key={line.id} className={['bubble-row', line.self ? 'self' : 'other', grouped ? 'is-grouped' : ''].filter(Boolean).join(' ')}>
              {!grouped ? (
                <span className="who">
                  {line.self ? 'sen' : line.name}
                  <time dateTime={new Date(line.at).toISOString()}>{timeFormat.format(line.at)}</time>
                </span>
              ) : null}
              <p className="bubble">{withLinks(line.text)}</p>
            </div>
          )
        })}
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          maxLength={600}
          placeholder={status === 'in' ? 'Mesaj yaz…' : 'Bağlanıyor…'}
          aria-label="Mesaj"
          disabled={status !== 'in'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button className="icon-btn send" type="submit" disabled={status !== 'in' || draft.trim() === ''} aria-label="Gönder">
          <SendIcon />
        </button>
      </form>
    </div>
  )
}
