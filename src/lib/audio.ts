let shared: AudioContext | null = null

/** Tüm ses ölçümleri ve kazanç için tek bir AudioContext; tarayıcı sınırına takılmaz. */
export function audioContext() {
  if (!shared || shared.state === 'closed') {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    shared = new Context({ latencyHint: 'interactive' })
  }
  if (shared.state === 'suspended') void shared.resume().catch(() => {})
  return shared
}

export function resumeAudio() {
  if (shared && shared.state === 'suspended') void shared.resume().catch(() => {})
}
