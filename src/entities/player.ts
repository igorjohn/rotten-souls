import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  Vector2,
  Vector3,
} from 'three/webgpu'
import { Character } from './character'
import { LAYER, type Physics } from '../core/physics'
import type { Input } from '../core/input'
import type { CameraRig } from './camera-rig'
import { PLAYER_SPAWN, SPAWN_FACING } from '../world/layout'

export type PlayerState = 'idle' | 'walk' | 'run' | 'dodge'

const HEIGHT = 1.85
const RADIUS = 0.36

const WALK_SPEED = 2.6
const RUN_SPEED = 5.6
const STRAFE_WALK = 2.9
const STRAFE_RUN = 4.9

const ACCEL_GROUND = 26
const TURN_FREE = 14
const TURN_LOCKED = 16

const DODGE_TIME = 0.62
const DODGE_PEAK = 11.5
const DODGE_COST = 25
const IFRAME_START = 0.06
const IFRAME_END = 0.42

const RUN_DRAIN = 12
const STAMINA_REGEN = 26
const REGEN_DELAY = 0.55
const SPENT_DELAY = 1.2

const LOCK_RANGE = 26

export class Player {
  readonly character: Character
  state: PlayerState = 'idle'
  lockTarget: Object3D | null = null

  private readonly velocity = new Vector3()
  private readonly wish = new Vector3()
  private readonly forward = new Vector3()
  private readonly right = new Vector3()
  private readonly lookDelta = new Vector2()
  private readonly dodgeDirection = new Vector3()
  private dodgeTime = 0
  private regenTimer = 0
  private staminaSpent = false

  constructor(
    physics: Physics,
    private readonly input: Input,
    private readonly rig: CameraRig,
  ) {
    this.character = new Character(physics, {
      radius: RADIUS,
      height: HEIGHT,
      layer: LAYER.player,
      mask: LAYER.enemy | LAYER.hitbox,
      position: PLAYER_SPAWN,
      maxHealth: 100,
      maxStamina: 100,
    })
    this.character.snapTo(SPAWN_FACING)
    this.character.object.add(buildGrayBox())
    this.character.object.name = 'player'
  }

  get object(): Object3D {
    return this.character.object
  }

  get height(): number {
    return HEIGHT
  }

  /** Verdadeiro na janela de invencibilidade da esquiva. */
  get invulnerable(): boolean {
    return this.state === 'dodge' && this.dodgeTime > IFRAME_START && this.dodgeTime < IFRAME_END
  }

  get staminaRatio(): number {
    return this.character.stamina / this.character.maxStamina
  }

  get healthRatio(): number {
    return this.character.health / this.character.maxHealth
  }

  get exhausted(): boolean {
    return this.staminaSpent
  }

  respawn(): void {
    this.character.teleport(PLAYER_SPAWN)
    this.character.snapTo(SPAWN_FACING)
    this.character.health = this.character.maxHealth
    this.character.stamina = this.character.maxStamina
    this.state = 'idle'
    this.dodgeTime = 0
    this.velocity.set(0, 0, 0)
    this.lockTarget = null
    this.rig.yaw = SPAWN_FACING
    this.rig.pitch = 0.14
  }

  /** Alterna o lock-on entre o alvo mais próximo à frente e nenhum. */
  toggleLock(candidates: Object3D[]): void {
    if (this.lockTarget) {
      this.lockTarget = null
      return
    }
    const origin = this.character.center
    let best: Object3D | null = null
    let bestScore = Infinity
    this.rig.getForward(this.forward)
    for (const candidate of candidates) {
      const dx = candidate.position.x - origin.x
      const dz = candidate.position.z - origin.z
      const distance = Math.hypot(dx, dz)
      if (distance > LOCK_RANGE) continue
      const dot = (dx / distance) * this.forward.x + (dz / distance) * this.forward.z
      if (dot < -0.2) continue
      // Perto e à frente ganha. O peso do ângulo evita travar em algo lateral.
      const score = distance * (1.6 - dot)
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }
    this.lockTarget = best
  }

  update(dt: number): void {
    this.input.consumeLook(this.lookDelta)
    if (!this.lockTarget) this.rig.addLook(this.lookDelta)

    this.readWish()
    this.updateStamina(dt)

    if (this.state === 'dodge') this.updateDodge(dt)
    else this.updateGround(dt)

    this.character.step(dt, this.velocity)
  }

  /** Chamado depois do passo de física, com o corpo já na posição final. */
  postStep(): void {
    this.character.syncObject()
  }

  private readWish(): void {
    this.rig.getForward(this.forward)
    this.rig.getRight(this.right)
    this.wish
      .set(0, 0, 0)
      .addScaledVector(this.forward, this.input.move.y)
      .addScaledVector(this.right, this.input.move.x)
    if (this.wish.lengthSq() > 1) this.wish.normalize()
  }

