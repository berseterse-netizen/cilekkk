// İsteğe bağlı: portre modu modelini kendi sunucunda barındırmak için indirir (public/models).
import { mkdirSync, writeFileSync } from 'node:fs'

const url = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite'
const target = new URL('../public/models/selfie_segmenter_landscape.tflite', import.meta.url)

const response = await fetch(url)
if (!response.ok) {
  console.error(`model indirilemedi: ${response.status}`)
  process.exit(1)
}
mkdirSync(new URL('../public/models/', import.meta.url), { recursive: true })
writeFileSync(target, Buffer.from(await response.arrayBuffer()))
console.log('model kaydedildi: public/models/selfie_segmenter_landscape.tflite')
