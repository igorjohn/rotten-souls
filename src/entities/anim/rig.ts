import {
  AnimationMixer,
  Bone,
  LoopOnce,
  LoopRepeat,
  Object3D,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Mesh,
} from 'three/webgpu'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

export interface PlayOptions {
  /** Tempo de mistura com o clipe anterior, em segundos. */
  fade?: number
  /** Multiplicador de velocidade. Ataque pesado é o mesmo clipe mais lento. */
  speed?: number
  /** Clipe de uma vez só, que congela no último quadro. */
  once?: boolean
  /** Reinicia mesmo se já estiver tocando. */
  restart?: boolean
}

export interface Rig {
  root: Object3D
  mixer: AnimationMixer
  /** Osso da mão direita, onde a arma é presa. */
  hand: Object3D | null
  current: string | null
  play(clip: string, options?: PlayOptions): void
  /** Chamado quando um clipe de uma vez só termina. */
  onFinished(fn: (clip: string) => void): void
  /** Progresso do clipe atual, de 0 a 1. Serve pras janelas de golpe. */
  progress(): number
  update(dt: number): void
  dispose(): void
}

/**
 * O carregador de glTF do Three limpa os nomes dos nós e remove pontos, então
 * o osso que no arquivo se chama `DEF-hand.R` chega aqui como `DEF-handR`.
 * Aceita os dois pra não depender dessa limpeza continuar igual.
 */
const HAND_BONES = ['DEF-handR', 'DEF-hand.R']

export interface RigOptions {
  scale?: number
  /** Material que substitui o do mannequim. Um por corpo, um por juntas. */
  materials?: [Material, Material]
  castShadow?: boolean
}

/**
 * Instância animada a partir do GLB da biblioteca CC0. O mesmo arquivo serve
 * pro jogador e pro chefe: `SkeletonUtils.clone` copia malha e esqueleto sem
 * recarregar nada, e a escala faz o resto.
 */
export function createRig(gltf: GLTF, options: RigOptions = {}): Rig {
  const root = cloneSkinned(gltf.scene) as Object3D
  root.scale.setScalar(options.scale ?? 1)

  let handBone: Object3D | null = null
  let materialIndex = 0
  root.traverse((child) => {
    if ((child as Bone).isBone && HAND_BONES.includes(child.name)) handBone = child
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = options.castShadow ?? true
    mesh.receiveShadow = true
    // A malha vem com material chapado laranja e roxo. Troca por algo que
    // pertença à paleta, mesmo sendo provisório.
    if (options.materials) {
      mesh.material = options.materials[Math.min(materialIndex, 1)]
      materialIndex++
    }
  })

  const mixer = new AnimationMixer(root)
  const clips = new Map<string, AnimationClip>()
  for (const clip of gltf.animations) clips.set(clip.name, clip)

  const actions = new Map<string, [AnimationAction, AnimationAction]>()
  let current: AnimationAction | null = null
  let currentName: string | null = null
  const listeners: Array<(clip: string) => void> = []

  mixer.addEventListener('finished', (event) => {
    const action = (event as unknown as { action: AnimationAction }).action
    const name = findName(actions, action)
    if (name) for (const fn of listeners) fn(name)
  })

  /**
   * Duas instâncias por clipe, e não uma.
   *
   * O `AnimationMixer` indexa a ação pelo clipe, então pedir o mesmo clipe duas
   * vezes devolve o mesmo objeto. Isso quebrava o encadeamento de golpes: o
   * segundo leve é o mesmo `Sword_Attack` do primeiro, e como `crossFadeFrom`
   * precisa de duas ações diferentes, o `play` caía num `reset()` seco. A mão
   * do personagem saltava 125 cm num quadro, no meio do corte, voltando pra
   * pose de preparação. Era isso que aparecia como travada ao clicar rápido.
   *
   * Uma cópia do clipe tem outro uuid e rende uma segunda ação, então dá pra
   * alternar entre as duas e misturar um golpe com o seguinte de verdade.
   */
  function actionPair(clip: string): [AnimationAction, AnimationAction] | null {
    const existing = actions.get(clip)
    if (existing) return existing
    const source = clips.get(clip)
    if (!source) {
      console.warn(`[rig] clipe ausente: ${clip}`)
      return null
    }
    const created: [AnimationAction, AnimationAction] = [
      mixer.clipAction(source),
      mixer.clipAction(source.clone()),
    ]
    actions.set(clip, created)
    return created
  }

  return {
    root,
    mixer,
    get hand() {
      return handBone
    },
    get current() {
      return currentName
    },
    play(clip, playOptions = {}) {
      if (currentName === clip && !playOptions.restart) return
      const pair = actionPair(clip)
      if (!pair) return
      // Se o clipe pedido é o que já está tocando, usa a outra instância: é o
      // que dá o que misturar em vez de cortar seco no meio do movimento.
      const next = pair[0] === current ? pair[1] : pair[0]

      const fade = playOptions.fade ?? 0.18
      next.enabled = true
      next.setEffectiveTimeScale(playOptions.speed ?? 1)
      next.setEffectiveWeight(1)
      next.setLoop(playOptions.once ? LoopOnce : LoopRepeat, Infinity)
      next.clampWhenFinished = playOptions.once ?? false
      next.reset()

      if (current && current !== next && fade > 0) next.crossFadeFrom(current, fade, false)
      next.play()

      current = next
      currentName = clip
    },
    onFinished(fn) {
      listeners.push(fn)
    },
    progress() {
      if (!current) return 0
      const duration = current.getClip().duration
      return duration > 0 ? Math.min(1, current.time / duration) : 0
    },
    update(dt) {
      mixer.update(dt)
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
    },
  }
}

function findName(
  actions: Map<string, [AnimationAction, AnimationAction]>,
  action: AnimationAction,
): string | null {
  for (const [name, pair] of actions) {
    if (pair[0] === action || pair[1] === action) return name
  }
  return null
}
