// Reproducao isolada: capsula do jogador subindo a escadaria da arena,
// com exatamente a mesma config de controlador e a mesma logica de character.ts.
import RAPIER from '@dimforge/rapier3d-compat'
await RAPIER.init()

const DT = 1 / 60
const GRAVITY = -26
const GROUND_STICK = 0.05
const UNSTICK_LIFT = 0.04
const HEIGHT = 1.85
const RADIUS = 0.36
const STEPS = 9
const STEP_H = 3.4 / 9
const STEP_D = 0.95
const LARGURA = 7

function cena() {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  world.timestep = DT

  // Chao.
  const chao = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0))
  world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30), chao)

  // Degraus: bloco macico do chao ate o proprio topo, como em arena.ts.
  for (let i = 0; i < STEPS; i++) {
    const z = 2 + i * STEP_D
    const top = (i + 1) * STEP_H
    const corpo = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, top / 2, z))
    world.createCollider(RAPIER.ColliderDesc.cuboid(LARGURA / 2, top / 2, STEP_D / 2), corpo)
  }
  return world
}

function controlador(world, autostep) {
  const c = world.createCharacterController(0.05)
  if (autostep) c.enableAutostep(autostep.h, autostep.w, true)
  c.enableSnapToGround(0.5)
  c.setMaxSlopeClimbAngle((52 * Math.PI) / 180)
  c.setMinSlopeSlideAngle((38 * Math.PI) / 180)
  c.setApplyImpulsesToDynamicBodies(true)
  return c
}

function correr({ velocidade, groundStick, autostep = { h: 0.45, w: 0.25 }, passos = 420, descendo = false }) {
  const world = cena()
  const halfHeight = HEIGHT / 2 - RADIUS
  const partida = descendo
    ? { y: 3.4 + HEIGHT / 2, z: 2 + STEPS * STEP_D - 0.3 }
    : { y: HEIGHT / 2, z: 0 }
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, partida.y, partida.z),
  )
  const col = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, RADIUS), body)
  const ctrl = controlador(world, autostep)

  let grounded = false
  let stuck = false
  let vy = 0
  let maiorY = 0
  let menorY = 99
  const sentido = descendo ? -1 : 1

  for (let i = 0; i < passos; i++) {
    let desired
    if (grounded) {
      vy = 0
      desired = { x: 0, y: stuck ? UNSTICK_LIFT : -groundStick, z: sentido * velocidade * DT }
    } else {
      vy += GRAVITY * DT
      desired = { x: 0, y: vy * DT, z: sentido * velocidade * DT }
    }

    ctrl.computeColliderMovement(col, desired)
    const m = ctrl.computedMovement()
    grounded = ctrl.computedGrounded()
    if (grounded && vy < 0) vy = 0

    const quis = Math.hypot(desired.x, desired.z)
    const veio = Math.hypot(m.x, m.z)
    stuck = quis > 1e-4 && veio < quis * 0.02

    const t = body.translation()
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z }
    body.setNextKinematicTranslation(next)
    world.step()
    const pes = body.translation().y - HEIGHT / 2
    maiorY = Math.max(maiorY, pes)
    menorY = Math.min(menorY, pes)
  }
  const t = body.translation()
  return { pes: t.y - HEIGHT / 2, z: t.z, maiorY, menorY }
}

// Antes: 5 cm fixos por tick. Depois: velocidade de 0,6 m/s escalada por dt.
const ANTES = 0.05
const DEPOIS = 0.6 * DT

const casos = [
  ['andando 2.6, stick antigo', { velocidade: 2.6, groundStick: ANTES }],
  ['correndo 5.6, stick antigo', { velocidade: 5.6, groundStick: ANTES, passos: 200 }],
  ['esquiva 13.5, stick antigo', { velocidade: 13.5, groundStick: ANTES, passos: 90 }],
  ['andando 2.6, stick novo', { velocidade: 2.6, groundStick: DEPOIS }],
  ['correndo 5.6, stick novo', { velocidade: 5.6, groundStick: DEPOIS, passos: 200 }],
  ['esquiva 13.5, stick novo', { velocidade: 13.5, groundStick: DEPOIS, passos: 90 }],
  ['de re 2.6, stick novo', { velocidade: 2.6, groundStick: DEPOIS }],
]

console.log('alvo: pes chegam a y = 3.4 (patamar)\n')
for (const [nome, cfg] of casos) {
  const r = correr(cfg)
  const ok = r.maiorY > 3.2 ? 'SOBIU ' : 'TRAVOU'
  console.log(`${nome.padEnd(32)} ${ok}  maiorY=${r.maiorY.toFixed(3)}  z=${r.z.toFixed(2)}`)
}

console.log('\ndescida (pes devem sair de 3.4 e chegar a 0, sem quicar):')
for (const stick of [ANTES, DEPOIS]) {
  const r = correr({ velocidade: 2.6, groundStick: stick, descendo: true, passos: 300 })
  console.log(`  stick ${stick.toFixed(3)}  pes finais=${r.pes.toFixed(3)}  menorY=${r.menorY.toFixed(3)}  z=${r.z.toFixed(2)}`)
}
