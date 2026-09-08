import { Vector3, type PerspectiveCamera } from 'three/webgpu'
import type { Assets } from './core/assets'
import type { Audio } from './core/audio'
import type { Physics } from './core/physics'
import type { Hud } from './ui/hud'
import type { Input } from './core/input'
import { Player } from './entities/player'
import { Boss, BOSS_NAME } from './entities/boss'
import { createRig } from './entities/anim/rig'
import { createRetargetedSkin, type RetargetedSkin } from './entities/anim/retarget'
import { attachToHand, bossMaterials, buildGreatsword, playerMaterials } from './entities/appearance'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import type { CameraRig } from './entities/camera-rig'
import type { Arena } from './world/arena'
import { LAYOUT } from './world/layout'

const MODEL = 'assets/models/personagem-cc0.glb'
/** Vharen definitivo, gerado a partir do concept e riggado. */
const BOSS_MODEL = 'assets/models/vharen.glb'
/**
 * Altura e base do modelo gerado, medidas nos vértices já deformados pelo
 * esqueleto. Não dá pra confiar na caixa da geometria aqui: ela ignora o
 * esfolamento e devolve 0,02, cem vezes menor que o tamanho real. E a origem
 * do modelo fica no centro do corpo, não nos pés, daí o deslocamento.
 */
const BOSS_MODEL_HEIGHT = 1.998
const BOSS_MODEL_BASE = -0.998
/** Duração da apresentação do chefe, em segundos. */
const CUTSCENE_SECONDS = 4.2
const PHASE_ONE_EMBER = 2.6
const PHASE_TWO_EMBER = 5.4
/** Quanto a brasa sobe no auge da preparação de um golpe. */
const TELEGRAPH_EMBER = 5
/** Altura do modelo CC0 em metros, medida no glTF. */
const MODEL_HEIGHT = 1.829

export type Phase = 'exploring' | 'fighting' | 'dead' | 'victory'

export interface Game {
  player: Player
  boss: Boss
  phase: Phase
  /** Passo fixo, junto com a física. */
  fixedUpdate(dt: number): void
  /** Uma vez por frame. */
  update(dt: number): void
}

/**
 * Cola do slice: liga jogador, chefe, HUD e o ciclo de entrar, lutar, morrer e
 * vencer. É o único lugar que conhece todos ao mesmo tempo; nem o combate nem a
 * animação sabem que o HUD existe.
 */
