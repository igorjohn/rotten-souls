import { Object3D, Quaternion, Vector3, type Bone, type Material, type Mesh, type SkinnedMesh } from 'three/webgpu'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

/**
 * De osso do modelo gerado para osso da biblioteca CC0.
 *
 * O modelo do Vharen sai do image-to-3D com nomenclatura padrão de humanoide
 * (`Hips`, `LeftArm`, `RightHand`), e a biblioteca de animação usa a do Rigify
 * (`DEF-hips`, `DEF-upper_arm.L`), que o carregador de glTF do Three ainda
 * limpa tirando os pontos.
 *
 * Cuidado com a coluna: a cadeia do modelo gerado é
 * `Hips -> Spine02 -> Spine01 -> Spine`, ou seja `Spine02` é a vértebra de
 * baixo e `Spine` é a de cima, ao contrário do que o nome sugere.
 */
const BONE_MAP: Record<string, string> = {
  Hips: 'DEF-hips',
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

interface Pair {
  target: Bone
  source: Bone
  /** Rotação que leva do repouso da fonte pro repouso do alvo, em mundo. */
  offset: Quaternion
  /** Profundidade na hierarquia. Serve pra processar pai antes de filho. */
  depth: number
}

export interface RetargetedSkin {
  root: Object3D
  hand: Object3D | null
  /** Copia a pose do esqueleto que dirige. Roda uma vez por frame. */
  update(): void
}

export interface SkinOptions {
  /** Altura desejada do personagem em metros. A escala sai daqui. */
  height: number
  material?: Material
  castShadow?: boolean
}

/**
 * Veste um esqueleto animado com outra malha.
 *
 * O `SkeletonUtils.retarget` do Three não dá conta destes dois esqueletos: uma
 * única chamada estoura a malha de 1,95 para 17 mil metros, porque ele escreve
 * matrizes derivadas do espaço de mundo de volta nos ossos locais e a diferença
 * de escala entre as duas hierarquias entra junto.
 *
 * Este retarget faz a conta explícita e só com rotação, que é o que interessa:
 * para cada par de ossos, guarda no início a rotação que leva do repouso da
 * fonte pro repouso do alvo, e a cada frame aplica
 * `alvo_mundo = fonte_mundo * essa_rotação`, convertendo pro espaço local do
 * pai do alvo. Nenhuma escala entra na conta, então nada acumula. Só o quadril
 * carrega posição, escalada pela razão de altura entre os dois esqueletos.
 */
export function createRetargetedSkin(
  gltf: GLTF,
  source: Object3D,
  options: SkinOptions,
): RetargetedSkin {
  const root = cloneSkinned(gltf.scene) as Object3D

  let targetMesh: SkinnedMesh | null = null
  let hand: Object3D | null = null
  root.traverse((child) => {
    const mesh = child as SkinnedMesh
    if (mesh.isSkinnedMesh && !targetMesh) targetMesh = mesh
    if ((child as Mesh).isMesh) {
      const asMesh = child as Mesh
      asMesh.castShadow = options.castShadow ?? true
      asMesh.receiveShadow = true
      if (options.material) asMesh.material = options.material
    }
    if (child.name === 'RightHand') hand = child
  })

  const sourceMesh = findSkinnedMesh(source)
  const pairs: Pair[] = []

  if (targetMesh && sourceMesh) {
    const target = targetMesh as SkinnedMesh
    const from = sourceMesh as SkinnedMesh
    // Repouso dos dois, pra medir a diferença de orientação uma vez só.
    target.skeleton.pose()
    from.skeleton.pose()
    root.updateMatrixWorld(true)
    source.updateMatrixWorld(true)

    const sourceQuat = new Quaternion()
    const targetQuat = new Quaternion()

    for (const bone of target.skeleton.bones) {
      const sourceName = BONE_MAP[bone.name]
      if (!sourceName) continue
      const sourceBone = from.skeleton.bones.find((b) => b.name === sourceName)
      if (!sourceBone) continue

      bone.matrixWorld.decompose(new Vector3(), targetQuat, new Vector3())
      sourceBone.matrixWorld.decompose(new Vector3(), sourceQuat, new Vector3())
      const offset = sourceQuat.clone().invert().multiply(targetQuat)

      pairs.push({ target: bone, source: sourceBone, offset, depth: depthOf(bone) })
    }
  }

  // Escala e altura do chão saem de medição, não de constante. A caixa da
  // geometria não serve aqui: ela ignora o esfolamento, e o nó da malha ainda
  // carrega uma escala própria embutida pelo gerador. O jeito honesto é
  // percorrer os vértices já deformados e já passados pela matriz de mundo.
  if (targetMesh) {
    const measured = measureSkinned(root, targetMesh as SkinnedMesh)
    if (measured.height > 0) {
      const scale = options.height / measured.height
      root.scale.setScalar(scale)
      root.position.y = -measured.base * scale
    }
  }

  // Pai antes de filho. A conversão pro espaço local usa a matriz de mundo do
  // pai, e se ela ainda for a do frame anterior a rotação sai errada e treme.
  pairs.sort((a, b) => a.depth - b.depth)

  // Ossos do pé, usados pra plantar o chefe no chão a cada frame.
  const feet = (targetMesh as SkinnedMesh | null)?.skeleton.bones.filter((b) =>
    FOOT_BONES.includes(b.name),
  ) ?? []
  let groundOffset = root.position.y

  const worldQuat = new Quaternion()
  const parentQuat = new Quaternion()
  const scratch = new Vector3()

  return {
    root,
    get hand() {
      return hand
    },
    update() {
      if (pairs.length === 0) return
      // A fonte é animada pelo mixer, que só mexe nos transformes locais. Sem
      // isto, a pose copiada seria a do frame anterior.
      source.updateMatrixWorld(true)

      for (const pair of pairs) {
        // Rotação da fonte em mundo, mais a diferença de repouso.
        pair.source.matrixWorld.decompose(scratch, worldQuat, scratch)
        worldQuat.multiply(pair.offset)

        // Pro espaço local do pai do alvo. Sem isso a rotação sai duplicada.
        const parent = pair.target.parent
        if (parent) {
          parent.matrixWorld.decompose(scratch, parentQuat, scratch)
          pair.target.quaternion.copy(parentQuat.invert().multiply(worldQuat))
        } else {
          pair.target.quaternion.copy(worldQuat)
        }
        // Só este osso: os filhos vêm depois na lista, já ordenada.
        pair.target.updateMatrix()
        pair.target.updateMatrixWorld(false)
      }

      // Planta no chão pelo pé mais baixo.
      //
      // Alinhar só uma vez, na pose de repouso, não basta: com as pernas
      // dobradas de uma pose animada os pés sobem e o chefe fica boiando.
      // Medir a cada frame e corrigir com amortecimento mantém ele plantado
      // em qualquer pose, sem tremer.
      if (feet.length > 0) {
        let lowest = Infinity
        for (const foot of feet) {
          const y = foot.matrixWorld.elements[13]
          if (y < lowest) lowest = y
        }
        const parentY = root.parent ? root.parent.matrixWorld.elements[13] : 0
        const desired = groundOffset - (lowest - parentY)
        groundOffset += (desired - groundOffset) * 0.25
        root.position.y = groundOffset
      }

      // Nenhum osso leva translação, nem o quadril.
      //
      // O deslocamento do personagem no mundo vem da cápsula da física, não da
      // animação, então copiar a translação do quadril só serve pra tirar o
      // chefe do chão: as duas hierarquias têm proporções diferentes e o erro
      // aparece como pé no ar. Rotação pura mantém ele plantado.
    },
  }
}

/**
 * Altura e base da malha com pele, em unidades da raiz e na pose de repouso.
 * Amostra um vértice a cada cinquenta, que é folgado pra caixa envolvente e
 * roda em milissegundos numa malha de 76 mil vértices.
 */
function measureSkinned(root: Object3D, mesh: SkinnedMesh): { height: number; base: number } {
  const previousScale = root.scale.x
  const previousY = root.position.y
  root.scale.setScalar(1)
  root.position.y = 0
  mesh.skeleton.pose()
  root.updateMatrixWorld(true)

  const point = new Vector3()
  let min = Infinity
  let max = -Infinity
  const count = mesh.geometry.attributes.position.count
  for (let i = 0; i < count; i += 50) {
    mesh.getVertexPosition(i, point)
    point.applyMatrix4(mesh.matrixWorld)
    if (point.y < min) min = point.y
    if (point.y > max) max = point.y
  }

  root.scale.setScalar(previousScale)
  root.position.y = previousY
  return { height: max - min, base: min }
}

/** Pés e dedos do modelo gerado. O mais baixo dos quatro define o chão. */
const FOOT_BONES = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']

function depthOf(bone: Object3D): number {
  let depth = 0
  let node: Object3D | null = bone.parent
  while (node) {
    depth++
    node = node.parent
  }
  return depth
}

function findSkinnedMesh(root: Object3D): SkinnedMesh | null {
  let found: SkinnedMesh | null = null
  root.traverse((child) => {
    const mesh = child as SkinnedMesh
    if (mesh.isSkinnedMesh && !found) found = mesh
  })
  return found
}
