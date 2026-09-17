import { Vector3 } from 'three/webgpu'
import { applySize, createRenderContext, ResolutionGovernor } from './core/renderer'
import { Loop } from './core/loop'
import { Input } from './core/input'
import { Assets } from './core/assets'
import { Physics } from './core/physics'
import { StatsPanel } from './debug/stats'
import { exposeScreenshotHelper, flushScreenshot } from './debug/screenshot'
import { Hud, setRendererBadge } from './ui/hud'
import { PauseMenu } from './ui/pause'
import { Audio } from './core/audio'
import { MenuMusic } from './core/menu-music'
import { buildArena } from './world/arena'
import { loadMaterials } from './world/materials'
import { buildLighting, setBrazierLightBudget, setMoonShadowSize, updateBrazierLights } from './world/lighting'
import { buildFog } from './world/fx/fog'
import { buildBrazierFx } from './world/fx/flame'
import { buildPostFx } from './core/postfx'
import { QualityManager, type QualityProfile } from './core/quality'
import { LookDevGui } from './debug/gui'
import { CameraRig } from './entities/camera-rig'
import { createGame } from './game'

const HDRI = 'assets/hdri/moonlit_golf_1k.hdr'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const hud = new Hud()
  // `?mudo` na URL abre o jogo sem som nenhum: nem a trilha do menu, nem o
  // contexto de Web Audio. Serve pra rodar o jogo em segundo plano durante o
  // desenvolvimento sem tocar música na máquina de quem está trabalhando.
  const mudo = new URLSearchParams(window.location.search).has('mudo')

  // Antes de qualquer carregamento: a trilha do menu toca por cima da tela de
  // carregamento e do título, que é justamente onde ela faz falta.
  const menuMusic = new MenuMusic()
  if (mudo) menuMusic.mute()

  const quality = new QualityManager()

  hud.setLoading(0.05, 'acordando a GPU')
  const ctx = await createRenderContext(canvas)
  ctx.maxPixelRatio = quality.profile.maxPixelRatio
  setRendererBadge(ctx.backend === 'webgpu' ? 'WebGPU' : 'WebGL2, pós-processo reduzido')

  const assets = new Assets(ctx.renderer)
  assets.track((ratio, label) => hud.setLoading(ratio, label))

  hud.setLoading(0.2, 'abrindo o céu')
  const env = await assets.environment(HDRI)
  ctx.scene.environment = env
  ctx.scene.environmentIntensity = 0.1
  ctx.scene.backgroundIntensity = 0.45
  ctx.scene.background = env

  hud.setLoading(0.4, 'talhando a pedra')
  const materials = await loadMaterials(ctx.renderer)

  hud.setLoading(0.6, 'assentando a arcada')
  const physics = await Physics.create()
  const arena = buildArena(physics, materials)
  ctx.scene.add(arena.root)

  hud.setLoading(0.7, 'acendendo os braseiros')
  const lighting = buildLighting(ctx.scene)
  const fogControls = buildFog(ctx.scene)
  const brazierFx = buildBrazierFx(lighting.brazierPositions, materials.ferro)
  ctx.scene.add(brazierFx.root)

  hud.setLoading(0.86, 'afiando o montante')
  const input = new Input(canvas)
  const audio = new Audio()
  const rig = new CameraRig(ctx.camera, physics)
  const game = await createGame({
    assets,
    physics,
    input,
    hud,
    audio,
    arena,
    camera: ctx.camera,
    cameraRig: rig,
    renderer: ctx.renderer,
  })
  const player = game.player
  ctx.scene.add(player.object, game.boss.object)

  hud.setLoading(0.96, 'compondo a imagem')
  const postfx = buildPostFx(ctx.renderer, ctx.scene, ctx.camera, ctx.backend, quality.profile)
  const applyPostSize = () => postfx.setSize(window.innerWidth || 1600, window.innerHeight || 900)
  applyPostSize()
  window.addEventListener('resize', applyPostSize)

  const stats = new StatsPanel(ctx, () => `${quality.level}${quality.auto ? ' (auto)' : ''}`)
  // `?stats` abre o painel de perf em produção, pra quem reporta lentidão
  // mandar um print com número em vez de "está travando".
  if (new URLSearchParams(window.location.search).has('stats')) stats.toggle(true)
  const governor = new ResolutionGovernor(ctx)
  const loop = new Loop()
  const screenTarget = new Vector3()

  /**
   * Aplica um perfil de qualidade em tudo que ele toca. Roda no boot e a cada
   * troca, fora do render: trocar tipo de sombra e grafo de pós-processo
   * recompila shader, e isso engasga um frame, o que é aceitável numa troca
   * de menu e inaceitável no meio de um golpe.
   */
  const applyQuality = (profile: QualityProfile, auto: boolean) => {
    ctx.maxPixelRatio = profile.maxPixelRatio
    ctx.renderer.shadowMap.type = profile.shadowType
    setMoonShadowSize(lighting, profile.shadowMapSize)
    setBrazierLightBudget(lighting, profile.brazierLights)
    postfx.setQuality(profile)
    governor.setMinScale(profile.minScale)
    applySize(ctx)
    pause.setQuality(profile.level, auto)
  }

  /**
   * Pausa. Corta input, simulação, animação e câmera, e deixa o estágio de
   * render seguir: a cena fica congelada na tela em vez de virar tela preta, o
   * que é o ponto de pausar num jogo com esta iluminação.
   *
   * Não uso `loop.timeScale = 0` porque o delta zerado também chegaria no painel
   * de perf e no governador de resolução, que dividem por ele.
   */
  const pause = new PauseMenu(
    () => {
      audio.pauseToggle(true)
      input.enabled = false
      input.clearBuffer()
      input.exitPointerLock()
    },
    () => {
      audio.pauseToggle(false)
      input.enabled = true
      input.requestPointerLock()
    },
    (level) => {
      quality.choose(level)
      // Clicar no nível que já está ativo não troca nada, mas desliga o automático.
      pause.setQuality(quality.level, quality.auto)
    },
  )

  // O perfil inicial já entrou no renderer e no pós-processo na construção;
  // aqui só o que resta (sombra, luzes, governador, botão do menu).
  ctx.renderer.shadowMap.type = quality.profile.shadowType
  setMoonShadowSize(lighting, quality.profile.shadowMapSize)
  setBrazierLightBudget(lighting, quality.profile.brazierLights)
  governor.setMinScale(quality.profile.minScale)
  pause.setQuality(quality.level, quality.auto)
  quality.onChange(applyQuality)

  if (import.meta.env.DEV) {
    exposeScreenshotHelper()
    ;(window as unknown as { game: unknown }).game = {
      ctx, input, player, boss: game.boss, jogo: game, rig, arena, lighting,
      physics, postfx, fogControls, brazierFx, audio, menuMusic, pause, quality,
    }
    ;(window as unknown as { perf: () => unknown }).perf = () => ({
      ...stats.snapshot,
      backend: ctx.backend,
      resolutionScale: ctx.resolutionScale,
      quality: quality.level,
      state: player.state,
      position: player.object.position.toArray().map((n) => Number(n.toFixed(2))),
      locked: player.lockTarget !== null,
    })
  }

  loop.on('input', (dt) => {
    if (pause.open) return
    input.update(dt)
    if (input.consume('lockOn')) {
      player.toggleLock([game.boss.object])
      audio.lockOn(player.lockTarget !== null)
    }
  })

  loop.on('simulate', (dt) => {
    if (pause.open) return
    // Jogador e chefe simulam dentro do passo fixo, junto com a física.
    // Ver Physics.step: corpo cinemático só anda quando o mundo dá um passo.
    physics.step(dt, (fixed) => game.fixedUpdate(fixed))
    player.postStep()
    game.boss.postStep()
  })

  loop.on('animate', (dt, elapsed) => {
    if (pause.open) return
    updateBrazierLights(lighting, player.object.position, elapsed)
    game.update(dt)
    hud.update(dt)
    // O jogo pede a escala, o loop aplica. É assim que o hitstop chega na física.
    loop.timeScale = game.timeScale
  })

  loop.on('camera', (dt) => {
    if (pause.open) return
    rig.update(dt, player.object, player.height, player.lockTarget)
    // Ouvinte na câmera: é o que faz o braseiro e o portão virem da direção
    // certa quando a câmera gira em volta do jogador.
    audio.setListener(ctx.camera)
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

  const captureContext = {
    renderer: ctx.renderer,
    drawFrame: () => postfx.render(),
    size: () => ({
      width: ctx.renderer.domElement.width,
      height: ctx.renderer.domElement.height,
    }),
  }

  loop.on('render', (dt) => {
    ctx.beginFrame()
    postfx.render()
    flushScreenshot(captureContext)
    stats.update(dt, loop.frameMs)
    governor.update(dt, loop.frameMs)
    quality.update(dt, loop.intervalMs, governor.targetMs)
  })

  if (import.meta.env.DEV) {
    const gui = new LookDevGui()
    const p = postfx.controls
    gui.section('imagem')
    gui.uniform('exposicao', p.exposure, 0.2, 2)
    gui.uniform('saturacao', p.saturation, 0, 2)
    gui.uniform('tom da sombra', p.shadowTint, 0, 1.5)
    gui.uniform('tom da luz', p.highlightTint, 0, 1.5)
    gui.uniform('vinheta', p.vignette, 0, 1.5)
    gui.uniform('grao', p.grain, 0, 0.2, 0.002)
    gui.section('bloom')
    gui.uniform('forca', p.bloomStrength, 0, 2)
    gui.uniform('raio', p.bloomRadius, 0, 1.5)
    gui.uniform('limiar', p.bloomThreshold, 0, 2)
    gui.section('oclusao')
    gui.uniform('intensidade', p.aoIntensity, 0, 1)
    gui.section('nevoa')
    gui.uniform('distancia', fogControls.distanceDensity, 0, 0.1, 0.001)
    gui.uniform('chao', fogControls.groundDensity, 0, 0.3, 0.002)
    gui.uniform('altura do chao', fogControls.groundHeight, 0.5, 12, 0.1)
    gui.section('fogo')
    gui.uniform('brilho da chama', brazierFx.controls.flameBrightness, 0, 6)
    gui.uniform('brilho da faisca', brazierFx.controls.sparkBrightness, 0, 6)
    gui.add({
      label: 'lua',
      min: 0,
      max: 6,
      step: 0.05,
      get: () => lighting.moon.intensity,
      set: (v) => {
        lighting.moon.intensity = v
      },
    })
    gui.add({
      label: 'preenchimento',
      min: 0,
      max: 1,
      step: 0.01,
      get: () => lighting.fill.intensity,
      set: (v) => {
        lighting.fill.intensity = v
      },
    })
    gui.add({
      label: 'ambiente do HDRI',
      min: 0,
      max: 1.5,
      step: 0.01,
      get: () => ctx.scene.environmentIntensity,
      set: (v) => {
        ctx.scene.environmentIntensity = v
      },
    })
    ;(window as unknown as { gui: LookDevGui }).gui = gui
  }

  hud.setLoading(1, 'pronto')
  hud.finishLoading()
  // A trilha nasce aqui, dentro do gesto que abre a soleira. É o único lugar em
  // que o navegador garante que ela pode tocar.
  hud.onThreshold(() => {
    if (!mudo) menuMusic.start()
  })
  hud.onStart(() => {
    // O contexto de áudio só pode nascer dentro de um gesto do usuário.
    menuMusic.fadeOut()
    if (!mudo) {
      audio.start()
      audio.uiConfirm()
      audio.placeWorld({ braziers: lighting.brazierPositions, gate: arena.gate.position })
    }
    input.enabled = true
    input.requestPointerLock()
    hud.show()
    pause.arm()
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
