import RAPIER from '@dimforge/rapier3d-compat'
import type { Object3D, Vector3 } from 'three/webgpu'

export type { RAPIER }

/** Camadas de colisão. Grupo nos 16 bits altos, máscara nos 16 baixos. */
export const LAYER = {
  world: 0x0001,
  player: 0x0002,
  enemy: 0x0004,
  hitbox: 0x0008,
} as const

export function membership(group: number, mask: number): number {
  return (group << 16) | mask
}

export class Physics {
  readonly world: RAPIER.World
  readonly api = RAPIER
  private readonly bodies: Array<{ body: RAPIER.RigidBody; object: Object3D }> = []
  private accumulator = 0

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -24, z: 0 })
    // Passo fixo. Combate previsível vale mais que suavidade aqui.
    this.world.timestep = 1 / 60
  }

  static async create(): Promise<Physics> {
    await RAPIER.init()
    return new Physics()
  }

  /** Caixa estática alinhada com um Object3D já posicionado na cena. */
  addStaticBox(object: Object3D, half: { x: number; y: number; z: number }): RAPIER.Collider {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        object.position.x,
        object.position.y,
        object.position.z,
      ).setRotation(object.quaternion),
    )
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setCollisionGroups(membership(LAYER.world, LAYER.player | LAYER.enemy)),
      body,
    )
    return collider
  }

  addStaticCylinder(position: Vector3, radius: number, halfHeight: number): RAPIER.Collider {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    )
    return this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius)
        .setCollisionGroups(membership(LAYER.world, LAYER.player | LAYER.enemy)),
      body,
    )
  }

  createCharacterController(offset = 0.05): RAPIER.KinematicCharacterController {
    const controller = this.world.createCharacterController(offset)
    controller.enableAutostep(0.45, 0.25, true)
    controller.enableSnapToGround(0.5)
    controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180)
    controller.setMinSlopeSlideAngle((38 * Math.PI) / 180)
    controller.setApplyImpulsesToDynamicBodies(true)
    return controller
  }

  /** Passo com acumulador, pra física não depender do fps. */
  step(dt: number): void {
    this.accumulator += dt
    let steps = 0
    while (this.accumulator >= this.world.timestep && steps < 4) {
      this.world.step()
      this.accumulator -= this.world.timestep
      steps++
    }
    if (steps === 4) this.accumulator = 0
    for (const { body, object } of this.bodies) {
      const t = body.translation()
      const r = body.rotation()
      object.position.set(t.x, t.y, t.z)
      object.quaternion.set(r.x, r.y, r.z, r.w)
    }
  }
}
