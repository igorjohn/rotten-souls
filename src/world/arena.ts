import {
  BoxGeometry,
  CylinderGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three/webgpu'
import type { Physics } from '../core/physics'
import { LAYOUT, insideEntrance, ringPosition } from './layout'

const STONE_DARK = new Color('#2f3033')
const STONE_LIGHT = new Color('#4a4942')
const STONE_FLOOR = new Color('#24231f')

function stone(color: Color, roughness = 0.95, metalness = 0): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({ color, roughness, metalness })
}

export interface Arena {
  root: Group
  /** Alvo estático do lock-on enquanto o chefe não existe. */
  dummy: Object3D
}

/**
 * Gray box do Pátio das Cinzas. Geometria por código, como manda a seção 5.3.
 * As medidas são as definitivas, então o M3 troca a forma sem mexer no jogo.
 */
export function buildArena(physics: Physics): Arena {
  const root = new Group()
  root.name = 'arena'

  root.add(buildFloor(physics))
  root.add(buildWall(physics))
  root.add(buildPillars(physics))
  root.add(buildEntrance(physics))

  const dummy = buildDummy(physics)
  root.add(dummy)

  return { root, dummy }
}

function buildFloor(physics: Physics): Object3D {
  // O piso vai ate embaixo do muro. Se parasse no raio jogavel sobraria um anel
  // vazio entre a borda e a parede, e da pra cair por ele.
  const radius = LAYOUT.wallRadius + LAYOUT.wallThickness + 1
  const geometry = new CylinderGeometry(radius, radius, 1, 72)
  // Rugosidade baixa: o chao e pedra gasta e molhada, entao devolve o fogo.
  const mesh = new Mesh(geometry, stone(STONE_FLOOR, 0.45, 0.1))
  mesh.position.y = -0.5
  mesh.receiveShadow = true
  mesh.name = 'floor'
  physics.addStaticCylinder(new Vector3(0, -0.5, 0), radius, 0.5)
  return mesh
}

