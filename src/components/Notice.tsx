import { StrawberryMark } from './StrawberryMark'

type NoticeProps = {
  title: string
  copy: string
  action: string
  onAction: () => void
  busy?: boolean
}

export function Notice({ title, copy, action, onAction, busy = false }: NoticeProps) {
  return (
    <main className="lobby is-notice">
      <section className="panel notice" aria-live="polite">
        <StrawberryMark size={112} float />
        <p className="eyebrow">çilek</p>
        <h2>{title}</h2>
        <p className="panel-copy">
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {copy}
        </p>
        <button className="btn primary" type="button" onClick={onAction}>
          {action}
        </button>
      </section>
    </main>
  )
}