export async function createGame(options: {
  assets: Assets
  physics: Physics
  input: Input
  hud: Hud
  audio: Audio
  arena: Arena
  camera: PerspectiveCamera
  cameraRig: CameraRig
}): Promise<Game> {
  const { assets, physics, input, hud, audio, arena, cameraRig } = options

  const gltf = await assets.model(MODEL)

  const player = new Player(physics, input, cameraRig)
  const playerRig = createRig(gltf, {
    scale: player.height / MODEL_HEIGHT,
    materials: playerMaterials(),
  })
  player.attachRig(playerRig)
  if (playerRig.hand) attachToHand(playerRig.hand, buildGreatsword(1))

  const boss = new Boss(physics)
  const bossSkin = bossMaterials()
  const bossRig = createRig(gltf, {
    scale: boss.height / MODEL_HEIGHT,
    materials: bossSkin,
  })
  const bossEmber = bossSkin[1] as MeshStandardNodeMaterial
  boss.attachRig(bossRig)

  // Vharen definitivo. O esqueleto CC0 continua dirigindo a animação, agora
  // invisível, e a pose é copiada pro modelo gerado a cada frame.
  //
  // Ainda atrás de `?vharen` na URL: o retarget entre o esqueleto Rigify da
  // biblioteca e o humanoide do modelo gerado está deformando a malha, e um
  // chefe quebrado é pior que um mannequim que funciona. Com o parâmetro
  // desligado o jogo usa o provisório, que é o comportamento normal.
  let bossFinal: RetargetedSkin | null = null
  const querVharenFinal = new URLSearchParams(window.location.search).has('vharen')
  if (!querVharenFinal && bossRig.hand) {
    attachToHand(bossRig.hand, buildGreatsword(1))
  }
  try {
    if (!querVharenFinal) throw new Error('desligado')
    const bossGltf = await assets.model(BOSS_MODEL)
    const bossScale = boss.height / BOSS_MODEL_HEIGHT
    bossFinal = createRetargetedSkin(bossGltf, bossRig.root, { scale: bossScale })
    bossFinal.root.position.y = -BOSS_MODEL_BASE * bossScale
    bossRig.root.visible = false
    boss.object.add(bossFinal.root)
  } catch (error) {
    if (querVharenFinal) {
      console.warn('[game] modelo final do Vharen não carregou, usando o provisório', error)
      if (bossRig.hand) attachToHand(bossRig.hand, buildGreatsword(1))
    }
  }

  player.enemy = boss

  const state = {
    phase: 'exploring' as Phase,
    respawnTimer: 0,
    victoryTimer: 0,
    /** Enquanto positivo, o jogador não controla nada. */
    cutscene: 0,
  }
  const gatePosition = new Vector3(arena.gate.position.x, 0, arena.gate.position.z)

  // Som. Tudo sintetizado, nenhum arquivo de áudio no bundle.
  player.onSwing = (heavy) => audio.swing(heavy)
  player.onStep = (weight) => audio.footstep(weight)
  player.onHitLanded = () => audio.impact(0.75)
  player.onHurt = () => {
    audio.impact(1)
    cameraRig.punch(0.5)
  }
  boss.onAttackStart = () => audio.swing(true)
  boss.onHitLanded = () => cameraRig.punch(0.8)
  boss.onHurt = () => audio.impact(0.45)

  hud.setBossHealth(1, false)

  player.onDeath = () => {
    state.phase = 'dead'
    state.respawnTimer = 4.2
    hud.showDeath()
    input.clearBuffer()
  }

  boss.onPhaseChange = () => {
    hud.setBossHealth(boss.healthRatio, true)
    hud.showHint('a segunda vigília começa', 3)
    audio.roar()
    cameraRig.punch(1.1)
  }

  boss.onDeath = () => {
    state.phase = 'victory'
    state.victoryTimer = 2
    hud.showVictory()
    hud.hideBoss()
    audio.stopBossMusic()
  }

  /**
   * Apresentação do chefe. A câmera sai de trás do jogador, sobe e corre até
   * enquadrar Vharen de baixo, que é o ângulo que faz ele parecer grande. Só
   * depois o nome e a barra entram e o controle volta.
   */
  function playIntro(): void {
    const playerPosition = player.object.position
    const bossPosition = boss.object.position
    const behind = new Vector3(
      playerPosition.x - bossPosition.x,
      0,
      playerPosition.z - bossPosition.z,
    )
    if (behind.lengthSq() < 0.001) behind.set(0, 0, 1)
    behind.normalize()

    cameraRig.playCinematic({
      from: new Vector3(
        playerPosition.x + behind.x * 4.5,
        playerPosition.y + 2.4,
        playerPosition.z + behind.z * 4.5,
      ),
      to: new Vector3(
        bossPosition.x + behind.x * 7.5,
        1.1,
        bossPosition.z + behind.z * 7.5,
      ),
      lookFrom: new Vector3(playerPosition.x, playerPosition.y + 1.4, playerPosition.z),
      lookTo: new Vector3(bossPosition.x, bossPosition.y + 3.4, bossPosition.z),
      duration: CUTSCENE_SECONDS,
    })
  }

  function enterArena(): void {
    if (state.phase !== 'exploring') return
    state.phase = 'fighting'
    state.cutscene = CUTSCENE_SECONDS
    input.enabled = false
    input.clearBuffer()
    playIntro()
    // O portão fecha atrás, que é o que transforma a arena em arena.
    arena.gate.controls.opacity.value = 0.92
    audio.startBossMusic()
  }

  function beginFight(): void {
    input.enabled = true
    boss.wake()
    hud.showBoss(BOSS_NAME)
    hud.setBossHealth(boss.healthRatio, boss.phase === 1)
  }

  function respawn(): void {
    player.respawn()
    boss.reset()
    state.phase = 'exploring'
    state.cutscene = 0
    input.enabled = true
    cameraRig.cancelCinematic()
    audio.stopBossMusic()
    hud.hideDeath()
    hud.hideBoss()
    hud.setBossHealth(1, false)
    arena.gate.controls.opacity.value = 0.66
    hud.showHint('desça a escadaria', 4)
  }

  return {
    player,
    boss,
    get phase() {
      return state.phase
    },

    fixedUpdate(dt) {
      player.update(dt)
      boss.update(dt, player)
      // A troca de estado depende das duas posições já resolvidas.
      if (state.phase === 'exploring') {
        const distance = Math.hypot(
          player.object.position.x - gatePosition.x,
          player.object.position.z - gatePosition.z,
        )
        const inside = Math.hypot(player.object.position.x, player.object.position.z)
        if (distance < 3 || inside < LAYOUT.arcadeRadius - 1) enterArena()
      }
    },

    update(dt) {
      player.updateAnimation(dt)
      boss.updateAnimation(dt)
      // Depois do mixer, senão a pose copiada é a do frame anterior.
      bossFinal?.update()

      // Telegrafia: a brasa carrega junto com a preparação do golpe e estoura
      // no impacto. É o aviso que a animação sozinha não dá.
      const base = boss.phase === 1 ? PHASE_TWO_EMBER : PHASE_ONE_EMBER
      bossEmber.emissiveIntensity = base + boss.telegraph * TELEGRAPH_EMBER

      hud.setHealth(player.healthRatio)
      hud.setStamina(player.staminaRatio, player.exhausted)
      if (state.phase === 'fighting' || state.phase === 'dead') {
        hud.setBossHealth(boss.healthRatio, boss.phase === 1)
      }

      if (state.cutscene > 0) {
        state.cutscene -= dt
        if (state.cutscene <= 0) beginFight()
      }

      if (state.phase === 'dead') {
        state.respawnTimer -= dt
        if (state.respawnTimer <= 0) respawn()
      }
    },
  }
}
