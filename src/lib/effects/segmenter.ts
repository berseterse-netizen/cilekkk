import type { ImageSegmenter } from '@mediapipe/tasks-vision'

/** `npm run fetch-model` ile indirildiyse model kendi sunucumuzdan, yoksa MediaPipe'in resmi deposundan gelir. */
const MODEL_PATH = __CILEK_LOCAL_MODEL__
  ? '/models/selfie_segmenter_landscape.tflite'
  : 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite'

export type PersonMask = { data: Uint8Array; width: number; height: number }

export type Segmenter = {
  /** Kişi olasılığını 0–255 olarak döndürür; önceki kareyle yumuşatılır. */
  segment(source: TexImageSource, timestamp: number): PersonMask | null
  close(): void
}

let loading: Promise<Segmenter> | null = null

async function create(): Promise<Segmenter> {
  const vision = await import('@mediapipe/tasks-vision')
  const files = await vision.FilesetResolver.forVisionTasks(new URL('/mediapipe', window.location.origin).href)
  const segmenter: ImageSegmenter = await vision.ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  })

  let smoothed: Uint8Array | null = null
  let lastTimestamp = 0

  return {
    segment(source, timestamp) {
      const stamp = Math.max(timestamp, lastTimestamp + 1)
      lastTimestamp = stamp
      let mask: PersonMask | null = null
      segmenter.segmentForVideo(source, stamp, (result) => {
        const masks = result.confidenceMasks
        if (!masks?.length) return
        // Tek çıktılı modelde değer "kişi" olasılığıdır; çok sınıflıda 0 arka plandır.
        const person = masks.length > 1 ? null : masks[0]!
        const values = person ? person.getAsFloat32Array() : masks[0]!.getAsFloat32Array()
        const width = masks[0]!.width
        const height = masks[0]!.height
        if (!smoothed || smoothed.length !== values.length) smoothed = new Uint8Array(values.length)
        const out = smoothed
        for (let index = 0; index < values.length; index += 1) {
          const probability = person ? values[index]! : 1 - values[index]!
          const next = probability * 255
          out[index] = (out[index]! * 0.35 + next * 0.65) | 0
        }
        mask = { data: out, width, height }
      })
      return mask
    },
    close() {
      segmenter.close()
    },
  }
}

export function loadSegmenter() {
  if (!loading) {
    loading = create().catch((error: unknown) => {
      loading = null
      throw error
    })
  }
  return loading
}
