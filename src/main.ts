import { Vector3 } from 'three/webgpu'
import { createRenderContext, ResolutionGovernor } from './core/renderer'
import { Loop } from './core/loop'
import { Input } from './core/input'
import { Assets } from './core/assets'
import { Physics } from './core/physics'
import { StatsPanel } from './debug/stats'
import { exposeScreenshotHelper, flushScreenshot } from './debug/screenshot'
import { Hud, setRendererBadge } from './ui/hud'
import { buildArena } from './world/arena'
import { buildLighting, flickerBraziers } from './world/lighting'
import { Player } from './entities/player'
import { CameraRig } from './entities/camera-rig'

const HDRI = 'assets/hdri/moonlit_golf_1k.hdr'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const hud = new Hud()

  hud.setLoading(0.05, 'acordando a GPU')
  const ctx = await createRenderContext(canvas)
  setRendererBadge(ctx.backend === 'webgpu' ? 'WebGPU' : 'WebGL2, pós-processo reduzido')

  const assets = new Assets(ctx.renderer)
  assets.track((ratio, label) => hud.setLoading(ratio, label))

  hud.setLoading(0.2, 'abrindo o céu')
  const env = await assets.environment(HDRI)
  ctx.scene.environment = env
  ctx.scene.environmentIntensity = 0.3
  ctx.scene.backgroundIntensity = 0.42
  ctx.scene.background = env

  hud.setLoading(0.45, 'assentando a pedra')
  const physics = await Physics.create()
  const arena = buildArena(physics)
  ctx.scene.add(arena.root)

  hud.setLoading(0.7, 'acendendo os braseiros')
  const lighting = buildLighting(ctx.scene)

  hud.setLoading(0.9, 'afiando o montante')
  const input = new Input(canvas)
  const rig = new CameraRig(ctx.camera, physics)
  const player = new Player(physics, input, rig)
  ctx.scene.add(player.object)

  const stats = new StatsPanel(ctx)
  const governor = new ResolutionGovernor(ctx)
  const loop = new Loop()
  const screenTarget = new Vector3()

  if (import.meta.env.DEV) {
    exposeScreenshotHelper()
    ;(window as unknown as { game: unknown }).game = { ctx, input, player, rig, arena, lighting, physics }
    ;(window as unknown as { perf: () => unknown }).perf = () => ({
      ...stats.snapshot,
      backend: ctx.backend,
      resolutionScale: ctx.resolutionScale,
      state: player.state,
      position: player.object.position.toArray().map((n) => Number(n.toFixed(2))),
      locked: player.lockTarget !== null,
    })
  }

  loop.on('input', (dt) => {
    input.update(dt)
    if (input.consume('lockOn')) player.toggleLock([arena.dummy])
  })

  loop.on('simulate', (dt) => {
    player.update(dt)
    physics.step(dt)
    player.postStep()
  })

  loop.on('animate', (dt, elapsed) => {
    flickerBraziers(lighting.braziers, elapsed)
    hud.setHealth(player.healthRatio)
    hud.setStamina(player.staminaRatio, player.exhausted)
    hud.update(dt)
  })

  loop.on('camera', (dt) => {
    rig.update(dt, player.object, player.height, player.lockTarget)
    if (player.lockTarget) {
      screenTarget.copy(player.lockTarget.position)
      screenTarget.y += 2.4
      screenTarget.project(ctx.camera)
      const rect = canvas.getBoundingClientRect()
      hud.setLockOn({
        x: (screenTarget.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-screenTarget.y * 0.5 + 0.5) * rect.height + rect.top,
      })
    } else {
      hud.setLockOn(null)
    }
  })

  // O contador do WebGPU e preenchido depois do render, que e assincrono.
  // Zerar antes de desenhar leria sempre um frame incompleto, entao o painel
  // acumula e divide pelo numero de frames da janela.
  ctx.renderer.info.autoReset = false

  loop.on('render', (dt) => {
    ctx.renderer.render(ctx.scene, ctx.camera)
    flushScreenshot(canvas)
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
    hud.showHint('desça a escadaria', 5)
  })

  canvas.addEventListener('click', () => {
    if (input.enabled && !input.pointerLocked) input.requestPointerLock()
  })

  loop.start()
  console.info(`[boot] backend ${ctx.backend}`)
}

boot().catch((error) => {
  console.error(error)
  const status = document.querySelector('#loading-status')
  if (status) status.textContent = 'não foi possível iniciar o renderizador nesta máquina'
})
