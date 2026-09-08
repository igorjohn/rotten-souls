import { Object3D, Vector2, Vector3 } from 'three/webgpu'
import { Character } from './character'
import { LAYER, type Physics } from '../core/physics'
import type { Input } from '../core/input'
import type { CameraRig } from './camera-rig'
import { PLAYER_SPAWN, SPAWN_FACING } from '../world/layout'
import type { Rig } from './anim/rig'
import { AttackRun, PLAYER_ATTACKS, sweepHit, type AttackDef, type Damageable } from './combat'

export type PlayerState = 'idle' | 'walk' | 'run' | 'dodge' | 'attack' | 'hit' | 'dead'

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

const HIT_STAGGER = 0.42
const HIT_IFRAMES = 0.3
const LOCK_RANGE = 26

const CLIPS = {
  idle: 'Sword_Idle',
  walk: 'Walk_Loop',
  run: 'Sprint_Loop',
  dodge: 'Roll',
  hit: 'Hit_Chest',
  death: 'Death01',
} as const

export class Player implements Damageable {
  readonly character: Character
  state: PlayerState = 'idle'
  lockTarget: Object3D | null = null
  /** Alvo do golpe. Quem monta a cena liga isso no chefe. */
  enemy: Damageable | null = null
  /** Chamado quando a vida chega a zero. */
  onDeath: (() => void) | null = null

  private rig: Rig | null = null
  private readonly velocity = new Vector3()
  private readonly wish = new Vector3()
  private readonly forward = new Vector3()
  private readonly right = new Vector3()
  private readonly lookDelta = new Vector2()
  private readonly dodgeDirection = new Vector3()
  private readonly center = new Vector3()
  private dodgeTime = 0
  private regenTimer = 0
  private staminaSpent = false
  private attack: AttackRun | null = null
  private attackTime = 0
  private recovery = 0
  private stagger = 0
  private iframeTimer = 0

  constructor(
    physics: Physics,
    private readonly input: Input,
    private readonly rigCamera: CameraRig,
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
    this.character.object.name = 'player'
  }

  /** Liga o corpo animado. Sem ele o jogador ainda funciona, só não aparece. */
  attachRig(rig: Rig): void {
    this.rig = rig
    this.character.object.add(rig.root)
    rig.play(CLIPS.idle)
  }

  get object(): Object3D {
    return this.character.object
  }

  get height(): number {
    return HEIGHT
  }

  get hitCenter(): Vector3 {
    return this.center.copy(this.character.object.position).setY(
      this.character.object.position.y + HEIGHT * 0.5,
    )
  }

  get hitRadius(): number {
    return RADIUS + 0.12
  }

  get alive(): boolean {
    return this.character.health > 0
  }

  /** Invencível na janela da esquiva e no piscar depois de levar dano. */
  get invulnerable(): boolean {
    if (this.iframeTimer > 0) return true
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
    this.attack = null
    this.recovery = 0
    this.stagger = 0
    this.iframeTimer = 0
    this.velocity.set(0, 0, 0)
    this.lockTarget = null
    this.rigCamera.yaw = SPAWN_FACING
    this.rigCamera.pitch = 0.14
    this.input.clearBuffer()
    this.rig?.play(CLIPS.idle, { restart: true, fade: 0 })
  }

  takeHit(damage: number, from: Vector3): void {
    if (!this.alive || this.invulnerable) return
    this.character.damage(damage)
    this.iframeTimer = HIT_IFRAMES
    this.attack = null

    if (!this.alive) {
      this.state = 'dead'
      this.velocity.set(0, 0, 0)
      this.rig?.play(CLIPS.death, { once: true, fade: 0.12 })
      this.onDeath?.()
      return
    }

    this.state = 'hit'
    this.stagger = HIT_STAGGER
    // Empurrão curto pra trás, na direção de quem bateu.
    this.velocity.set(
      this.character.object.position.x - from.x,
      0,
      this.character.object.position.z - from.z,
    )
    if (this.velocity.lengthSq() > 0.0001) this.velocity.normalize().multiplyScalar(3.2)
    this.rig?.play(CLIPS.hit, { once: true, fade: 0.08, restart: true })
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
    this.rigCamera.getForward(this.forward)
    for (const candidate of candidates) {
      const dx = candidate.position.x - origin.x
      const dz = candidate.position.z - origin.z
      const distance = Math.hypot(dx, dz)
      if (distance > LOCK_RANGE || distance < 0.001) continue
      const dot = (dx / distance) * this.forward.x + (dz / distance) * this.forward.z
      if (dot < -0.2) continue
      const score = distance * (1.6 - dot)
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }
    this.lockTarget = best
  }

