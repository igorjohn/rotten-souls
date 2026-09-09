import { Quaternion, Vector3, type Mesh, type PerspectiveCamera, type WebGPURenderer } from 'three/webgpu'
import type { Assets } from './core/assets'
import type { Audio } from './core/audio'
import type { Physics } from './core/physics'
import type { Hud } from './ui/hud'
import type { Input } from './core/input'
import { Player } from './entities/player'
import { Boss, BOSS_NAME } from './entities/boss'
import { createRig, type Rig } from './entities/anim/rig'
import {
  attachToHand,
  bossMaterials,
  buildGreatsword,
  dressVharen,
} from './entities/appearance'
import { buildHelm, loadArmorMaterials } from './entities/armor'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import type { CameraRig } from './entities/camera-rig'
import type { Arena } from './world/arena'
import { LAYOUT } from './world/layout'

const MODEL = 'assets/models/personagem-cc0.glb'
/** Vharen definitivo, gerado a partir do concept e riggado. */
const BOSS_MODEL = 'assets/models/vharen.glb'
/** Duração da apresentação do chefe, em segundos. */
const CUTSCENE_SECONDS = 4.2
const PHASE_ONE_EMBER = 2.6
const PHASE_TWO_EMBER = 5.4
/** Quanto a brasa sobe no auge da preparação de um golpe. */
const TELEGRAPH_EMBER = 5
/** Altura do modelo CC0 em metros, medida no glTF. */
const MODEL_HEIGHT = 1.829
/**
 * Altura do Vharen definitivo na pose de repouso, medida no Blender. O modelo
 * já sai do gerador na escala do chefe, então a razão dá 1 e a escala existe
 * só pra não amarrar o arquivo à constante do `Boss`.
 */
const VHAREN_HEIGHT = 4.62

export type Phase = 'exploring' | 'fighting' | 'dead' | 'victory'

