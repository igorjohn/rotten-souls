import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SpriteNodeMaterial,
  Vector3,
} from 'three/webgpu'
import {
  Fn,
  attribute,
  float,
  fract,
  instanceIndex,
  mix,
  mx_noise_float,
  oneMinus,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

const FIRE_CORE = new Color('#ffd17a')
const FIRE_EDGE = new Color('#ff8a2a')
const CORE = vec3(FIRE_CORE.r, FIRE_CORE.g, FIRE_CORE.b)
const EDGE = vec3(FIRE_EDGE.r, FIRE_EDGE.g, FIRE_EDGE.b)

/**
 * `attribute()` devolve um no de tipo generico e a tipagem do Three perde o
 * formato. Estes dois ajudantes so recolocam o tipo declarado no proprio
 * atributo, nao mudam nada em tempo de execucao.
 */
const vec3Attribute = (name: string) =>
  attribute(name, 'vec3') as unknown as ReturnType<typeof vec3>
const floatAttribute = (name: string) =>
  attribute(name, 'float') as unknown as ReturnType<typeof float>

const SPARKS_PER_BRAZIER = 10
const SPARK_LIFETIME = 2.1

function createFlameControls() {
  return {
    flameBrightness: uniform(2.6),
    sparkBrightness: uniform(2.2),
  }
}

export type FlameControls = ReturnType<typeof createFlameControls>

export interface BrazierFx {
  root: Group
  controls: FlameControls
}

/**
 * Fogo dos braseiros, inteiro na GPU: duas chamadas de desenho pra chama e pras
 * faíscas de todos os braseiros juntos.
 *
 * Um detalhe que custou caro: `SpriteNodeMaterial` num `InstancedMesh` ignora a
 * matriz de instância, porque o sprite se orienta pra câmera em espaço de visão
 * e não passa pela transformação de instância. Todas as chamas empilhavam na
 * origem do mundo. Por isso a posição de cada sprite vem de um atributo de
 * instância lido pelo `positionNode`, e não da matriz.
 */
export function buildBrazierFx(positions: Vector3[]): BrazierFx {
  const root = new Group()
  root.name = 'brazier-fx'
  const controls = createFlameControls()

  root.add(buildBowls(positions))
  root.add(buildFlames(positions, controls))
  root.add(buildSparks(positions, controls))

  return { root, controls }
}

/** Bacia de ferro provisória. Vira peça do kit no M3. */
function buildBowls(positions: Vector3[]): Object3D {
  const material = new MeshStandardNodeMaterial({
    color: new Color('#26221e'),
    roughness: 0.82,
    metalness: 0.55,
  })

  const group = new Group()
  const bowls = new InstancedMesh(new CylinderGeometry(0.42, 0.26, 0.46, 10), material, positions.length)
  const posts = new InstancedMesh(new CylinderGeometry(0.11, 0.13, 1.1, 8), material, positions.length)
  bowls.castShadow = true
  posts.castShadow = true

  const matrix = new Matrix4()
  const scale = new Vector3(1, 1, 1)
  const rotation = new Quaternion()
  positions.forEach((position, index) => {
    matrix.compose(position, rotation, scale)
    bowls.setMatrixAt(index, matrix)
    matrix.compose(new Vector3(position.x, position.y - 0.78, position.z), rotation, scale)
    posts.setMatrixAt(index, matrix)
  })
  bowls.instanceMatrix.needsUpdate = true
  posts.instanceMatrix.needsUpdate = true
  group.add(bowls, posts)
  return group
}

/** Plano com a origem na base, pra chama crescer pra cima a partir da bacia. */
function upwardQuad(): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1)
  geometry.translate(0, 0.5, 0)
  return geometry
}

