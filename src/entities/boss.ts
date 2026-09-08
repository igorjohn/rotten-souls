import { Object3D, Vector3 } from 'three/webgpu'
import { Character } from './character'
import { LAYER, type Physics } from '../core/physics'
import { LAYOUT } from '../world/layout'
import type { Rig } from './anim/rig'
import { AttackRun, BOSS_ATTACKS, sweepHit, type AttackDef, type Damageable } from './combat'

export type BossState = 'dormant' | 'idle' | 'approach' | 'attack' | 'hit' | 'roar' | 'dead'

export const BOSS_NAME = 'Vharen, Vigília das Ruínas'

/** 2,5 vezes o jogador, como manda a seção 3 do briefing. */
const HEIGHT = 4.62
const RADIUS = 1.05
/**
 * Calibrado pra luta durar. Golpe leve tira 17 e pesado 34, então dá por volta
 * de 18 a 20 golpes bem colocados, contando os dois. Mais que isso vira
 * repetição, menos que isso o chefe não chega na segunda fase.
 */
const MAX_HEALTH = 420

const WALK_SPEED = 2.4
const CHARGE_SPEED = 4.6
const TURN_SPEED = 3.4
const TURN_SPEED_ATTACKING = 1.1

/** Distância em que ele começa a atacar em vez de andar. */
const STRIKE_RANGE = 5.2
const THRUST_RANGE = 9.5

const HIT_STAGGER = 0.32
/** Quanto dano acumulado ele aguenta antes de cambalear. */
const POISE = 62

const CLIPS = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  charge: 'Jog_Fwd_Loop',
  hit: 'Hit_Chest',
  death: 'Death01',
  roar: 'Interact',
} as const

interface Phase {
  /** Multiplicador de velocidade dos clipes de ataque. */
  speed: number
  /** Multiplicador de dano. */
  damage: number
  /** Intervalo entre golpes, em segundos. */
  cooldown: [number, number]
  /** Chance de emendar um segundo golpe logo depois. */
  comboChance: number
}

const PHASES: [Phase, Phase] = [
  { speed: 1, damage: 1, cooldown: [1.5, 2.4], comboChance: 0.18 },
  { speed: 1.28, damage: 1.2, cooldown: [0.75, 1.35], comboChance: 0.55 },
]

export class Boss implements Damageable {
  readonly character: Character
  state: BossState = 'dormant'
  /** 0 na primeira fase, 1 na segunda. */
  phase = 0
  onPhaseChange: ((phase: number) => void) | null = null
  onDeath: (() => void) | null = null
  onAttackStart: ((attack: AttackDef) => void) | null = null
  /** Golpe dele acertou o jogador. */
  onHitLanded: ((attack: AttackDef) => void) | null = null
  /** Levou dano. */
  onHurt: (() => void) | null = null

  private rig: Rig | null = null
  private readonly velocity = new Vector3()
  private readonly center = new Vector3()
  private readonly toPlayer = new Vector3()
  private attack: AttackRun | null = null
  private cooldown = 1.2
  private stagger = 0
  private poise = POISE
  private roarTimer = 0
  private deathTimer = 0
  private combo = false