  private updateStamina(dt: number): void {
    if (this.regenTimer > 0) {
      this.regenTimer -= dt
      return
    }
    this.character.regenStamina(dt, STAMINA_REGEN)
    if (this.staminaSpent && this.character.stamina > this.character.maxStamina * 0.3) {
      this.staminaSpent = false
    }
  }

  private spend(amount: number): boolean {
    if (this.character.stamina <= 0) return false
    this.character.stamina = Math.max(0, this.character.stamina - amount)
    this.regenTimer = this.character.stamina <= 0 ? SPENT_DELAY : REGEN_DELAY
    if (this.character.stamina <= 0) this.staminaSpent = true
    return true
  }

  private updateGround(dt: number): void {
    if (this.input.consume('dodge') && this.character.grounded && this.spend(DODGE_COST)) {
      this.startDodge()
      return
    }

    const moving = this.wish.lengthSq() > 0.0001
    const wantsRun = this.input.running && moving && !this.staminaSpent
    const running = wantsRun && this.character.stamina > 0

    if (running) {
      this.character.stamina = Math.max(0, this.character.stamina - RUN_DRAIN * dt)
      this.regenTimer = REGEN_DELAY
      if (this.character.stamina <= 0) this.staminaSpent = true
    }

    let speed: number
    if (!moving) speed = 0
    else if (this.lockTarget) speed = running ? STRAFE_RUN : STRAFE_WALK
    else speed = running ? RUN_SPEED : WALK_SPEED

    const targetX = this.wish.x * speed
    const targetZ = this.wish.z * speed
    const blend = Math.min(1, ACCEL_GROUND * dt)
    this.velocity.x += (targetX - this.velocity.x) * blend
    this.velocity.z += (targetZ - this.velocity.z) * blend

    if (this.lockTarget) {
      const dx = this.lockTarget.position.x - this.character.object.position.x
      const dz = this.lockTarget.position.z - this.character.object.position.z
      this.character.turnTo(Math.atan2(dx, dz), dt, TURN_LOCKED)
    } else if (moving) {
      this.character.turnTo(Math.atan2(this.wish.x, this.wish.z), dt, TURN_FREE)
    }

    if (!moving) this.state = 'idle'
    else this.state = running ? 'run' : 'walk'
  }

  private startDodge(): void {
    this.state = 'dodge'
    this.dodgeTime = 0
    if (this.wish.lengthSq() > 0.0001) {
      this.dodgeDirection.copy(this.wish).normalize()
    } else {
      // Sem direção é passo pra trás, como em Souls.
      this.dodgeDirection.set(
        -Math.sin(this.character.facing),
        0,
        -Math.cos(this.character.facing),
      )
    }
    this.character.snapTo(Math.atan2(this.dodgeDirection.x, this.dodgeDirection.z))
  }

  private updateDodge(dt: number): void {
    this.dodgeTime += dt
    const t = Math.min(1, this.dodgeTime / DODGE_TIME)
    // Sai rápido e desacelera, que é o que dá peso ao rolamento.
    const speed = DODGE_PEAK * (1 - t) * (1 - t * 0.35)
    this.velocity.x = this.dodgeDirection.x * speed
    this.velocity.z = this.dodgeDirection.z * speed

    if (this.dodgeTime >= DODGE_TIME) {
      this.state = 'idle'
      this.dodgeTime = 0
      this.input.clearBuffer()
    }
  }
}

/** Boneco provisório do M1. Sai quando entrar o personagem CC0 riggado. */
function buildGrayBox(): Object3D {
  const root = new Object3D()
  const material = new MeshStandardNodeMaterial({
    color: new Color('#8d8579'),
    roughness: 0.75,
    metalness: 0.05,
  })

  const body = new Mesh(new CapsuleGeometry(RADIUS, HEIGHT - RADIUS * 2, 6, 12), material)
  body.position.y = HEIGHT / 2
  body.castShadow = true
  root.add(body)

  // Marcador de frente, senão não dá pra ler pra onde a cápsula está virada.
  const nose = new Mesh(
    new BoxGeometry(0.18, 0.18, 0.34),
    new MeshStandardNodeMaterial({ color: new Color('#c9bda3'), roughness: 0.6 }),
  )
  nose.position.set(0, HEIGHT * 0.82, RADIUS + 0.1)
  nose.castShadow = true
  root.add(nose)

  // Montante provisório, só pra silhueta não ser um comprimido.
  const sword = new Mesh(
    new BoxGeometry(0.1, 1.75, 0.26),
    new MeshStandardNodeMaterial({ color: new Color('#5c6066'), roughness: 0.45, metalness: 0.6 }),
  )
  sword.position.set(-0.42, HEIGHT * 0.62, -0.14)
  sword.rotation.set(0.32, 0, 0.24)
  sword.castShadow = true
  root.add(sword)

  return root
}
