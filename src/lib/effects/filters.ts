export type FilterId = 'none' | 'warm' | 'cool' | 'vivid' | 'berry' | 'pastel' | 'mono' | 'noir' | 'sepia' | 'vintage'
export type BackgroundId = 'none' | 'portrait' | 'blur' | 'berry'

export type Effects = {
  filter: FilterId
  background: BackgroundId
  /** -0.5 … 0.5 */
  brightness: number
  /** 0 … 1 */
  smooth: number
}

export type FilterParams = {
  saturation: number
  contrast: number
  brightness: number
  warmth: number
  tint: number
  sepia: number
  fade: number
  vignette: number
}

const neutral: FilterParams = { saturation: 1, contrast: 1, brightness: 0, warmth: 0, tint: 0, sepia: 0, fade: 0, vignette: 0 }

export const FILTERS: Array<{ id: FilterId; label: string; css: string; params: FilterParams }> = [
  { id: 'none', label: 'Doğal', css: 'none', params: neutral },
  {
    id: 'warm',
    label: 'Sıcak',
    css: 'saturate(1.12) sepia(0.18) brightness(1.03)',
    params: { ...neutral, saturation: 1.1, warmth: 0.7, brightness: 0.02 },
  },
  {
    id: 'cool',
    label: 'Serin',
    css: 'saturate(1.05) hue-rotate(-8deg) brightness(1.02)',
    params: { ...neutral, saturation: 1.02, warmth: -0.7, tint: -0.1, brightness: 0.01 },
  },
  {
    id: 'vivid',
    label: 'Canlı',
    css: 'saturate(1.45) contrast(1.08)',
    params: { ...neutral, saturation: 1.42, contrast: 1.08 },
  },
  {
    id: 'berry',
    label: 'Çilek',
    css: 'saturate(1.15) sepia(0.12) hue-rotate(-12deg) brightness(1.04)',
    params: { ...neutral, saturation: 1.12, warmth: 0.35, tint: -0.45, brightness: 0.03, vignette: 0.15 },
  },
  {
    id: 'pastel',
    label: 'Pastel',
    css: 'saturate(0.8) contrast(0.9) brightness(1.08)',
    params: { ...neutral, saturation: 0.82, contrast: 0.88, brightness: 0.04, fade: 0.35, tint: -0.15 },
  },
  {
    id: 'mono',
    label: 'S/B',
    css: 'grayscale(1) contrast(1.05)',
    params: { ...neutral, saturation: 0, contrast: 1.05 },
  },
  {
    id: 'noir',
    label: 'Noir',
    css: 'grayscale(1) contrast(1.4) brightness(0.92)',
    params: { ...neutral, saturation: 0, contrast: 1.38, brightness: -0.04, vignette: 0.45 },
  },
  {
    id: 'sepia',
    label: 'Sepya',
    css: 'sepia(0.85)',
    params: { ...neutral, sepia: 0.85 },
  },
  {
    id: 'vintage',
    label: 'Eski',
    css: 'sepia(0.35) saturate(0.85) contrast(0.92) brightness(1.04)',
    params: { ...neutral, sepia: 0.3, saturation: 0.85, contrast: 0.92, fade: 0.4, vignette: 0.35, warmth: 0.25 },
  },
]

export const BACKGROUNDS: Array<{ id: BackgroundId; label: string; hint: string }> = [
  { id: 'none', label: 'Kapalı', hint: 'Arka plan olduğu gibi' },
  { id: 'portrait', label: 'Portre', hint: 'Arkayı hafifçe bulanıklaştırır' },
  { id: 'blur', label: 'Güçlü', hint: 'Arkayı tamamen siler gibi bulanıklaştırır' },
  { id: 'berry', label: 'Çilek', hint: 'Arkaya pembe bir fon koyar' },
]

export function filterParams(id: FilterId) {
  return FILTERS.find((item) => item.id === id)?.params ?? neutral
}

export function effectsActive(effects: Effects) {
  return effects.filter !== 'none' || effects.background !== 'none' || Math.abs(effects.brightness) > 0.005 || effects.smooth > 0.01
}
