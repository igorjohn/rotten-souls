import { Vector3 } from 'three/webgpu'

/**
 * Definição de um golpe. Tudo que o combate precisa saber está aqui: qual
 * clipe toca, em que fração dele o golpe machuca, quanto tira e qual o alcance.
 *
 * A janela de dano em fração do clipe, e não em segundos, é o que faz o ataque
 * pesado ser o mesmo clipe mais lento sem sair de sincronia com a animação.
 */
export interface AttackDef {
  readonly name: string
  readonly clip: string
  /** Multiplicador de velocidade do clipe. */
  readonly speed: number
  /** Início da janela de dano, de 0 a 1 do clipe. */
  readonly windowStart: number
  readonly windowEnd: number
  readonly damage: number
  readonly stamina: number
  /** Distância do centro do golpe à frente de quem ataca, em metros. */
  readonly reach: number
  /** Raio da esfera de golpe. */
  readonly radius: number
  /** Empurrão à frente durante a janela, em metros por segundo. */
  readonly lunge: number
  /** Quanto tempo depois do fim do clipe o próximo comando é aceito. */
  readonly recovery: number
}

export interface Damageable {
  /** Centro do corpo em coordenadas de mundo. */
  readonly hitCenter: Vector3
  readonly hitRadius: number
  readonly alive: boolean
  /** Verdadeiro na janela de invencibilidade. */
  readonly invulnerable: boolean
  takeHit(damage: number, from: Vector3): void
}

const point = new Vector3()
const delta = new Vector3()

/**
 * Testa um golpe contra um alvo. O golpe é uma esfera à frente de quem ataca,
 * na altura do peito. Simples de propósito: num slice de arena com um chefe,
 * caixa de golpe por osso não muda a sensação e custa muito mais.
 */
export function sweepHit(
  attackerFeet: Vector3,
  facing: number,
  attackerHeight: number,
  attack: AttackDef,
  target: Damageable,
): boolean {
  if (!target.alive || target.invulnerable) return false

  point
    .set(Math.sin(facing), 0, Math.cos(facing))
    .multiplyScalar(attack.reach)
    .add(attackerFeet)
  point.y = attackerFeet.y + attackerHeight * 0.55

  delta.copy(target.hitCenter).sub(point)
  return delta.lengthSq() <= (attack.radius + target.hitRadius) ** 2
}

/** Estado de um golpe em andamento. */
export class AttackRun {
  private hitLanded = false
  private elapsed = 0

  constructor(readonly def: AttackDef) {}

  advance(dt: number): void {
    this.elapsed += dt
  }

  /** Verdadeiro enquanto o clipe está dentro da janela que machuca. */
  inWindow(progress: number): boolean {
    return progress >= this.def.windowStart && progress <= this.def.windowEnd
  }

  get spent(): boolean {
    return this.hitLanded
  }

  markHit(): void {
    this.hitLanded = true
  }

  get time(): number {
    return this.elapsed
  }
}

export const PLAYER_ATTACKS = {
  light: {
    name: 'leve',
    // Sword_Attack dura 1,50 s. A 2,4x isso vira 0,63 s de golpe, que e o
    // tempo de um ataque leve de Souls. A 1,4x dava 1,07 s e parecia peso morto.
    clip: 'Sword_Attack',
    speed: 2.4,
    windowStart: 0.26,
    windowEnd: 0.46,
    damage: 17,
    stamina: 20,
    reach: 2.1,
    radius: 1.25,
    lunge: 3.2,
    recovery: 0.08,
  },
  heavy: {
    name: 'pesado',
    // 1,11 s. Pesado tem que ser mais lento que o leve, nao lento de doer.
    clip: 'Sword_Attack',
    speed: 1.35,
    windowStart: 0.42,
    windowEnd: 0.62,
    damage: 34,
    stamina: 34,
    reach: 2.5,
    radius: 1.45,
    lunge: 4,
    recovery: 0.18,
  },
} as const satisfies Record<string, AttackDef>

/**
 * Os três golpes de Vharen. Cada um com telegrafia diferente: o corte alto é
 * lento e largo, a varredura é média e pega os lados, a estocada é a mais
 * rápida e vem de longe. Ler qual está vindo é o jogo.
 */
export const BOSS_ATTACKS = {
  /** Corte alto. Longo de avisar, forte de acertar. */
  overhead: {
    name: 'corte alto',
    clip: 'Sword_Attack',
    speed: 0.62,
    windowStart: 0.46,
    windowEnd: 0.63,
    damage: 22,
    stamina: 0,
    reach: 3.9,
    radius: 2.1,
    lunge: 2.6,
    recovery: 1.05,
  },
  /** Varredura lateral, cobre quem tenta contornar. */
  sweep: {
    name: 'varredura',
    clip: 'Punch_Cross',
    speed: 0.85,
    windowStart: 0.34,
    windowEnd: 0.55,
    damage: 16,
    stamina: 0,
    reach: 3.4,
    radius: 2.7,
    lunge: 1.6,
    recovery: 0.75,
  },
  /** Estocada com avanço, castiga quem fica longe curando distância. */
  thrust: {
    name: 'estocada',
    clip: 'Punch_Jab',
    speed: 1.05,
    windowStart: 0.28,
    windowEnd: 0.44,
    damage: 14,
    stamina: 0,
    reach: 4.2,
    radius: 1.9,
    lunge: 5.4,
    recovery: 0.55,
  },
} as const satisfies Record<string, AttackDef>
