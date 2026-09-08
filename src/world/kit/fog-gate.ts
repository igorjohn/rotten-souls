import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector3,
} from 'three/webgpu'
import {
  Fn,
  float,
  mix,
  mx_noise_float,
  oneMinus,
  positionWorld,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import { LAYOUT, ringPosition } from '../layout'
import type { Materials } from '../materials'
import { box, gothicBay } from './geometry'
import { uvScale } from '../materials'

function createGateControls() {
  return {
    /** 0 fecha o portão, 1 abre. A cutscene do M5 vai animar isso. */
    opacity: uniform(0.66),
    brightness: uniform(0.72),
  }
}

export type GateControls = ReturnType<typeof createGateControls>

export interface FogGate {
  root: Group
  controls: GateControls
  /** Ponto no mundo onde o portão fica, pro gatilho de entrada na arena. */
  position: Vector3
}

/**
 * Portão de névoa: o arco de pedra da entrada mais uma parede de névoa
 * luminosa dentro dele. A névoa é uma malha de nós, com ruído em três dimensões
 * amarrado à posição de mundo, então ela não escorrega quando a câmera anda.
 */
export function buildFogGate(materials: Materials): FogGate {
  const root = new Group()
  root.name = 'fog-gate'
  const controls = createGateControls()

  const angle = LAYOUT.entranceAngle
  const radius = LAYOUT.arcadeRadius + LAYOUT.arcadeDepth / 2
  const { x, z } = ringPosition(angle, radius)
  const step = (Math.PI * 2) / LAYOUT.bayCount
  const width = 2 * Math.sin(step / 2) * radius + 0.1
  const opening = LAYOUT.bayOpening
  const spring = LAYOUT.baySpring

  // O arco da entrada é o mesmo vão da arcada, pra leitura do anel não quebrar.
  const frame = new Mesh(
    gothicBay({
      width,
      height: LAYOUT.arcadeHeight,
      depth: LAYOUT.arcadeDepth * 1.6,
      openingWidth: opening,
      springHeight: spring,
      uvPerMeter: uvScale('muro'),
    }),
    materials.muro,
  )
  frame.position.set(x, 0, z)
  frame.rotation.y = -angle + Math.PI / 2
  frame.castShadow = true
  frame.receiveShadow = true
  root.add(frame)

  // Ombreiras de pedra dos dois lados, marcando a entrada.
  for (const side of [-1, 1]) {
    const jamb = new Mesh(box(0.9, LAYOUT.arcadeHeight + 1.6, 1.9, uvScale('degrau')), materials.degrau)
    const tangent = new Vector3(-Math.sin(angle), 0, Math.cos(angle))
    jamb.position.set(
      x + tangent.x * side * (opening / 2 + 0.55),
      (LAYOUT.arcadeHeight + 1.6) / 2,
      z + tangent.z * side * (opening / 2 + 0.55),
    )
    jamb.rotation.y = -angle + Math.PI / 2
    jamb.castShadow = true
    jamb.receiveShadow = true
    root.add(jamb)
  }

  const apex = spring + Math.sqrt(opening * opening - (opening / 2) * (opening / 2))
  const fog = new Mesh(
    new PlaneGeometry(opening * 0.98, apex * 0.99),
    buildFogMaterial(controls, opening, apex),
  )
  fog.position.set(x, (apex * 0.99) / 2, z)
  fog.rotation.y = -angle + Math.PI / 2
  fog.renderOrder = 4
  fog.name = 'fog-wall'
  root.add(fog)

  return { root, controls, position: new Vector3(x, 1.6, z) }
}

function buildFogMaterial(controls: GateControls, opening: number, apex: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  })

  material.colorNode = Fn(() => {
    const coord = uv()

    // Recorte no formato do arco: cheio embaixo, afinando na ponta.
    const y = coord.y
    const springRatio = float(1).sub(apex === 0 ? 0 : (apex - opening * 0.5) / apex)
    const taper = smoothstep(float(1), springRatio, y).mul(0.5).add(0.5)
    const dx = coord.x.sub(0.5).abs().div(0.5)
    const shape = smoothstep(taper, taper.mul(0.55), dx)

    // Névoa que rola devagar. O ruído usa posição de mundo, então ela fica
    // parada no lugar mesmo com a câmera andando.
    const drift = time.mul(0.16)
    const noiseA = mx_noise_float(
      vec3(positionWorld.x.mul(1.6), positionWorld.y.mul(1.1).sub(drift), positionWorld.z.mul(1.6)),
    )
    const noiseB = mx_noise_float(
      vec3(positionWorld.x.mul(3.7), positionWorld.y.mul(2.4).sub(drift.mul(1.8)), positionWorld.z.mul(3.7)),
    )
    // Contraste alto de proposito: a nevoa tem que ter buraco e nervura,
    // senao vira um vidro leitoso e o que esta atras aparece em faixas.
    const density = noiseA.mul(0.62).add(noiseB.mul(0.38)).mul(0.72).add(0.55)

    // Mais denso nas bordas do vão, como cortina presa na pedra.
    const edges = smoothstep(float(0.2), float(0.85), dx).mul(0.35).add(0.85)
    const base = shape.mul(density).mul(edges)

    // Some no topo, senão o retângulo aparece.
    const fade = oneMinus(smoothstep(float(0.82), float(1), y))
    const alpha = base.mul(fade).mul(controls.opacity).clamp(0, 1)

    const cold = vec3(0.62, 0.72, 0.86)
    const warm = vec3(0.95, 0.96, 0.98)
    const tint = mix(cold, warm, density.clamp(0, 1))
    return vec4(tint.mul(controls.brightness), alpha)
  })()

  return material
}
