type StrawberryMarkProps = {
  size?: number
  float?: boolean
}

const seeds: Array<[number, number, number]> = [
  [78, 108, -18],
  [100, 102, 8],
  [122, 110, 16],
  [68, 128, -10],
  [90, 124, 6],
  [112, 128, -8],
  [132, 122, 14],
  [78, 146, 12],
  [100, 142, -6],
  [122, 148, 10],
  [88, 164, -12],
  [110, 162, 8],
]

export function StrawberryMark({ size = 180, float = false }: StrawberryMarkProps) {
  return (
    <svg
      className={float ? 'berry is-floating' : 'berry'}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden="true"
    >
      <ellipse cx="100" cy="168" rx="36" ry="8" fill="#e7b9c4" opacity="0.45" />
      <path
        d="M100 62c28 0 52 24 56 54 5 36-18 74-56 78-38-4-61-42-56-78 4-30 28-54 56-54z"
        fill="#e23b5a"
      />
      <ellipse cx="78" cy="104" rx="18" ry="14" fill="#ff9aaf" opacity="0.55" />
      {seeds.map(([x, y, rotate]) => (
        <ellipse
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          rx="3.2"
          ry="4.4"
          fill="#f8e7c4"
          transform={`rotate(${rotate} ${x} ${y})`}
        />
      ))}
      <g fill="#3d9a5c">
        <ellipse cx="100" cy="58" rx="14" ry="26" transform="rotate(-6 100 58)" />
        <ellipse cx="80" cy="64" rx="13" ry="24" transform="rotate(-42 80 64)" />
        <ellipse cx="120" cy="64" rx="13" ry="24" transform="rotate(42 120 64)" />
        <ellipse cx="64" cy="76" rx="11" ry="20" transform="rotate(-70 64 76)" />
        <ellipse cx="138" cy="74" rx="11" ry="20" transform="rotate(72 138 74)" />
      </g>
      <rect x="97" y="30" width="6" height="20" rx="3" fill="#2d7a48" />
    </svg>
  )
}
