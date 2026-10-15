import { initials } from './types'

const hues = [350, 12, 330, 145, 28, 300, 200, 160]

function hueOf(seed: string) {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return hues[Math.abs(hash) % hues.length]!
}

export function Avatar({ name, seed, size = 40 }: { name: string; seed: string; size?: number }) {
  const hue = hueOf(seed)
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: `linear-gradient(160deg, hsl(${hue} 90% 78%), hsl(${hue} 72% 60%))`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
