import { filterParams, type Effects } from './filters'
import { loadSegmenter, type Segmenter } from './segmenter'

export type EffectsStatus = 'idle' | 'loading' | 'ready' | 'error'

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

/** Arka planı maskeyle ağırlıklandırarak küçültür; kişi rengi bulanığa sızmaz. */
const PREPARE = `#version 300 es
precision mediump float;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
uniform vec2 u_range;
in vec2 v_uv;
out vec4 o;
void main() {
  float person = smoothstep(u_range.x, u_range.y, texture(u_mask, v_uv).r);
  float a = 1.0 - person;
  o = vec4(texture(u_frame, v_uv).rgb * a, a);
}`

const BLUR = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_dir;
in vec2 v_uv;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv) * 0.2270270270;
  c += texture(u_tex, v_uv + u_dir * 1.3846153846) * 0.3162162162;
  c += texture(u_tex, v_uv - u_dir * 1.3846153846) * 0.3162162162;
  c += texture(u_tex, v_uv + u_dir * 3.2307692308) * 0.0702702703;
  c += texture(u_tex, v_uv - u_dir * 3.2307692308) * 0.0702702703;
  o = c;
}`

const COMPOSE = `#version 300 es
precision mediump float;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
uniform sampler2D u_bg;
uniform int u_mode;
uniform vec2 u_texel;
uniform vec2 u_range;
uniform float u_smooth;
uniform float u_bright;
uniform float u_sat;
uniform float u_contrast;
uniform float u_warm;
uniform float u_tint;
uniform float u_sepia;
uniform float u_fade;
uniform float u_vignette;
in vec2 v_uv;
out vec4 o;

const vec2 RING[8] = vec2[8](
  vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
  vec2(0.7071, 0.7071), vec2(-0.7071, 0.7071), vec2(0.7071, -0.7071), vec2(-0.7071, -0.7071)
);

vec3 berryBackdrop(vec2 uv) {
  vec3 top = vec3(1.0, 0.86, 0.9);
  vec3 bottom = vec3(1.0, 0.93, 0.86);
  vec3 c = mix(bottom, top, uv.y);
  c = mix(c, vec3(0.86, 0.95, 0.89), 0.55 * smoothstep(0.55, 0.0, distance(uv, vec2(0.9, 0.12))));
  c = mix(c, vec3(1.0, 0.78, 0.84), 0.45 * smoothstep(0.5, 0.0, distance(uv, vec2(0.08, 0.85))));
  return c;
}

void main() {
  vec3 col = texture(u_frame, v_uv).rgb;

  if (u_smooth > 0.0) {
    vec3 sum = col;
    float total = 1.0;
    for (int i = 0; i < 8; i++) {
      vec3 s = texture(u_frame, v_uv + RING[i] * u_texel * 3.0).rgb;
      float w = 1.0 - smoothstep(0.04, 0.14, distance(s, col));
      sum += s * w;
      total += w;
    }
    col = mix(col, sum / total, u_smooth);
  }

  if (u_mode > 0) {
    float person = smoothstep(u_range.x, u_range.y, texture(u_mask, v_uv).r);
    vec3 back;
    if (u_mode == 1) {
      vec4 b = texture(u_bg, v_uv);
      back = b.a > 0.002 ? b.rgb / b.a : col;
    } else {
      back = berryBackdrop(v_uv);
    }
    col = mix(back, col, person);
  }

  col = (col - 0.5) * u_contrast + 0.5 + u_bright;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, u_sat);
  col += vec3(u_warm * 0.06, u_tint * 0.04, -u_warm * 0.06);
  vec3 sep = vec3(
    dot(col, vec3(0.393, 0.769, 0.189)),
    dot(col, vec3(0.349, 0.686, 0.168)),
    dot(col, vec3(0.272, 0.534, 0.131))
  );
  col = mix(col, sep, u_sepia);
  col = mix(col, col * 0.84 + 0.09, u_fade);
  col *= 1.0 - u_vignette * smoothstep(0.38, 0.9, distance(v_uv, vec2(0.5)));
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }

