import type { ReactNode } from 'react'

type IconProps = { off?: boolean }

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  )
}

export function MicIcon({ off = false }: IconProps) {
  return (
    <Icon>
      <path d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" />
      {off ? <path d="M4.5 4.5l15 15" /> : null}
    </Icon>
  )
}

export function CamIcon({ off = false }: IconProps) {
  return (
    <Icon>
      <path d="M3.5 8.5a2 2 0 0 1 2-2h8.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" />
      <path d="m15.7 10.6 4.8-2.6v8l-4.8-2.6" />
      {off ? <path d="M4 4.5 19.5 20" /> : null}
    </Icon>
  )
}

export function ScreenIcon() {
  return (
    <Icon>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16.5V20M12 13.5v-6M9.2 10.2 12 7.5l2.8 2.7" />
    </Icon>
  )
}

export function LeaveIcon() {
  return (
    <Icon>
      <path d="M5.2 14.6c-.9-.9-.9-2.3 0-3.2 3.8-3.8 9.8-3.8 13.6 0 .9.9.9 2.3 0 3.2l-1.3 1.2a1.2 1.2 0 0 1-1.6.1l-1.6-1.2a1.2 1.2 0 0 1-.5-1v-1.3a8 8 0 0 0-3.6 0v1.3c0 .4-.2.8-.5 1l-1.6 1.2a1.2 1.2 0 0 1-1.6-.1Z" />
    </Icon>
  )
}

export function SparkleIcon() {
  return (
    <Icon>
      <path d="M12 3.5 13.6 8a3 3 0 0 0 1.9 1.9l4.5 1.6-4.5 1.6a3 3 0 0 0-1.9 1.9L12 19.5 10.4 15a3 3 0 0 0-1.9-1.9L4 11.5 8.5 9.9A3 3 0 0 0 10.4 8Z" />
      <path d="M19 3v3M17.5 4.5h3" />
    </Icon>
  )
}

export function GearIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.5 7.5 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4Z" />
    </Icon>
  )
}

export function ChatIcon() {
  return (
    <Icon>
      <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-4.2 3.2c-.5.4-1.3 0-1.3-.6Z" />
      <path d="M8.5 9.5h7M8.5 12.5h4.5" />
    </Icon>
  )
}

export function PeopleIcon() {
  return (
    <Icon>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17 14.2a5 5 0 0 1 3.5 4.8" />
    </Icon>
  )
}

export function SmileIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14a4.2 4.2 0 0 0 7 0M9.2 9.6h.01M14.8 9.6h.01" />
    </Icon>
  )
}

export function HeadphonesIcon({ off = false }: IconProps) {
  return (
    <Icon>
      <path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3" />
      <path d="M4.5 14.5h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1ZM19.5 14.5h-2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1Z" />
      {off ? <path d="M4 4.5 20 20" /> : null}
    </Icon>
  )
}

export function CopyIcon() {
  return (
    <Icon>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </Icon>
  )
}

export function ShareIcon() {
  return (
    <Icon>
      <path d="M12 14.5V4M8.5 7.5 12 4l3.5 3.5" />
      <path d="M8 10.5H6.5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H16" />
    </Icon>
  )
}

export function ExpandIcon({ off = false }: IconProps) {
  return off ? (
    <Icon>
      <path d="M9 4.5V9H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5" />
    </Icon>
  ) : (
    <Icon>
      <path d="M4.5 9V4.5H9M19.5 9V4.5H15M4.5 15v4.5H9M19.5 15v4.5H15" />
    </Icon>
  )
}

export function PipIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11.5" width="6.5" height="5" rx="1" />
    </Icon>
  )
}

export function FlipIcon() {
  return (
    <Icon>
      <path d="M4.5 9.5a7.5 7.5 0 0 1 13.4-3.2M19.5 14.5a7.5 7.5 0 0 1-13.4 3.2" />
      <path d="M18.5 3.5v3.5H15M5.5 20.5V17H9" />
    </Icon>
  )
}

export function PhotoIcon() {
  return (
    <Icon>
      <path d="M4 8.5a2 2 0 0 1 2-2h2l1.4-2h5.2L16 6.5h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </Icon>
  )
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  )
}

export function SendIcon() {
  return (
    <Icon>
      <path d="M4.5 12 19.5 4.5 15 19.5l-3-6Z" />
      <path d="m12 13.5 7.5-9" />
    </Icon>
  )
}

export function DownloadIcon() {
  return (
    <Icon>
      <path d="M12 4v10.5M8 10.5l4 4 4-4M5 19.5h14" />
    </Icon>
  )
}

export function LinkIcon() {
  return (
    <Icon>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Icon>
  )
}

export function SignalIcon({ level }: { level: 0 | 1 | 2 | 3 }) {
  return (
    <svg className={`icon signal is-${level}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 18v-2" className={level >= 1 ? 'on' : ''} />
      <path d="M10 18v-5" className={level >= 2 ? 'on' : ''} />
      <path d="M15 18v-8" className={level >= 3 ? 'on' : ''} />
      <path d="M20 18V7" className={level >= 3 ? 'on' : ''} />
    </svg>
  )
}