  constructor(physics: Physics) {
    this.character = new Character(physics, {
      radius: RADIUS,
      height: HEIGHT,
      layer: LAYER.enemy,
      mask: LAYER.player | LAYER.hitbox,
      position: LAYOUT.bossSpawn,
      maxHealth: MAX_HEALTH,
      maxStamina: 1,
    })
    this.character.object.name = 'boss'
    // Nasce olhando pra entrada, esperando.
    this.character.snapTo(Math.atan2(-LAYOUT.bossSpawn.x, 1))
  }

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
    return this.center
      .copy(this.character.object.position)
      .setY(this.character.object.position.y + HEIGHT * 0.45)
  }

  get hitRadius(): number {
    return RADIUS + 0.35
  }

  get alive(): boolean {
    return this.character.health > 0
  }

  /** Invencível só durante o rugido de virada de fase. */
  get invulnerable(): boolean {
    return this.state === 'roar'
  }

  get healthRatio(): number {
    return this.character.health / this.character.maxHealth
  }

  /** Acorda quando o jogador cruza o portão de névoa. */
  wake(): void {
    if (this.state !== 'dormant') return
    this.state = 'idle'
    this.cooldown = 1.1
  }

  reset(): void {
    this.character.teleport(LAYOUT.bossSpawn)
    this.character.snapTo(Math.atan2(-LAYOUT.bossSpawn.x, 1))
    this.character.health = this.character.maxHealth
    this.state = 'dormant'
    this.phase = 0
    this.attack = null
    this.cooldown = 1.2
    this.stagger = 0
    this.poise = POISE
    this.roarTimer = 0
    this.deathTimer = 0
    this.velocity.set(0, 0, 0)
    this.rig?.play(CLIPS.idle, { restart: true, fade: 0 })
  }

  takeHit(damage: number, from: Vector3): void {
    if (!this.alive || this.invulnerable) return
    this.character.damage(damage)
    this.onHurt?.()

    if (!this.alive) {
      this.state = 'dead'
      this.attack = null
      this.velocity.set(0, 0, 0)
      this.deathTimer = 0
      this.rig?.play(CLIPS.death, { once: true, fade: 0.15 })
      return
    }

    // Segunda fase aos 50%, uma vez só.
    if (this.phase === 0 && this.healthRatio <= 0.5) {
      this.enterPhaseTwo()
      return
    }

    // Poise: só cambaleia depois de acumular dano suficiente. Sem isso o chefe
    // vira saco de pancada e o combate perde a conversa.
    this.poise -= damage
    if (this.poise <= 0) {
      this.poise = POISE
      this.state = 'hit'
      this.stagger = HIT_STAGGER
      this.attack = null
      this.velocity.set(
        this.character.object.position.x - from.x,
        0,
        this.character.object.position.z - from.z,
      )
      if (this.velocity.lengthSq() > 0.0001) this.velocity.normalize().multiplyScalar(1.6)
      this.rig?.play(CLIPS.hit, { once: true, fade: 0.08, restart: true })
    }
  }

  /** Roda uma vez por passo fixo da física. */
  update(dt: number, player: Damageable & { object: Object3D }): void {
    if (this.state === 'dormant') {
      this.character.step(dt, this.velocity.set(0, 0, 0))
      return
    }

    this.toPlayer.copy(player.object.position).sub(this.character.object.position)
    this.toPlayer.y = 0
    const distance = this.toPlayer.length()
    const angleToPlayer = Math.atan2(this.toPlayer.x, this.toPlayer.z)

    switch (this.state) {
      case 'dead':
        this.deathTimer += dt
        this.velocity.set(0, 0, 0)
        if (this.deathTimer > 2.6 && this.onDeath) {
          const fn = this.onDeath
          this.onDeath = null
          fn()
        }
        break
      case 'roar':
        this.roarTimer -= dt
        this.velocity.set(0, 0, 0)
        this.character.turnTo(angleToPlayer, dt, TURN_SPEED)
        if (this.roarTimer <= 0) {
          this.state = 'idle'
          this.cooldown = 0.5
          this.rig?.play(CLIPS.idle, { fade: 0.2 })
        }
        break
      case 'hit':
        this.stagger -= dt
        this.velocity.multiplyScalar(1 - Math.min(1, 8 * dt))
        if (this.stagger <= 0) {
          this.state = 'idle'
          this.cooldown = Math.max(this.cooldown, 0.45)
          this.rig?.play(CLIPS.idle, { fade: 0.14 })
        }
        break
      case 'attack':
        this.updateAttack(dt, angleToPlayer, player)
        break
      default:
        this.decide(dt, distance, angleToPlayer, player.alive)
    }

    this.character.step(dt, this.velocity)
  }

  postStep(): void {
    this.character.syncObject()
  }

  updateAnimation(dt: number): void {
    this.rig?.update(dt)
  }

  private decide(dt: number, distance: number, angleToPlayer: number, playerAlive: boolean): void {
    this.character.turnTo(angleToPlayer, dt, TURN_SPEED)
    this.cooldown -= dt

    if (!playerAlive) {
      this.velocity.set(0, 0, 0)
      this.state = 'idle'
      this.rig?.play(CLIPS.idle)
      return
    }

    if (this.cooldown <= 0) {
      const def = this.pickAttack(distance)
      if (def) {
        this.startAttack(def)
        return
      }
    }

    // Fora de alcance, caminha. Perto e sem golpe pronto, circula devagar.
    if (distance > STRIKE_RANGE) {
      const charging = distance > THRUST_RANGE
      const speed = charging ? CHARGE_SPEED : WALK_SPEED
      this.velocity.x = Math.sin(this.character.facing) * speed
      this.velocity.z = Math.cos(this.character.facing) * speed
      this.state = 'approach'
      this.rig?.play(charging ? CLIPS.charge : CLIPS.walk)
    } else {
      this.velocity.multiplyScalar(1 - Math.min(1, 6 * dt))
      this.state = 'idle'
      this.rig?.play(CLIPS.idle)
    }
  }

  private pickAttack(distance: number): AttackDef | null {
    if (distance > THRUST_RANGE) return null
    if (distance > BOSS_ATTACKS.overhead.reach + 1.2) return BOSS_ATTACKS.thrust
    // De perto alterna entre corte alto e varredura, com peso pro corte.
    return Math.random() < 0.58 ? BOSS_ATTACKS.overhead : BOSS_ATTACKS.sweep
  }

  private startAttack(def: AttackDef): void {
    const phase = PHASES[this.phase]
    this.state = 'attack'
    this.attack = new AttackRun(def)
    this.rig?.play(def.clip, {
      once: true,
      fade: 0.12,
      restart: true,
      speed: def.speed * phase.speed,
    })
    this.onAttackStart?.(def)
  }

  private updateAttack(dt: number, angleToPlayer: number, player: Damageable): void {
    const run = this.attack
    if (!run) {
      this.state = 'idle'
      return
    }
    const phase = PHASES[this.phase]
    // Continua virando devagar durante o golpe: dá pra contornar, mas não de graça.
    this.character.turnTo(angleToPlayer, dt, TURN_SPEED_ATTACKING)

    const progress = this.rig ? this.rig.progress() : 1
    const lunging = run.inWindow(progress)
    const speed = lunging ? run.def.lunge : 0
    const blend = Math.min(1, 14 * dt)
    this.velocity.x += (Math.sin(this.character.facing) * speed - this.velocity.x) * blend
    this.velocity.z += (Math.cos(this.character.facing) * speed - this.velocity.z) * blend

    if (lunging && !run.spent) {
      const hit = sweepHit(
        this.character.object.position,
        this.character.facing,
        HEIGHT,
        run.def,
        player,
      )
      if (hit) {
        run.markHit()
        player.takeHit(
          Math.round(run.def.damage * phase.damage),
          this.character.object.position,
        )
        this.onHitLanded?.(run.def)
      }
    }

    if (progress >= 0.999) {
      this.attack = null
      this.state = 'idle'
      // Emenda: às vezes o segundo golpe vem sem respiro, mais na segunda fase.
      if (!this.combo && Math.random() < phase.comboChance) {
        this.combo = true
        this.cooldown = 0.12
      } else {
        this.combo = false
        const [min, max] = phase.cooldown
        this.cooldown = min + Math.random() * (max - min)
      }
      this.rig?.play(CLIPS.idle, { fade: 0.18 })
    }
  }

  private enterPhaseTwo(): void {
    this.phase = 1
    this.state = 'roar'
    this.roarTimer = 2.1
    this.attack = null
    this.poise = POISE
    this.velocity.set(0, 0, 0)
    this.rig?.play(CLIPS.roar, { once: true, fade: 0.15, restart: true, speed: 0.85 })
    this.onPhaseChange?.(1)
  }
}
