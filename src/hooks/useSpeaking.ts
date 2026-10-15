import { useEffect, useState } from 'react'
import { audioContext } from '../lib/audio'

type Probe = { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; samples: Float32Array<ArrayBuffer>; listeners: Set<(level: number) => void> }

const probes = new Map<string, Probe>()
let timer = 0

function loop() {
  for (const probe of probes.values()) {
    probe.analyser.getFloatTimeDomainData(probe.samples)
    let sum = 0
    for (let index = 0; index < probe.samples.length; index += 1) {
      const sample = probe.samples[index]!
      sum += sample * sample
    }
    const level = Math.sqrt(sum / probe.samples.length)
    for (const listener of probe.listeners) listener(level)
  }
}

/** Aynı iz için tek bir ölçer; tüm ölçerler tek zamanlayıcıyla, saniyede ~16 kez okunur. */
function subscribe(track: MediaStreamTrack, listener: (level: number) => void) {
  let probe = probes.get(track.id)
  if (!probe) {
    const context = audioContext()
    const source = context.createMediaStreamSource(new MediaStream([track]))
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    probe = { analyser, source, samples: new Float32Array(analyser.fftSize), listeners: new Set() }
    probes.set(track.id, probe)
  }
  probe.listeners.add(listener)
  if (!timer) timer = window.setInterval(loop, 60)
  return () => {
    const current = probes.get(track.id)
    if (!current) return
    current.listeners.delete(listener)
    if (current.listeners.size === 0) {
      current.source.disconnect()
      probes.delete(track.id)
    }
    if (probes.size === 0) {
      window.clearInterval(timer)
      timer = 0
    }
  }
}

function liveAudio(track: MediaStreamTrack | null | undefined) {
  return track && track.kind === 'audio' && track.readyState === 'live' ? track : null
}

export function useSpeaking(track: MediaStreamTrack | null | undefined, enabled: boolean) {
  const [speaking, setSpeaking] = useState(false)
  const target = enabled ? liveAudio(track) : null

  useEffect(() => {
    if (!target) {
      setSpeaking(false)
      return
    }
    let lit = false
    let until = 0
    const stop = subscribe(target, (level) => {
      const now = performance.now()
      if (level > 0.035) until = now + 380
      const next = now < until
      if (next !== lit) {
        lit = next
        setSpeaking(next)
      }
    })
    return () => {
      stop()
      setSpeaking(false)
    }
  }, [target])

  return speaking
}

/** 0–1 arası ses seviyesi (ayarlar ekranındaki mikrofon çubuğu için). */
export function useLevel(track: MediaStreamTrack | null | undefined, enabled: boolean) {
  const [level, setLevel] = useState(0)
  const target = enabled ? liveAudio(track) : null

  useEffect(() => {
    if (!target) {
      setLevel(0)
      return
    }
    let shown = 0
    const stop = subscribe(target, (value) => {
      const next = Math.min(1, value * 6)
      shown = next > shown ? next : shown * 0.82 + next * 0.18
      setLevel(Math.round(shown * 40) / 40)
    })
    return () => {
      stop()
      setLevel(0)
    }
  }, [target])

  return level
}
