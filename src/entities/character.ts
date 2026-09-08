import { Group, Quaternion, Vector3 } from 'three/webgpu'
import type RAPIER from '@dimforge/rapier3d-compat'
import { LAYER, membership, type Physics } from '../core/physics'

export interface CharacterOptions {
  radius: number
  height: number
  layer: number
  mask: number
  position: { x: number; y: number; z: number }
  maxHealth: number
  maxStamina: number
}

const GRAVITY = -26
/**
 * Empurrao curto pra baixo a cada frame no chao, so pra manter contato. Nao usa
 * gravidade cheia de proposito: com dt grande o passo para baixo ficava fundo
 * demais, a capsula penetrava o colisor e o controlador do Rapier passava a
 * zerar todo o movimento horizontal.
 */
const GROUND_STICK = 0.05
/** Empurrao pra cima de um frame, usado so pra sair de uma penetracao. */
const UNSTICK_LIFT = 0.04
const UP = new Vector3(0, 1, 0)

/**
 * Base de qualquer coisa que anda: cápsula cinemática, vida, estamina e
 * orientação. Não sabe de renderer, de animação nem de combate.
 */
export class Character {
  readonly object = new Group()
  readonly velocity = new Vector3()
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  private readonly controller: RAPIER.KinematicCharacterController
  private readonly desired = new Vector3()
  private readonly quaternion = new Quaternion()

  grounded = false
  /** Verdadeiro quando o frame anterior nao conseguiu mover nada no plano. */
  private stuck = false
  health: number
  stamina: number
  facing = 0
  readonly maxHealth: number
  readonly maxStamina: number
  readonly radius: number
  readonly height: number

  constructor(
    private readonly physics: Physics,
    options: CharacterOptions,
  ) {
    this.radius = options.radius
    this.height = options.height
    this.maxHealth = options.maxHealth
    this.maxStamina = options.maxStamina
    this.health = options.maxHealth
    this.stamina = options.maxStamina

    const halfHeight = Math.max(0.01, options.height / 2 - options.radius)
    this.body = physics.world.createRigidBody(
      physics.api.RigidBodyDesc.kinematicPositionBased().setTranslation(
        options.position.x,
        options.position.y + options.height / 2,
        options.position.z,
      ),
    )
    this.collider = physics.world.createCollider(
      physics.api.ColliderDesc.capsule(halfHeight, options.radius).setCollisionGroups(
        membership(options.layer, options.mask | LAYER.world),
      ),
      this.body,
    )
    this.controller = physics.createCharacterController()
    this.syncObject()
  }

  /** Centro da cápsula em coordenadas de mundo. */
  get center(): Vector3 {
    const t = this.body.translation()
    return new Vector3(t.x, t.y, t.z)
  }

  /** Pé do personagem, que é onde o objeto visual fica. */
  get feet(): Vector3 {
    return this.center.setY(this.center.y - this.height / 2)
  }

  get alive(): boolean {
    return this.health > 0
  }

  teleport(position: { x: number; y: number; z: number }): void {
    this.body.setNextKinematicTranslation({
      x: position.x,
      y: position.y + this.height / 2,
      z: position.z,
    })
    this.body.setTranslation(
      { x: position.x, y: position.y + this.height / 2, z: position.z },
      true,
    )
    this.velocity.set(0, 0, 0)
    this.syncObject()
  }

  /**
   * Aplica gravidade, resolve colisão pela cápsula e agenda o próximo passo.
   * `horizontal` é a velocidade desejada no plano, em metros por segundo.
   */
  step(dt: number, horizontal: Vector3): void {
    this.velocity.x = horizontal.x
    this.velocity.z = horizontal.z

    if (this.grounded) {
      this.velocity.y = 0
      // Se o frame anterior detectou a capsula presa, um unico frame de
      // empurrao pra cima tira ela de dentro do colisor. Fora isso, contato.
      const vertical = this.stuck ? UNSTICK_LIFT : -GROUND_STICK
      this.desired.set(this.velocity.x * dt, vertical, this.velocity.z * dt)
    } else {
      this.velocity.y += GRAVITY * dt
      this.desired.copy(this.velocity).multiplyScalar(dt)
    }

    this.controller.computeColliderMovement(this.collider, this.desired)
    const corrected = this.controller.computedMovement()
    this.grounded = this.controller.computedGrounded()
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0

    // Diagnostico de capsula presa: pediu movimento no plano e nao veio nada.
    // Nao vale pra quem esta encostado numa parede, porque ai o Rapier devolve
    // o deslizamento tangente, que continua sendo movimento.
    const wanted = Math.hypot(this.desired.x, this.desired.z)
    const got = Math.hypot(corrected.x, corrected.z)
    this.stuck = wanted > 1e-4 && got < wanted * 0.02

    const t = this.body.translation()
    this.body.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y,
      z: t.z + corrected.z,
    })
  }

  /** Gira suavemente pro ângulo alvo, em radianos, no eixo Y. */
  turnTo(angle: number, dt: number, speed = 12): void {
    let delta = angle - this.facing
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    this.facing += delta * Math.min(1, speed * dt)
  }

  snapTo(angle: number): void {
    this.facing = angle
  }

  syncObject(): void {
    const t = this.body.translation()
    this.object.position.set(t.x, t.y - this.height / 2, t.z)
    this.quaternion.setFromAxisAngle(UP, this.facing)
    this.object.quaternion.copy(this.quaternion)
  }

  spendStamina(amount: number): boolean {
    if (this.stamina < amount) return false
    this.stamina -= amount
    return true
  }

  regenStamina(dt: number, rate: number): void {
    this.stamina = Math.min(this.maxStamina, this.stamina + rate * dt)
  }

  damage(amount: number): void {
    this.health = Math.max(0, this.health - amount)
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller)
    this.physics.world.removeRigidBody(this.body)
  }
}
