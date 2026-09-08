import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from 'three/webgpu'

export type Backend = 'webgpu' | 'webgl2'

export interface RenderContext {
  renderer: WebGPURenderer
  scene: Scene
  camera: PerspectiveCamera
  backend: Backend
  /** Escala de resolução aplicada por cima do devicePixelRatio, ajustada em tempo real. */
  resolutionScale: number
}

const MAX_PIXEL_RATIO = 1.5

function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

/**
 * Cria o renderer preferindo WebGPU. Se o adaptador não vier, cai pro WebGL2
 * com o mesmo objeto de renderer (o Three faz a ponte) e avisa quem chamou,
 * pra que o pós-processo possa ser reduzido.
 */
export async function createRenderContext(canvas: HTMLCanvasElement): Promise<RenderContext> {
  let backend: Backend = webgpuAvailable() ? 'webgpu' : 'webgl2'

  let renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    forceWebGL: backend === 'webgl2',
    powerPreference: 'high-performance',
  })

  try {
    await renderer.init()
  } catch (error) {
    // Adaptador negado, driver antigo, navegador sem suporte real. Refaz em WebGL2.
    console.warn('[renderer] WebGPU indisponível, caindo pro WebGL2:', error)
    renderer.dispose()
    backend = 'webgl2'
    renderer = new WebGPURenderer({
      canvas,
      antialias: true,
      forceWebGL: true,
      powerPreference: 'high-performance',
    })
    await renderer.init()
  }

  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.86
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap

  const scene = new Scene()
  const camera = new PerspectiveCamera(52, 1, 0.1, 320)

  const ctx: RenderContext = { renderer, scene, camera, backend, resolutionScale: 1 }
  applySize(ctx)

  window.addEventListener('resize', () => applySize(ctx))
  window.addEventListener('orientationchange', () => applySize(ctx))

  return ctx
}

/**
 * Piso de resolucao. O painel de preview as vezes reporta viewport 0x0, o que
 * deixaria o buffer vazio e impossibilitaria a verificacao visual do marco.
 */
const FALLBACK_SIZE = { width: 1600, height: 900 }

export function applySize(ctx: RenderContext): void {
  const params = new URLSearchParams(window.location.search)
  const forced = params.get('size')?.split('x').map(Number)
  const width = forced?.[0] || window.innerWidth || FALLBACK_SIZE.width
  const height = forced?.[1] || window.innerHeight || FALLBACK_SIZE.height
  // Quando o viewport reporta zero, o CSS deixa o canvas em 0x0 e o WebGPU nao
  // consegue criar a swapchain. Ai o tamanho tem que ir tambem pro estilo.
  const needsExplicitStyle = !window.innerWidth || !window.innerHeight || Boolean(forced)
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * ctx.resolutionScale

  ctx.camera.aspect = width / height
  ctx.camera.updateProjectionMatrix()
  ctx.renderer.setPixelRatio(ratio)
  ctx.renderer.setSize(width, height, needsExplicitStyle)
}

/**
 * Resolução adaptativa. Se o frame passa do orçamento por um tempo, encolhe a
 * escala; se sobra folga, devolve. Mantém os 60 fps sem mexer no look.
 */
export class ResolutionGovernor {
  private accumulator = 0
  private samples = 0
  private cooldown = 1.5

  constructor(
    private readonly ctx: RenderContext,
    private readonly targetMs = 15,
    private readonly min = 0.62,
    private readonly max = 1,
  ) {}

  update(dt: number, frameMs: number): void {
    this.cooldown -= dt
    this.accumulator += frameMs
    this.samples++
    if (this.cooldown > 0 || this.samples < 40) return

    const average = this.accumulator / this.samples
    this.accumulator = 0
    this.samples = 0
    this.cooldown = 1

    const current = this.ctx.resolutionScale
    let next = current
    if (average > this.targetMs * 1.12) next = Math.max(this.min, current - 0.08)
    else if (average < this.targetMs * 0.72) next = Math.min(this.max, current + 0.05)

    if (Math.abs(next - current) > 0.001) {
      this.ctx.resolutionScale = next
      applySize(this.ctx)
    }
  }
}