function buildWall(physics: Physics): Object3D {
  const step = (Math.PI * 2) / LAYOUT.wallSegments
  // Comprimento da corda mais uma folga, pra não sobrar fresta entre blocos.
  const width = 2 * Math.sin(step / 2) * LAYOUT.wallRadius + 0.25
  const geometry = new BoxGeometry(width, LAYOUT.wallHeight, LAYOUT.wallThickness)

  const placements: Array<{ angle: number }> = []
  for (let i = 0; i < LAYOUT.wallSegments; i++) {
    const angle = i * step
    if (insideEntrance(angle)) continue
    placements.push({ angle })
  }

  const mesh = new InstancedMesh(geometry, stone(STONE_DARK), placements.length)
  mesh.name = 'wall'
  mesh.castShadow = true
  mesh.receiveShadow = true

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3(1, 1, 1)
  const proxy = new Object3D()

  placements.forEach(({ angle }, index) => {
    const radius = LAYOUT.wallRadius + LAYOUT.wallThickness / 2
    const { x, z } = ringPosition(angle, radius)
    position.set(x, LAYOUT.wallHeight / 2, z)
    // A face do bloco tem que olhar pro centro.
    quaternion.setFromAxisAngle(new Vector3(0, 1, 0), -angle + Math.PI / 2)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)

    proxy.position.copy(position)
    proxy.quaternion.copy(quaternion)
    physics.addStaticBox(proxy, {
      x: width / 2,
      y: LAYOUT.wallHeight / 2,
      z: LAYOUT.wallThickness / 2,
    })
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

function buildPillars(physics: Physics): Object3D {
  const geometry = new BoxGeometry(LAYOUT.pillarWidth, LAYOUT.pillarHeight, LAYOUT.pillarWidth)
  const step = (Math.PI * 2) / LAYOUT.pillarCount

  const placements: number[] = []
  for (let i = 0; i < LAYOUT.pillarCount; i++) {
    const angle = i * step + step / 2
    if (insideEntrance(angle)) continue
    placements.push(angle)
  }

  const mesh = new InstancedMesh(geometry, stone(STONE_LIGHT), placements.length)
  mesh.name = 'pillars'
  mesh.castShadow = true
  mesh.receiveShadow = true

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3(1, 1, 1)
  const proxy = new Object3D()

  placements.forEach((angle, index) => {
    const { x, z } = ringPosition(angle, LAYOUT.pillarRadius)
    position.set(x, LAYOUT.pillarHeight / 2, z)
    quaternion.setFromAxisAngle(new Vector3(0, 1, 0), -angle)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)

    proxy.position.copy(position)
    proxy.quaternion.copy(quaternion)
    physics.addStaticBox(proxy, {
      x: LAYOUT.pillarWidth / 2,
      y: LAYOUT.pillarHeight / 2,
      z: LAYOUT.pillarWidth / 2,
    })
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/**
 * Patamar de entrada mais escadaria descendo pra dentro do anel. É por aqui que
 * o jogador chega e é onde o portão de névoa vai ficar no M3.
 */
function buildEntrance(physics: Physics): Object3D {
  const group = new Group()
  group.name = 'entrance'

  const material = stone(STONE_LIGHT, 0.92)
  const { x: dirX, z: dirZ } = ringPosition(LAYOUT.entranceAngle, 1)
  const outward = new Vector3(dirX, 0, dirZ)

  const steps = LAYOUT.stairSteps
  const stepHeight = LAYOUT.entranceLandingHeight / steps
  const stepDepth = LAYOUT.stairStepDepth
  const startRadius = LAYOUT.stairStartRadius

  // Cada degrau e um bloco macico que sobe do chao ate o proprio topo. Assim o
  // colisor bate exatamente com o que se ve e nao sobra vao por baixo.
  const geometry = new BoxGeometry(LAYOUT.stairWidth, stepHeight, stepDepth)
  const mesh = new InstancedMesh(geometry, material, steps)
  mesh.name = 'stairs'
  mesh.castShadow = true
  mesh.receiveShadow = true

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    -LAYOUT.entranceAngle + Math.PI / 2,
  )
  const scale = new Vector3(1, 1, 1)
  const proxy = new Object3D()

  for (let i = 0; i < steps; i++) {
    const radius = startRadius + i * stepDepth
    const top = (i + 1) * stepHeight
    position.copy(outward).multiplyScalar(radius).setY(top / 2)
    scale.set(1, i + 1, 1)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(i, matrix)

    proxy.position.copy(position)
    proxy.quaternion.copy(quaternion)
    physics.addStaticBox(proxy, {
      x: LAYOUT.stairWidth / 2,
      y: top / 2,
      z: stepDepth / 2,
    })
  }
  mesh.instanceMatrix.needsUpdate = true
  group.add(mesh)

  // Patamar la em cima, onde o jogador nasce. O topo fica exatamente em
  // entranceLandingHeight, que e de onde PLAYER_SPAWN e calculado.
  const landingDepth = LAYOUT.landingDepth
  const landingThickness = 0.8
  const landing = new Mesh(
    new BoxGeometry(LAYOUT.stairWidth + 3, landingThickness, landingDepth),
    stone(STONE_DARK, 0.92),
  )
  landing.position
    .copy(outward)
    .multiplyScalar(LAYOUT.landingCenterRadius)
    .setY(LAYOUT.entranceLandingHeight - landingThickness / 2)
  landing.quaternion.copy(quaternion)
  landing.receiveShadow = true
  landing.castShadow = true
  group.add(landing)
  physics.addStaticBox(landing, {
    x: (LAYOUT.stairWidth + 3) / 2,
    y: landingThickness / 2,
    z: landingDepth / 2,
  })

  // Paredes laterais do corredor de entrada, pra nao dar pra sair andando pro nada.
  const corridorLength = landingDepth + steps * stepDepth
  for (const side of [-1, 1]) {
    const wall = new Mesh(new BoxGeometry(1, 7, corridorLength), stone(STONE_DARK))
    const lateral = new Vector3(-outward.z, 0, outward.x).multiplyScalar(
      side * (LAYOUT.stairWidth / 2 + 1.1),
    )
    wall.position
      .copy(outward)
      .multiplyScalar(startRadius + corridorLength / 2)
      .add(lateral)
      .setY(LAYOUT.entranceLandingHeight + 0.6)
    wall.quaternion.copy(quaternion)
    wall.castShadow = true
    wall.receiveShadow = true
    group.add(wall)
    physics.addStaticBox(wall, { x: 0.5, y: 3.5, z: corridorLength / 2 })
  }

  // Fundo do corredor, pra nao dar pra andar pra fora do mapa.
  const back = new Mesh(new BoxGeometry(LAYOUT.stairWidth + 4, 7, 1), stone(STONE_DARK))
  back.position
    .copy(outward)
    .multiplyScalar(LAYOUT.landingCenterRadius + landingDepth / 2)
    .setY(LAYOUT.entranceLandingHeight + 0.6)
  back.quaternion.copy(quaternion)
  back.castShadow = true
  group.add(back)
  physics.addStaticBox(back, { x: (LAYOUT.stairWidth + 4) / 2, y: 3.5, z: 0.5 })

  return group
}

/** Cilindro alto no lugar do chefe, só pra ter em quem travar a mira no M1. */
function buildDummy(physics: Physics): Object3D {
  const mesh = new Mesh(
    new CylinderGeometry(0.9, 1.1, 4.2, 12),
    stone(new Color('#6b6a63'), 0.85),
  )
  mesh.name = 'dummy'
  mesh.position.set(LAYOUT.bossSpawn.x, 2.1, LAYOUT.bossSpawn.z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  physics.addStaticCylinder(mesh.position, 1.1, 2.1)
  return mesh
}
