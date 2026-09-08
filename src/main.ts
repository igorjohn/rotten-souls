import { Vector3 } from 'three/webgpu'
import { createRenderContext, ResolutionGovernor } from './core/renderer'
import { Loop } from './core/loop'
import { Input } from './core/input'
import { Assets } from './core/assets'
import { StatsPanel } from './debug/stats'
import { Hud, setRendererBadge } from './ui/hud'
import { exposeScreenshotHelper, flushScreenshot } from './debug/screenshot'

const HDRI = 'assets/hdri/moonlit_golf_1k.hdr'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const hud = new Hud()

  hud.setLoading(0.05, 'acordando a GPU')
  const ctx = await createRenderContext(canvas)
  setRendererBadge(ctx.backend === 'webgpu' ? 'WebGPU' : 'WebGL2, pós-processo reduzido')

  const assets = new Assets(ctx.renderer)
  assets.track((ratio, label) => hud.setLoading(ratio, label))

  hud.setLoading(0.25, 'abrindo o céu')
  const env = await assets.environment(HDRI)
  ctx.scene.environment = env
  ctx.scene.background = env
  ctx.scene.environmentIntensity = 0.35
  ctx.scene.backgroundIntensity = 0.5

  const input = new Input(canvas)
  const stats = new StatsPanel(ctx)
  if (import.meta.env.DEV) {
    exposeScreenshotHelper()
    // Numero de perf legivel de fora, pra fechar marco sem ler pixel do painel.
    ;(window as unknown as { perf: () => unknown }).perf = () => ({
      ...stats.snapshot,
      backend: ctx.backend,
      resolutionScale: ctx.resolutionScale,
    })
  }
  const governor = new ResolutionGovernor(ctx)
  const loop = new Loop()

  ctx.camera.position.set(0, 2.4, 9)
  const target = new Vector3(0, 2, 0)

  loop.on('input', (dt) => input.update(dt))
  loop.on('camera', (_dt, elapsed) => {
    // Órbita lenta só pra provar que o frame está vivo. Sai no M1.
    const angle = elapsed * 0.08
    ctx.camera.position.set(Math.sin(angle) * 9, 2.4, Math.cos(angle) * 9)
    ctx.camera.lookAt(target)
  })
  loop.on('render', (dt) => {
    ctx.renderer.render(ctx.scene, ctx.camera)
    flushScreenshot(canvas)
    hud.update(dt)
    stats.update(dt, loop.frameMs)
    governor.update(dt, loop.frameMs)
  })

  hud.setLoading(1, 'pronto')
  hud.finishLoading()
  hud.onStart(() => {
    input.enabled = true
    input.requestPointerLock()
    hud.show()
    hud.showAreaTitle()
    stats.toggle(true)
  })

  loop.start()
  console.info(`[boot] backend ${ctx.backend}`)
}

boot().catch((error) => {
  console.error(error)
  const status = document.querySelector('#loading-status')
  if (status) {
    status.textContent = 'não foi possível iniciar o renderizador nesta máquina'
  }
})