type FrameReader = ReadableStreamDefaultReader<VideoFrame>
type TrackProcessorCtor = new (init: { track: MediaStreamTrack; maxBufferSize?: number }) => { readable: ReadableStream<VideoFrame> }
type TrackGeneratorCtor = new (init: { kind: 'video' }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> }

const TrackProcessor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor
const TrackGenerator = (globalThis as { MediaStreamTrackGenerator?: TrackGeneratorCtor }).MediaStreamTrackGenerator
/** Chrome/Edge: kareler doğrudan izden okunur; sekme arka plandayken de görüntü akmaya devam eder. */
const framePath = typeof TrackProcessor === 'function' && typeof VideoFrame === 'function'

const TICKER = `let timer = 0
onmessage = (event) => {
  clearInterval(timer)
  if (event.data > 0) timer = setInterval(() => postMessage(0), event.data)
}`

export function canProcess() {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  return typeof canvas.captureStream === 'function' && !!canvas.getContext('webgl2')
}

function compile(gl: WebGL2RenderingContext, fragment: string, names: string[]): Program {
  const shader = (type: number, source: string) => {
    const item = gl.createShader(type)!
    gl.shaderSource(item, source)
    gl.compileShader(item)
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item) ?? 'shader')
    return item
  }
  const program = gl.createProgram()!
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment))
  gl.bindAttribLocation(program, 0, 'a_pos')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program')
  return { program, uniforms: new Map(names.map((name) => [name, gl.getUniformLocation(program, name)])) }
}

function texture(gl: WebGL2RenderingContext) {
  const item = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, item)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return item
}

/**
 * Kamerayı WebGL üzerinden işleyip yeni bir video izi üretir.
 * Efektler kapalıyken hiç kullanılmaz; ham iz doğrudan gönderilir.
 */
export class CameraProcessor {
  readonly track: MediaStreamTrack
  private readonly canvas = document.createElement('canvas')
  private readonly video = document.createElement('video')
  private readonly gl: WebGL2RenderingContext
  private readonly prepare: Program
  private readonly blur: Program
  private readonly compose: Program
  private readonly frameTex: WebGLTexture
  private readonly maskTex: WebGLTexture
  private targets: [Target, Target] | null = null
  private ticker: Worker | null = null
  private fallbackTimer = 0
  private reader: FrameReader | null = null
  private writer: WritableStreamDefaultWriter<VideoFrame> | null = null
  private effects: Effects
  private segmenter: Segmenter | null = null
  private hasMask = false
  private lastVideoTime = -1
  private segmentCost = 0
  private frameCount = 0
  private stopped = false
  private readonly onStatus: (status: EffectsStatus) => void
  private readonly onFail: () => void

