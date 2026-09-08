import { Vector3, type PerspectiveCamera } from 'three/webgpu'
import type { Assets } from './core/assets'
import type { Physics } from './core/physics'
import type { Hud } from './ui/hud'
import type { Input } from './core/input'
import { Player } from './entities/player'
import { Boss, BOSS_NAME } from './entities/boss'
import { createRig } from './entities/anim/rig'
import { attachToHand, bossMaterials, buildGreatsword, playerMaterials } from './entities/appearance'
import type { CameraRig } from './entities/camera-rig'
import type { Arena } from './world/arena'
import { LAYOUT } from './world/layout'

const MODEL = 'assets/models/personagem-cc0.glb'
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
  arena: Arena
  camera: PerspectiveCamera
  cameraRig: CameraRig
}): Promise<Game> {
  const { assets, physics, input, hud, arena, cameraRig } = options

  const gltf = await assets.model(MODEL)

  const player = new Player(physics, input, cameraRig)
  const playerRig = createRig(gltf, {
    scale: player.height / MODEL_HEIGHT,
    materials: playerMaterials(),
  })
  player.attachRig(playerRig)
  if (playerRig.hand) attachToHand(playerRig.hand, buildGreatsword(1))

  const boss = new Boss(physics)
  const bossRig = createRig(gltf, {
    scale: boss.height / MODEL_HEIGHT,
    materials: bossMaterials(),
  })
  boss.attachRig(bossRig)
  if (bossRig.hand) attachToHand(bossRig.hand, buildGreatsword(1))

  player.enemy = boss

  const state = { phase: 'exploring' as Phase, respawnTimer: 0, victoryTimer: 0 }
  const gatePosition = new Vector3(arena.gate.position.x, 0, arena.gate.position.z)

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
  }

  boss.onDeath = () => {
    state.phase = 'victory'
    state.victoryTimer = 2
    hud.showVictory()
    hud.hideBoss()
  }

  function enterArena(): void {
    if (state.phase !== 'exploring') return
    state.phase = 'fighting'
    boss.wake()
    hud.showBoss(BOSS_NAME)
    hud.setBossHealth(boss.healthRatio, boss.phase === 1)
    // O portão fecha atrás, que é o que transforma a arena em arena.
    arena.gate.controls.opacity.value = 0.92
  }

  function respawn(): void {
    player.respawn()
    boss.reset()
    state.phase = 'exploring'
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

      hud.setHealth(player.healthRatio)
      hud.setStamina(player.staminaRatio, player.exhausted)
      if (state.phase === 'fighting' || state.phase === 'dead') {
        hud.setBossHealth(boss.healthRatio, boss.phase === 1)
      }

      if (state.phase === 'dead') {
        state.respawnTimer -= dt
        if (state.respawnTimer <= 0) respawn()
      }
    },
  }
}
