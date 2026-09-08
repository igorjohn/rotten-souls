import {
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three/webgpu'
import type { Physics } from '../core/physics'
import { LAYOUT, insideEntrance, ringPosition } from './layout'
import type { Materials } from './materials'
import { uvScale } from './materials'
import { box, gothicBay, rubbleChunk, ruinedBay, scaleUv } from './kit/geometry'
import { buildFogGate, type FogGate } from './kit/fog-gate'

export interface Arena {
  root: Group
  gate: FogGate
}

const UP = new Vector3(0, 1, 0)

/**
 * Pátio das Cinzas montado a partir do kit modular. Toda a geometria sai de
 * código: arcada gótica, contrafortes, muro externo, piso em anéis, escadaria,
 * portão de névoa e escombros. Nada de GLB de arquitetura, como manda a
 * seção 5.3, porque textura CC0 boa em cima de forma simples engana bem no escuro.
 */
export function buildArena(physics: Physics, materials: Materials): Arena {
  const root = new Group()
  root.name = 'arena'

  root.add(buildGround(physics, materials))
  root.add(buildFloorRings(materials))
  root.add(buildArcade(physics, materials))
  root.add(buildButtresses(physics, materials))
  root.add(buildOuterWall(physics, materials))
  root.add(buildParapet(materials))
  root.add(buildEntrance(physics, materials))
  root.add(buildRubble(physics, materials))

  const gate = buildFogGate(materials)
  root.add(gate.root)

  return { root, gate }
}

/** Piso que vai até embaixo de tudo, pra não sobrar vão onde dá pra cair. */
function buildGround(physics: Physics, materials: Materials): Object3D {
  const radius = LAYOUT.groundRadius
  const geometry = new CylinderGeometry(radius, radius, 1, 96)
  scaleUvFromWorld(geometry, radius, uvScale('chao'))
  const mesh = new Mesh(geometry, materials.chao)
  mesh.position.y = -0.5
  mesh.receiveShadow = true
  mesh.name = 'floor'
  physics.addStaticCylinder(new Vector3(0, -0.5, 0), radius, 0.5)
  return mesh
}

/** Anéis rasos gravados no piso, o desenho que a referência tem no chão. */
function buildFloorRings(materials: Materials): Object3D {
  const group = new Group()
  group.name = 'floor-rings'
  for (const radius of LAYOUT.floorRings) {
    const geometry = new RingGeometry(radius - 0.26, radius + 0.26, 96)
    geometry.rotateX(-Math.PI / 2)
    scaleUvFromWorld(geometry, radius, uvScale('degrau'))
    const ring = new Mesh(geometry, materials.degrau)
    ring.position.y = 0.012
    ring.receiveShadow = true
    group.add(ring)
  }
  return group
}

interface BayPlacement {
  angle: number
  ruined: boolean
  index: number
}

function bayPlacements(): BayPlacement[] {
  const step = (Math.PI * 2) / LAYOUT.bayCount
  const placements: BayPlacement[] = []
  for (let i = 0; i < LAYOUT.bayCount; i++) {
    const angle = LAYOUT.entranceAngle + i * step
    if (i === 0) continue // o vão da entrada vira o portão de névoa
    placements.push({ angle, index: i, ruined: LAYOUT.ruinedBays.includes(i) })
  }
  return placements
}

/** Largura de corda de um vão, que é o que faz os painéis fecharem o anel. */
function bayWidth(): number {
  const step = (Math.PI * 2) / LAYOUT.bayCount
  return 2 * Math.sin(step / 2) * (LAYOUT.arcadeRadius + LAYOUT.arcadeDepth / 2) + 0.1
}

function buildArcade(physics: Physics, materials: Materials): Object3D {
  const group = new Group()
  group.name = 'arcade'
  const width = bayWidth()
  const uv = uvScale('muro')

  const options = {
    width,
    height: LAYOUT.arcadeHeight,
    depth: LAYOUT.arcadeDepth,
    openingWidth: LAYOUT.bayOpening,
    springHeight: LAYOUT.baySpring,
    uvPerMeter: uv,
  }

  const placements = bayPlacements()
  const preserved = placements.filter((p) => !p.ruined)
  const ruined = placements.filter((p) => p.ruined)

  group.add(instanceBays(gothicBay(options), preserved, materials, 'bays-preserved'))
  if (ruined.length > 0) {
    // Cada ruína tem semente própria, senão as quatro caem do mesmo jeito.
    ruined.forEach((placement, i) => {
      const geometry = ruinedBay({ ...options, seed: placement.index * 7 + 3 })
      group.add(instanceBays(geometry, [placement], materials, `bay-ruined-${i}`))
    })
  }

  // Colisão: os dois pés de cada vão. O vazado do arco fica passável, e quem
  // entra nele esbarra no muro externo logo atrás.
  const pierWidth = (width - LAYOUT.bayOpening) / 2
  const proxy = new Object3D()
  for (const placement of placements) {
    const radius = LAYOUT.arcadeRadius + LAYOUT.arcadeDepth / 2
    const { x, z } = ringPosition(placement.angle, radius)
    const tangent = new Vector3(-Math.sin(placement.angle), 0, Math.cos(placement.angle))
    for (const side of [-1, 1]) {
      const offset = side * (LAYOUT.bayOpening / 2 + pierWidth / 2)
      proxy.position.set(x + tangent.x * offset, LAYOUT.arcadeHeight / 2, z + tangent.z * offset)
      proxy.quaternion.setFromAxisAngle(UP, -placement.angle + Math.PI / 2)
      physics.addStaticBox(proxy, {
        x: pierWidth / 2,
        y: LAYOUT.arcadeHeight / 2,
        z: LAYOUT.arcadeDepth / 2,
      })
    }
  }

  return group
}

function instanceBays(
  geometry: ReturnType<typeof gothicBay>,
  placements: BayPlacement[],
  materials: Materials,
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, materials.muro, placements.length)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3(1, 1, 1)

  placements.forEach((placement, index) => {
    const radius = LAYOUT.arcadeRadius + LAYOUT.arcadeDepth / 2
    const { x, z } = ringPosition(placement.angle, radius)
    position.set(x, 0, z)
    quaternion.setFromAxisAngle(UP, -placement.angle + Math.PI / 2)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/** Contrafortes entre os vãos, mais altos que a arcada, dando ritmo vertical. */
function buildButtresses(physics: Physics, materials: Materials): Object3D {
  const step = (Math.PI * 2) / LAYOUT.bayCount
  const angles: number[] = []
  for (let i = 0; i < LAYOUT.bayCount; i++) {
    const angle = LAYOUT.entranceAngle + i * step + step / 2
    if (insideEntrance(angle)) continue
    angles.push(angle)
  }

  const geometry = box(
    LAYOUT.pillarWidth,
    LAYOUT.pillarHeight,
    LAYOUT.pillarDepth,
    uvScale('muro'),
  )
  const mesh = new InstancedMesh(geometry, materials.muro, angles.length)
  mesh.name = 'buttresses'
  mesh.castShadow = true
  mesh.receiveShadow = true

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3(1, 1, 1)
  const proxy = new Object3D()

  angles.forEach((angle, index) => {
    const { x, z } = ringPosition(angle, LAYOUT.pillarRadius)
    position.set(x, LAYOUT.pillarHeight / 2, z)
    quaternion.setFromAxisAngle(UP, -angle + Math.PI / 2)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)

    proxy.position.copy(position)
    proxy.quaternion.copy(quaternion)
    physics.addStaticBox(proxy, {
      x: LAYOUT.pillarWidth / 2,
      y: LAYOUT.pillarHeight / 2,
      z: LAYOUT.pillarDepth / 2,
    })
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/** Muro externo atrás da arcada. É o que aparece escuro por dentro dos arcos. */
function buildOuterWall(physics: Physics, materials: Materials): Object3D {
  const step = (Math.PI * 2) / LAYOUT.outerSegments
  const radius = LAYOUT.outerRadius + LAYOUT.outerThickness / 2
  const width = 2 * Math.sin(step / 2) * radius + 0.2

  const placements: number[] = []
  for (let i = 0; i < LAYOUT.outerSegments; i++) {
    const angle = i * step
    if (insideEntrance(angle)) continue
    placements.push(angle)
  }

  const geometry = box(width, LAYOUT.outerHeight, LAYOUT.outerThickness, uvScale('muro'))
  const mesh = new InstancedMesh(geometry, materials.muro, placements.length)
  mesh.name = 'outer-wall'
  // Nao lanca sombra: e a casca de fora, nada fica atras dela. So isso ja tira
  // trinta e seis blocos do passe de sombra.
  mesh.castShadow = false
  mesh.receiveShadow = true

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3(1, 1, 1)
  const proxy = new Object3D()

  placements.forEach((angle, index) => {
    const { x, z } = ringPosition(angle, radius)
    position.set(x, LAYOUT.outerHeight / 2, z)
    quaternion.setFromAxisAngle(UP, -angle + Math.PI / 2)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)

    proxy.position.copy(position)
    proxy.quaternion.copy(quaternion)
    physics.addStaticBox(proxy, {
      x: width / 2,
      y: LAYOUT.outerHeight / 2,
      z: LAYOUT.outerThickness / 2,
    })
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/** Faixa de pedra por cima da arcada, fechando a silhueta contra o céu. */
function buildParapet(materials: Materials): Object3D {
  const step = (Math.PI * 2) / LAYOUT.bayCount
  const radius = LAYOUT.arcadeRadius + LAYOUT.arcadeDepth / 2
  const width = 2 * Math.sin(step / 2) * radius + 0.12

  const placements: number[] = []
  for (let i = 1; i < LAYOUT.bayCount; i++) {
    placements.push(LAYOUT.entranceAngle + i * step)
  }

  const geometry = box(width, LAYOUT.parapetHeight, LAYOUT.arcadeDepth * 1.25, uvScale('degrau'))
  const mesh = new InstancedMesh(geometry, materials.degrau, placements.length)
  mesh.name = 'parapet'
  mesh.castShadow = false
  mesh.receiveShadow = true

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3(1, 1, 1)

  placements.forEach((angle, index) => {
    const { x, z } = ringPosition(angle, radius)
    position.set(x, LAYOUT.arcadeHeight + LAYOUT.parapetHeight / 2, z)
    quaternion.setFromAxisAngle(UP, -angle + Math.PI / 2)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/**
 * Escadaria e patamar de entrada. Cada degrau é um bloco maciço do chão até o
 * próprio topo, e o colisor bate com o que se vê.
 */
function buildEntrance(physics: Physics, materials: Materials): Object3D {
  const group = new Group()
  group.name = 'entrance'

  const { x: dirX, z: dirZ } = ringPosition(LAYOUT.entranceAngle, 1)
  const outward = new Vector3(dirX, 0, dirZ)
  const steps = LAYOUT.stairSteps
  const stepHeight = LAYOUT.entranceLandingHeight / steps
  const stepDepth = LAYOUT.stairStepDepth
  const startRadius = LAYOUT.stairStartRadius
  const uv = uvScale('degrau')

  const geometry = box(LAYOUT.stairWidth, stepHeight, stepDepth, uv)
  const mesh = new InstancedMesh(geometry, materials.degrau, steps)
  mesh.name = 'stairs'
  mesh.castShadow = true
  mesh.receiveShadow = true

  const matrix = new Matrix4()
  const position = new Vector3()
  const quaternion = new Quaternion().setFromAxisAngle(UP, -LAYOUT.entranceAngle + Math.PI / 2)
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
    physics.addStaticBox(proxy, { x: LAYOUT.stairWidth / 2, y: top / 2, z: stepDepth / 2 })
  }
  mesh.instanceMatrix.needsUpdate = true
  group.add(mesh)

  const landingDepth = LAYOUT.landingDepth
  const landingThickness = 0.8
  const landing = new Mesh(
    box(LAYOUT.stairWidth + 3, landingThickness, landingDepth, uv),
    materials.degrau,
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

  const corridorLength = landingDepth + steps * stepDepth
  for (const side of [-1, 1]) {
    const wall = new Mesh(box(1, 8, corridorLength, uvScale('muro')), materials.muro)
    const lateral = new Vector3(-outward.z, 0, outward.x).multiplyScalar(
      side * (LAYOUT.stairWidth / 2 + 1.1),
    )
    wall.position
      .copy(outward)
      .multiplyScalar(startRadius + corridorLength / 2)
      .add(lateral)
      .setY(LAYOUT.entranceLandingHeight + 1)
    wall.quaternion.copy(quaternion)
    wall.castShadow = true
    wall.receiveShadow = true
    group.add(wall)
    physics.addStaticBox(wall, { x: 0.5, y: 4, z: corridorLength / 2 })
  }

  const back = new Mesh(box(LAYOUT.stairWidth + 4, 8, 1, uvScale('muro')), materials.muro)
  back.position
    .copy(outward)
    .multiplyScalar(LAYOUT.landingCenterRadius + landingDepth / 2)
    .setY(LAYOUT.entranceLandingHeight + 1)
  back.quaternion.copy(quaternion)
  back.castShadow = true
  group.add(back)
  physics.addStaticBox(back, { x: (LAYOUT.stairWidth + 4) / 2, y: 4, z: 0.5 })

  return group
}

/** Escombros no pé dos vãos arruinados e soltos pelo anel. */
function buildRubble(physics: Physics, materials: Materials): Object3D {
  const group = new Group()
  group.name = 'rubble'
  const uv = uvScale('rocha')

  const pieces: Array<{ position: Vector3; rotation: number; size: number; seed: number }> = []
  const step = (Math.PI * 2) / LAYOUT.bayCount

  // Monte de pedra caída embaixo de cada vão arruinado.
  for (const index of LAYOUT.ruinedBays) {
    const angle = LAYOUT.entranceAngle + index * step
    for (let i = 0; i < 5; i++) {
      const spread = (i - 2) * 1.5
      const tangent = new Vector3(-Math.sin(angle), 0, Math.cos(angle))
      const radius = LAYOUT.arcadeRadius - 1.4 - (i % 3) * 0.9
      const { x, z } = ringPosition(angle, radius)
      const size = 0.9 + ((i * 37) % 5) * 0.22
      pieces.push({
        position: new Vector3(x + tangent.x * spread, size * 0.3, z + tangent.z * spread),
        rotation: angle + i * 0.8,
        size,
        seed: index * 11 + i,
      })
    }
  }

  // Alguns blocos soltos no anel, quebrando a simetria do chão.
  for (let i = 0; i < 9; i++) {
    const angle = (i * 2.39996) % (Math.PI * 2)
    if (insideEntrance(angle)) continue
    const radius = 9 + ((i * 5) % 9)
    const { x, z } = ringPosition(angle, radius)
    const size = 0.55 + ((i * 13) % 4) * 0.16
    pieces.push({
      position: new Vector3(x, size * 0.24, z),
      rotation: angle * 1.7,
      size,
      seed: 100 + i,
    })
  }

  // Uma geometria por peça seria caro; três formas cobrem a variação e o
  // resto vem de rotação e escala.
  const shapes = [0, 1, 2].map((i) => rubbleChunk(i * 17 + 5, 1, uv))
  const buckets: Array<typeof pieces> = [[], [], []]
  pieces.forEach((piece, i) => buckets[i % 3].push(piece))

  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  const proxy = new Object3D()

  buckets.forEach((bucket, i) => {
    if (bucket.length === 0) return
    const mesh = new InstancedMesh(shapes[i], materials.rocha, bucket.length)
    mesh.name = `rubble-${i}`
    // Escombro e pequeno e fica no escuro: a sombra dele nao paga o custo.
    mesh.castShadow = false
    mesh.receiveShadow = true
    bucket.forEach((piece, index) => {
      quaternion.setFromAxisAngle(UP, piece.rotation)
      scale.setScalar(piece.size)
      matrix.compose(piece.position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)

      proxy.position.copy(piece.position)
      proxy.quaternion.copy(quaternion)
      physics.addStaticBox(proxy, {
        x: piece.size * 0.5,
        y: piece.size * 0.32,
        z: piece.size * 0.45,
      })
    })
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
  })

  return group
}

/**
 * `CylinderGeometry` e `RingGeometry` dão UV de 0 a 1, então a textura estica
 * conforme o raio. Aqui o UV volta pra metros usando o próprio raio da peça.
 */
function scaleUvFromWorld(geometry: Parameters<typeof scaleUv>[0], radius: number, uvPerMeter: number): void {
  scaleUv(geometry, radius * 2 * uvPerMeter)
}