  /** Roda uma vez por passo fixo da física. */
  update(dt: number): void {
    this.input.consumeLook(this.lookDelta)
    if (!this.lockTarget) this.rigCamera.addLook(this.lookDelta)
    if (this.iframeTimer > 0) this.iframeTimer -= dt

    this.readWish()
    this.updateStamina(dt)

    switch (this.state) {
      case 'dead':
        this.velocity.set(0, 0, 0)
        break
      case 'hit':
        this.updateStagger(dt)
        break
      case 'dodge':
        this.updateDodge(dt)
        break
      case 'attack':
        this.updateAttack(dt)
        break
      default:
        this.updateGround(dt)
    }

    this.character.step(dt, this.velocity)
  }

  /** Chamado depois do passo de física, com o corpo já na posição final. */
  postStep(): void {
    this.character.syncObject()
  }

  /** Roda uma vez por frame, fora do passo fixo. */
  updateAnimation(dt: number): void {
    this.rig?.update(dt)
  }

  private readWish(): void {
    this.rigCamera.getForward(this.forward)
    this.rigCamera.getRight(this.right)
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
    if (this.recovery > 0) this.recovery -= dt

    if (this.input.consume('dodge') && this.character.grounded && this.spend(DODGE_COST)) {
      this.startDodge()
      return
    }
    if (this.recovery <= 0) {
      if (this.input.consume('light') && this.spend(PLAYER_ATTACKS.light.stamina)) {
        this.startAttack(PLAYER_ATTACKS.light)
        return
      }
      if (this.input.consume('heavy') && this.spend(PLAYER_ATTACKS.heavy.stamina)) {
        this.startAttack(PLAYER_ATTACKS.heavy)
        return
      }
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

    const blend = Math.min(1, ACCEL_GROUND * dt)
    this.velocity.x += (this.wish.x * speed - this.velocity.x) * blend
    this.velocity.z += (this.wish.z * speed - this.velocity.z) * blend

    this.faceTarget(dt, moving)

    if (!moving) this.setState('idle', CLIPS.idle)
    else if (running) this.setState('run', CLIPS.run)
    else this.setState('walk', CLIPS.walk)
  }

  private faceTarget(dt: number, moving: boolean): void {
    if (this.lockTarget) {
      const dx = this.lockTarget.position.x - this.character.object.position.x
      const dz = this.lockTarget.position.z - this.character.object.position.z
      this.character.turnTo(Math.atan2(dx, dz), dt, TURN_LOCKED)
    } else if (moving) {
      this.character.turnTo(Math.atan2(this.wish.x, this.wish.z), dt, TURN_FREE)
    }
  }

  private setState(state: PlayerState, clip: string): void {
    if (this.state === state) return
    this.state = state
    this.rig?.play(clip)
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
    this.rig?.play(CLIPS.dodge, { once: true, fade: 0.08, restart: true, speed: 1 / DODGE_TIME })
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
      this.rig?.play(CLIPS.idle)
    }
  }

  private startAttack(def: AttackDef): void {
    this.state = 'attack'
    this.attack = new AttackRun(def)
    this.attackTime = 0
    // Vira pro alvo no instante do golpe, senão o ataque sai pro lado.
    if (this.lockTarget) {
      const dx = this.lockTarget.position.x - this.character.object.position.x
      const dz = this.lockTarget.position.z - this.character.object.position.z
      this.character.snapTo(Math.atan2(dx, dz))
    } else if (this.wish.lengthSq() > 0.0001) {
      this.character.snapTo(Math.atan2(this.wish.x, this.wish.z))
    }
    this.rig?.play(def.clip, { once: true, fade: 0.1, restart: true, speed: def.speed })
  }

  private updateAttack(dt: number): void {
    const run = this.attack
    if (!run) {
      this.state = 'idle'
      return
    }
    this.attackTime += dt
    const progress = this.rig ? this.rig.progress() : Math.min(1, this.attackTime * run.def.speed)

    // Avanço curto durante a janela, pra o golpe alcançar quem recua.
    const lunging = run.inWindow(progress)
    const speed = lunging ? run.def.lunge : 0
    const blend = Math.min(1, 18 * dt)
    this.velocity.x += (Math.sin(this.character.facing) * speed - this.velocity.x) * blend
    this.velocity.z += (Math.cos(this.character.facing) * speed - this.velocity.z) * blend

    if (lunging && !run.spent && this.enemy) {
      const hit = sweepHit(
        this.character.object.position,
        this.character.facing,
        HEIGHT,
        run.def,
        this.enemy,
      )
      if (hit) {
        run.markHit()
        this.enemy.takeHit(run.def.damage, this.character.object.position)
      }
    }

    if (progress >= 0.999) {
      this.attack = null
      this.recovery = run.def.recovery
      this.state = 'idle'
      this.rig?.play(CLIPS.idle, { fade: 0.16 })
    }
  }

  private updateStagger(dt: number): void {
    this.stagger -= dt
    const blend = Math.min(1, 9 * dt)
    this.velocity.x -= this.velocity.x * blend
    this.velocity.z -= this.velocity.z * blend
    if (this.stagger <= 0) {
      this.state = 'idle'
      this.rig?.play(CLIPS.idle, { fade: 0.14 })
    }
  }
}
