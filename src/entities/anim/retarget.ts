import { Object3D, type Material, type Mesh, type SkinnedMesh } from 'three/webgpu'
import { clone as cloneSkinned, retarget } from 'three/addons/utils/SkeletonUtils.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

/**
 * De osso do modelo gerado para osso da biblioteca CC0.
 *
 * O modelo do Vharen sai do image-to-3D com nomenclatura padrão de humanoide
 * (`Hips`, `LeftArm`, `RightHand`), e a biblioteca de animação usa a do Rigify
 * (`DEF-hips`, `DEF-upper_arm.L`), que o carregador de glTF do Three ainda
 * limpa tirando os pontos. Este mapa é a ponte entre os dois.
 */
const BONE_MAP: Record<string, string> = {
  Hips: 'DEF-hips',
  // Cuidado com a coluna: a cadeia do modelo gerado é
  // `Hips -> Spine02 -> Spine01 -> Spine`, ou seja `Spine02` é a vértebra de
  // baixo e `Spine` é a de cima, ao contrário do que o nome sugere. Mapear na
  // ordem óbvia torce o tronco e a malha vira uma cunha.
  Spine02: 'DEF-spine001',
  Spine01: 'DEF-spine002',
  Spine: 'DEF-spine003',
  neck: 'DEF-neck',
  Head: 'DEF-head',
  LeftShoulder: 'DEF-shoulderL',
  LeftArm: 'DEF-upper_armL',
  LeftForeArm: 'DEF-forearmL',
  LeftHand: 'DEF-handL',
  RightShoulder: 'DEF-shoulderR',
  RightArm: 'DEF-upper_armR',
  RightForeArm: 'DEF-forearmR',
  RightHand: 'DEF-handR',
  LeftUpLeg: 'DEF-thighL',
  LeftLeg: 'DEF-shinL',
  LeftFoot: 'DEF-footL',
  LeftToeBase: 'DEF-toeL',
  RightUpLeg: 'DEF-thighR',
  RightLeg: 'DEF-shinR',
  RightFoot: 'DEF-footR',
  RightToeBase: 'DEF-toeR',
}

export interface RetargetedSkin {
  root: Object3D
  hand: Object3D | null
  /** Copia a pose do esqueleto que dirige. Roda uma vez por frame. */
  update(): void
}

export interface SkinOptions {
  /** Escala aplicada na raiz. O modelo gerado vem em centésimos de metro. */
  scale: number
  material?: Material
  castShadow?: boolean
}

/**
 * Veste um esqueleto animado com outra malha.
 *
 * Em vez de assar cada clipe da biblioteca no esqueleto novo, o esqueleto CC0
 * continua dirigindo a animação, invisível, e a pose é copiada pro modelo
 * gerado a cada frame. Reaproveita a máquina de estados inteira, não depende de
 * assar 46 clipes que podem sair errados, e custa 22 ossos por frame, que é
 * nada. O preço é uma malha a mais na cena, que já estava no orçamento.
 */
export function createRetargetedSkin(
  gltf: GLTF,
  source: Object3D,
  options: SkinOptions,
): RetargetedSkin {
  const root = cloneSkinned(gltf.scene) as Object3D
  root.scale.setScalar(options.scale)

  let target: SkinnedMesh | null = null
  let hand: Object3D | null = null
  root.traverse((child) => {
    const mesh = child as SkinnedMesh
    if (mesh.isSkinnedMesh && !target) target = mesh
    if ((child as Mesh).isMesh) {
      const asMesh = child as Mesh
      asMesh.castShadow = options.castShadow ?? true
      asMesh.receiveShadow = true
      if (options.material) asMesh.material = options.material
    }
    if (child.name === 'RightHand') hand = child
  })

  const sourceMesh = findSkinnedMesh(source)

  return {
    root,
    get hand() {
      return hand
    },
    update() {
      if (!target || !sourceMesh) return
      // `preserveBonePositions` é o nome que a implementação da r185 lê. O
      // pacote de tipos ainda declara o nome antigo, daí a conversão.
      retarget(target, sourceMesh, {
        names: BONE_MAP,
        // O quadril é o único osso cuja posição importa: o resto é rotação.
        hip: 'DEF-hips',
        preserveBoneMatrix: false,
        useTargetMatrix: true,
        preserveBonePositions: true,
      } as Parameters<typeof retarget>[2])
    },
  }
}

function findSkinnedMesh(root: Object3D): SkinnedMesh | null {
  let found: SkinnedMesh | null = null
  root.traverse((child) => {
    const mesh = child as SkinnedMesh
    if (mesh.isSkinnedMesh && !found) found = mesh
  })
  return found
}