function buildFlames(positions: Vector3[], controls: FlameControls): Object3D {
  // Duas línguas por braseiro, com fase e tamanho diferentes, dá volume.
  const count = positions.length * 2
  const origins = new Float32Array(count * 3)
  positions.forEach((position, index) => {
    for (let layer = 0; layer < 2; layer++) {
      const slot = (index * 2 + layer) * 3
      origins[slot] = position.x
      origins[slot + 1] = position.y + 0.12
      origins[slot + 2] = position.z
    }
  })

  const geometry = upwardQuad()
  geometry.setAttribute('flameOrigin', new InstancedBufferAttribute(origins, 3))

  const material = new SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })

  const secondLayer = float(instanceIndex).mod(2)
  material.positionNode = vec3Attribute('flameOrigin')
  material.scaleNode = mix(vec2(0.68, 1.3), vec2(0.46, 0.86), secondLayer)

  material.colorNode = Fn(() => {
    const coord = uv()
    const y = coord.y
    const phase = float(instanceIndex).mul(2.399)
    const t = time.mul(1.35).add(phase)

    // Turbulência que sobe junto com a chama.
    const noise = mx_noise_float(vec3(coord.x.mul(3.4), y.mul(2.6).sub(t), phase))
    const wobble = noise.mul(0.24).mul(y)

    // Forma de gota: larga na base, fina na ponta.
    const taper = oneMinus(y).pow(0.72)
    const dx = coord.x.sub(0.5).add(wobble).abs()
    const radius = taper.mul(0.34).add(0.015)

    const body = smoothstep(radius, radius.mul(0.2), dx)
    const top = smoothstep(float(1), float(0.68), y)
    const bottom = smoothstep(float(0), float(0.06), y)
    const mask = body.mul(top).mul(bottom)

    // Núcleo claro embaixo, borda laranja em cima.
    const heat = oneMinus(y).pow(1.5)
    const tint = mix(EDGE, CORE, heat)
    const flicker = sin(time.mul(9.3).add(phase)).mul(0.09).add(sin(time.mul(3.1).add(phase)).mul(0.07)).add(0.94)

    return vec4(tint.mul(controls.flameBrightness).mul(flicker), mask.mul(flicker))
  })()

  const mesh = new InstancedMesh(geometry, material, count)
  mesh.name = 'flames'
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  return mesh
}

function buildSparks(positions: Vector3[], controls: FlameControls): Object3D {
  const count = positions.length * SPARKS_PER_BRAZIER
  const origins = new Float32Array(count * 3)
  const drifts = new Float32Array(count * 3)
  const offsets = new Float32Array(count)

  let slot = 0
  for (const position of positions) {
    for (let s = 0; s < SPARKS_PER_BRAZIER; s++) {
      origins[slot * 3] = position.x
      origins[slot * 3 + 1] = position.y + 0.28
      origins[slot * 3 + 2] = position.z
      const angle = Math.random() * Math.PI * 2
      const speed = 0.2 + Math.random() * 0.42
      drifts[slot * 3] = Math.cos(angle) * speed
      drifts[slot * 3 + 1] = 1.05 + Math.random() * 1.5
      drifts[slot * 3 + 2] = Math.sin(angle) * speed
      offsets[slot] = Math.random()
      slot++
    }
  }

  const geometry = new PlaneGeometry(1, 1)
  geometry.setAttribute('sparkOrigin', new InstancedBufferAttribute(origins, 3))
  geometry.setAttribute('sparkDrift', new InstancedBufferAttribute(drifts, 3))
  geometry.setAttribute('sparkOffset', new InstancedBufferAttribute(offsets, 1))

  const material = new SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })

  // Vida da faísca resolvida no vértice: sem trabalho de CPU por frame.
  const life = fract(time.div(SPARK_LIFETIME).add(floatAttribute('sparkOffset')))
  const age = life.mul(SPARK_LIFETIME)
  const drift = vec3Attribute('sparkDrift')
  // Sobe e vai perdendo força, então desacelera no fim.
  const rise = drift.mul(age).sub(vec3(0, age.mul(age).mul(0.3), 0))
  material.positionNode = vec3Attribute('sparkOrigin').add(rise)

  // Nasce pequena, cresce num instante e apaga.
  const size = sin(life.min(1).mul(Math.PI)).mul(0.05)
  material.scaleNode = vec2(size, size)

  material.colorNode = Fn(() => {
    const coord = uv().sub(vec2(0.5, 0.5))
    const core = smoothstep(float(0.5), float(0.03), coord.length())
    const tint = mix(EDGE, CORE, core)
    return vec4(tint.mul(controls.sparkBrightness), core)
  })()

  const mesh = new InstancedMesh(geometry, material, count)
  mesh.name = 'sparks'
  mesh.frustumCulled = false
  mesh.renderOrder = 3
  return mesh
}