  constructor(source: MediaStreamTrack, effects: Effects, onStatus: (status: EffectsStatus) => void, onFail: () => void) {
    this.effects = effects
    this.onStatus = onStatus
    this.onFail = onFail
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('webgl2')
    this.gl = gl
    this.prepare = compile(gl, PREPARE, ['u_frame', 'u_mask', 'u_range'])
    this.blur = compile(gl, BLUR, ['u_tex', 'u_dir'])
    this.compose = compile(gl, COMPOSE, [
      'u_frame', 'u_mask', 'u_bg', 'u_mode', 'u_texel', 'u_range', 'u_smooth', 'u_bright',
      'u_sat', 'u_contrast', 'u_warm', 'u_tint', 'u_sepia', 'u_fade', 'u_vignette',
    ])

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.frameTex = texture(gl)
    this.maskTex = texture(gl)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]))

    this.canvas.width = 1280
    this.canvas.height = 720
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      // stop() bağlamı bilerek bırakır; bu bir hata değildir.
      if (!this.stopped) this.onFail()
    })

    if (framePath && TrackGenerator) {
      const generator = new TrackGenerator({ kind: 'video' })
      this.writer = generator.writable.getWriter()
      this.track = generator
    } else {
      this.track = this.canvas.captureStream(30).getVideoTracks()[0]!
    }
    this.track.contentHint = 'motion'
    this.attach(source)
    this.syncSegmenter()
  }

  setSource(source: MediaStreamTrack) {
    this.attach(source)
  }

  private attach(source: MediaStreamTrack) {
    this.lastVideoTime = -1
    if (framePath) {
      void this.reader?.cancel().catch(() => {})
      const reader = new TrackProcessor!({ track: source, maxBufferSize: 2 }).readable.getReader()
      this.reader = reader
      void this.pump(reader)
      return
    }
    this.video.muted = true
    this.video.playsInline = true
    this.video.srcObject = new MediaStream([source])
    void this.video.play().catch(() => {})
    if (this.ticker || this.fallbackTimer) return
    // Ana iş parçacığında zamanlayıcılar arka planda yavaşlar; sayaç bir Worker'dan gelir.
    try {
      const url = URL.createObjectURL(new Blob([TICKER], { type: 'text/javascript' }))
      this.ticker = new Worker(url)
      URL.revokeObjectURL(url)
      this.ticker.onmessage = () => this.renderVideo()
      this.ticker.postMessage(1000 / 30)
    } catch {
      this.fallbackTimer = window.setInterval(() => this.renderVideo(), 1000 / 30)
    }
  }

  private async pump(reader: FrameReader) {
    while (!this.stopped && this.reader === reader) {
      let result: ReadableStreamReadResult<VideoFrame>
      try {
        result = await reader.read()
      } catch {
        return
      }
      if (result.done) return
      const frame = result.value
      try {
        if (!this.stopped && this.reader === reader) {
          this.render(frame, frame.displayWidth, frame.displayHeight)
          const writer = this.writer
          if (writer && (writer.desiredSize ?? 1) > 0) {
            void writer.write(new VideoFrame(this.canvas, { timestamp: frame.timestamp })).catch(() => {})
          }
        }
      } catch {
        /* tek bir bozuk kare akışı durdurmasın */
      } finally {
        frame.close()
      }
    }
  }

  private renderVideo() {
    const video = this.video
    if (this.stopped || video.readyState < 2 || !video.videoWidth) return
    // Görüntü değişmediyse yeniden çizme; GPU ve pil boşa harcanmasın.
    if (video.currentTime === this.lastVideoTime) return
    this.lastVideoTime = video.currentTime
    this.render(video, video.videoWidth, video.videoHeight)
  }

  setEffects(effects: Effects) {
    this.effects = effects
    this.lastVideoTime = -1
    this.syncSegmenter()
  }

  /** O anki işlenmiş kareyi JPEG olarak verir. */
  snapshot() {
    return new Promise<Blob | null>((resolve) => this.canvas.toBlob(resolve, 'image/jpeg', 0.92))
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.ticker?.terminate()
    window.clearInterval(this.fallbackTimer)
    void this.reader?.cancel().catch(() => {})
    void this.writer?.close().catch(() => {})
    this.track.stop()
    this.video.srcObject = null
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private syncSegmenter() {
    if (this.effects.background === 'none') {
      this.hasMask = false
      this.onStatus('idle')
      return
    }
    if (this.segmenter) {
      this.onStatus('ready')
      return
    }
    this.onStatus('loading')
    loadSegmenter()
      .then((segmenter) => {
        if (this.stopped) return
        this.segmenter = segmenter
        this.onStatus(this.effects.background === 'none' ? 'idle' : 'ready')
      })
      .catch(() => {
        if (!this.stopped) this.onStatus('error')
      })
  }

  private ensureTargets(width: number, height: number) {
    const gl = this.gl
    const w = Math.max(32, Math.round(width / 4))
    const h = Math.max(18, Math.round(height / 4))
    if (this.targets && this.targets[0].width === w && this.targets[0].height === h) return this.targets
    if (this.targets) {
      for (const target of this.targets) {
        gl.deleteTexture(target.texture)
        gl.deleteFramebuffer(target.framebuffer)
      }
    }
    const make = (): Target => {
      const item = texture(gl)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const framebuffer = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, item, 0)
      return { texture: item, framebuffer, width: w, height: h }
    }
    this.targets = [make(), make()]
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return this.targets
  }

  private render(source: TexImageSource, width: number, height: number) {
    if (this.stopped || !width || !height) return
    const background = this.effects.background
    this.frameCount += 1

    const gl = this.gl
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

    if (background !== 'none' && this.segmenter) {
      // Ağır cihazlarda maske her kare değil, iki karede bir güncellenir.
      const skip = this.segmentCost > 22 && this.frameCount % 2 === 1
      if (!skip) {
        const started = performance.now()
        try {
          const mask = this.segmenter.segment(source, started)
          if (mask) {
            gl.activeTexture(gl.TEXTURE1)
            gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data)
            this.hasMask = true
          }
        } catch {
          this.hasMask = false
        }
        this.segmentCost = this.segmentCost * 0.8 + (performance.now() - started) * 0.2
      }
    }

    const mode = background === 'none' || !this.hasMask ? 0 : background === 'berry' ? 2 : 1
    const range: [number, number] = background === 'berry' ? [0.45, 0.7] : [0.3, 0.75]
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex)

    if (mode === 1) {
      const [a, b] = this.ensureTargets(width, height)
      gl.viewport(0, 0, a.width, a.height)
      gl.useProgram(this.prepare.program)
      gl.uniform1i(this.prepare.uniforms.get('u_frame')!, 0)
      gl.uniform1i(this.prepare.uniforms.get('u_mask')!, 1)
      gl.uniform2f(this.prepare.uniforms.get('u_range')!, range[0], range[1])
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      const passes = background === 'blur' ? 4 : 2
      const spread = background === 'blur' ? 2.2 : 1.2
      gl.useProgram(this.blur.program)
      gl.uniform1i(this.blur.uniforms.get('u_tex')!, 2)
      gl.activeTexture(gl.TEXTURE2)
      for (let pass = 0; pass < passes; pass += 1) {
        gl.bindTexture(gl.TEXTURE_2D, a.texture)
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.framebuffer)
        gl.uniform2f(this.blur.uniforms.get('u_dir')!, spread / a.width, 0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.bindTexture(gl.TEXTURE_2D, b.texture)
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer)
        gl.uniform2f(this.blur.uniforms.get('u_dir')!, 0, spread / a.height)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      gl.bindTexture(gl.TEXTURE_2D, a.texture)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    const params = filterParams(this.effects.filter)
    const u = this.compose.uniforms
    gl.useProgram(this.compose.program)
    gl.uniform1i(u.get('u_frame')!, 0)
    gl.uniform1i(u.get('u_mask')!, 1)
    gl.uniform1i(u.get('u_bg')!, 2)
    gl.uniform1i(u.get('u_mode')!, mode)
    gl.uniform2f(u.get('u_texel')!, 1 / width, 1 / height)
    gl.uniform2f(u.get('u_range')!, range[0], range[1])
    gl.uniform1f(u.get('u_smooth')!, this.effects.smooth * 0.85)
    gl.uniform1f(u.get('u_bright')!, params.brightness + this.effects.brightness * 0.35)
    gl.uniform1f(u.get('u_sat')!, params.saturation)
    gl.uniform1f(u.get('u_contrast')!, params.contrast)
    gl.uniform1f(u.get('u_warm')!, params.warmth)
    gl.uniform1f(u.get('u_tint')!, params.tint)
    gl.uniform1f(u.get('u_sepia')!, params.sepia)
    gl.uniform1f(u.get('u_fade')!, params.fade)
    gl.uniform1f(u.get('u_vignette')!, params.vignette)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