export interface Game {
  player: Player
  boss: Boss
  phase: Phase
  /** Multiplicador de tempo pedido pelo jogo. É por aqui que o hitstop entra. */
  readonly timeScale: number
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
  renderer: WebGPURenderer
}): Promise<Game> {
  const { assets, physics, input, hud, audio, arena, cameraRig } = options

  const gltf = await assets.model(MODEL)

  const player = new Player(physics, input, cameraRig)
  // Sem substituir material: o mannequim agora chega com a armadura assada,
  // com oclusão e desgaste de aresta no mapa (`scripts/blender/skin_player.py`).
  const playerRig = createRig(gltf, { scale: player.height / MODEL_HEIGHT })
  player.attachRig(playerRig)
  if (playerRig.hand) attachToHand(playerRig.hand, buildGreatsword(1))

  // Comparação de armadura, pra o Igor escolher olhando. Por padrão vale a
  // assada no GLB, que carrega oclusão e desgaste de aresta no próprio mapa,
  // coisa que textura ladrilhada não sabe fazer. Com `?armadura` na URL entra a
  // biblioteca por peça de `armor.ts`: aço de placa ladrilhado no corpo, mais o
  // elmo como geometria, que é justamente o que falta na assada.
  //
  // A capa não é trocada porque ela já vem costurada na malha do GLB, e somar a
  // capa da biblioteca daria duas.
  if (new URLSearchParams(window.location.search).has('armadura')) {
    await dressPlayerWithLibrary(options.renderer, playerRig)
  }

  const boss = new Boss(physics)

  // Vharen definitivo, com as animações da biblioteca CC0 já assadas no
  // esqueleto dele pelo Blender (`scripts/blender/retarget_vharen.py`). Não há
  // mais retarget em tempo de execução: o arquivo já chega com os doze clipes
  // que o jogo pede, nos mesmos nomes, então ele é um rig como qualquer outro.
  //
  // A primeira assadura de fato abria a perna: pé esquerdo a 0,91 m do chão e
  // direito a 0,34 m, com o `Idle_Loop` parado. A causa era o alinhamento de
  // repouso usar a direção que o importador de glTF inventou pro osso `Hips`,
  // que aponta pro lado. Corrigido no script com direção anatômica, o mesmo
  // clipe agora mede 0,127 e 0,137, assimetria de 1 cm, e a malha fica com
  // 4,56 m de altura contra 4,62 m de repouso. Por isso ele voltou a ser o
  // padrão. `?mannequim` na URL devolve o provisório, que serve de comparação.
  let bossRig: Rig
  let bossEmber: MeshStandardNodeMaterial
  const querMannequim = new URLSearchParams(window.location.search).has('mannequim')
  try {
    if (querMannequim) throw new Error('mannequim provisório pedido na URL')
    const bossGltf = await assets.model(BOSS_MODEL)
    bossRig = createRig(bossGltf, { scale: boss.height / VHAREN_HEIGHT })
    bossEmber = dressVharen(bossRig.root)
    // O modelo gerado usa nomenclatura humanoide, não a do Rigify.
    const bossHand = bossRig.root.getObjectByName('RightHand')
    // Montante na escala do chefe: duas vezes e meia o do jogador.
    if (bossHand) attachToHand(bossHand, buildGreatsword(1), 2.5)
  } catch (error) {
    if (!querMannequim) {
      console.warn('[game] Vharen definitivo não carregou, usando o mannequim', error)
    }
    const bossSkin = bossMaterials()
    bossRig = createRig(gltf, { scale: boss.height / MODEL_HEIGHT, materials: bossSkin })
    bossEmber = bossSkin[1] as MeshStandardNodeMaterial
    if (bossRig.hand) attachToHand(bossRig.hand, buildGreatsword(1))
  }
  boss.attachRig(bossRig)

  player.enemy = boss

  const state = {
    phase: 'exploring' as Phase,
    respawnTimer: 0,
    victoryTimer: 0,
    /** Enquanto positivo, o jogador não controla nada. */
    cutscene: 0,
    /** Instante em que o congelamento do impacto acaba, em tempo real. */
    hitstopUntil: 0,
  }

  /**
   * Hitstop. No instante do impacto o jogo quase para por alguns quadros.
   *
   * É o truque mais barato e mais eficaz pra um golpe parecer que acertou
   * alguma coisa: sem ele a lâmina atravessa o corpo sem resistência e o
   * acerto some. O golpe pesado congela mais que o leve, e apanhar congela
   * mais ainda, porque é a informação mais importante da tela.
   */
  function freeze(seconds: number): void {
    // Marca um instante no relógio real, não um contador em segundos de jogo:
    // durante o congelamento o tempo de jogo anda a um vinte avos, então um
    // contador descontado com o delta escalado duraria vinte vezes mais.
    state.hitstopUntil = Math.max(state.hitstopUntil, performance.now() + seconds * 1000)
  }
  const gatePosition = new Vector3(arena.gate.position.x, 0, arena.gate.position.z)

  // Som. Tudo sintetizado, nenhum arquivo de áudio no bundle.
  player.onSwing = (heavy) => audio.swing(heavy)
  player.onStep = (weight) => audio.footstep(weight)
  player.onHitLanded = () => {
    audio.impact(0.75)
    freeze(player.state === 'attack' ? 0.075 : 0.06)
    cameraRig.punch(0.35)
  }
  player.onHurt = () => {
    audio.impact(1)
    cameraRig.punch(0.7)
    freeze(0.11)
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

    get timeScale() {
      // Não zera de vez: uma parada absoluta trava o passo fixo da física e
      // deixa o quadro seguinte com um salto. Um vinte avos já lê como pausa.
      return performance.now() < state.hitstopUntil ? 0.05 : 1
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

/**
 * Veste o jogador com a biblioteca por peça em vez da armadura assada. Fica
 * atrás de `?armadura` porque é comparação, não decisão tomada.
 *
 * O elmo entra preso ao osso da cabeça e compensa a escala do osso, do mesmo
 * jeito que `attachToHand` faz com o montante: o rig é escalado pra altura do
 * personagem, e sem compensar o elmo herdaria essa escala duas vezes.
 */
async function dressPlayerWithLibrary(renderer: WebGPURenderer, rig: Rig): Promise<void> {
  const materiais = await loadArmorMaterials(renderer)
  rig.root.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh && mesh.name === 'Mannequin') mesh.material = materiais.acoDePlaca
  })

  const cabeca = rig.root.getObjectByName('DEF-head')
  if (!cabeca) {
    console.warn('[game] osso da cabeça não encontrado, elmo não entrou')
    return
  }
  cabeca.updateWorldMatrix(true, false)
  const escala = new Vector3()
  cabeca.matrixWorld.decompose(new Vector3(), new Quaternion(), escala)
  const compensacao = escala.x > 0.0001 ? 1 / escala.x : 1

  const elmo = buildHelm(materiais, { altura: 0.28 })
  elmo.scale.multiplyScalar(compensacao)
  elmo.position.set(0, 0.09 * compensacao, 0.01 * compensacao)
  cabeca.add(elmo)
}
