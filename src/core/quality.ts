import { PCFShadowMap, PCFSoftShadowMap } from 'three/webgpu'

export type QualityLevel = 'alto' | 'medio' | 'baixo'

export const QUALITY_LEVELS: QualityLevel[] = ['alto', 'medio', 'baixo']

/**
 * O que cada nível muda. Tudo aqui é custo por pixel ou custo fixo de passe;
 * o look do `alto` é o do M2, aprovado pelo Igor, e não muda.
 */
export interface QualityProfile {
  level: QualityLevel
  /** Teto do devicePixelRatio. Em notebook Windows com 125% de escala isso pesa muito. */
  maxPixelRatio: number
  /** Piso do governador de resolução. */
  minScale: number
  /** Oclusão de ambiente. Desligar também tira o MRT de normais do passe de cena. */
  ao: boolean
  aoSamples: number
  shadowMapSize: number
  shadowType: typeof PCFSoftShadowMap | typeof PCFShadowMap
  /**
   * Quantas luzes pontuais de braseiro ficam acesas de fato. O Three em forward
   * avalia toda luz da cena em todo pixel, então em GPU integrada as 14 luzes
   * custam mais que a geometria. Ver `updateBrazierLights` em lighting.ts.
   */
  brazierLights: number
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  alto: {
    level: 'alto',
    maxPixelRatio: 1.5,
    minScale: 0.62,
    ao: true,
    aoSamples: 10,
    shadowMapSize: 1536,
    shadowType: PCFSoftShadowMap,
    brazierLights: Infinity,
  },
  medio: {
    level: 'medio',
    maxPixelRatio: 1.25,
    minScale: 0.55,
    ao: true,
    aoSamples: 6,
    shadowMapSize: 1024,
    shadowType: PCFSoftShadowMap,
    brazierLights: 8,
  },
  baixo: {
    level: 'baixo',
    maxPixelRatio: 1,
    minScale: 0.5,
    ao: false,
    aoSamples: 0,
    shadowMapSize: 1024,
    shadowType: PCFShadowMap,
    brazierLights: 6,
  },
}

const STORAGE_KEY = 'rotten-souls:qualidade'

function isLevel(value: string | null): value is QualityLevel {
  return value !== null && (QUALITY_LEVELS as string[]).includes(value)
}

/**
 * De onde vem o nível inicial, em ordem: `?qualidade=` na URL, escolha salva
 * no navegador, e senão `alto` com o automático ligado. Escolha manual desliga
 * o automático: quem forçou um nível não quer o jogo desfazendo.
 */
export function readInitialQuality(): { level: QualityLevel; auto: boolean } {
  const fromUrl = new URLSearchParams(window.location.search).get('qualidade')
  if (isLevel(fromUrl)) return { level: fromUrl, auto: false }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isLevel(saved)) return { level: saved, auto: false }
  } catch {
    // Modo privado ou armazenamento bloqueado: segue no automático.
  }
  return { level: 'alto', auto: true }
}

function saveQuality(level: QualityLevel): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level)
  } catch {
    // Sem armazenamento, a escolha vale só pra esta sessão.
  }
}

/** Quanto tempo o intervalo entre frames precisa ficar acima do limite pra descer um nível. */
const OVER_BUDGET_SECONDS = 3
/** Depois de descer (e no boot), espera os shaders compilarem e o governador reagir antes de julgar. */
const SETTLE_SECONDS = 5
/**
 * Intervalo entre frames a partir do qual a máquina "não aguenta": 1,4 vezes o
 * orçamento, uns 21 ms, abaixo de 48 fps. O governador mede tempo de CPU e
 * age antes disso; este limite existe pra quando ele já não basta.
 */
const OVER_BUDGET_FACTOR = 1.4
/** Um engasgo isolado (compilação de shader, aba trocando de foco) não é carga sustentada. */
const HITCH_CLAMP_MS = 100

/**
 * Escolhe o nível de qualidade. O governador de resolução encolhe a imagem
 * quando o tempo de CPU do frame estoura; quando mesmo assim o intervalo
 * entre frames continua alto, a máquina não aguenta o custo fixo (sombra,
 * luzes, oclusão), e aí só trocar de perfil resolve. Só desce, nunca sobe
 * sozinho: subir e descer em ciclo é pior que ficar num nível abaixo.
 */
export class QualityManager {
  private overBudget = 0
  private settle = SETTLE_SECONDS
  /** Intervalo suavizado. Um frame isolado dentro do orçamento não pode zerar a contagem. */
  private smoothed = 0
  private readonly listeners: Array<(profile: QualityProfile, auto: boolean) => void> = []

  level: QualityLevel
  auto: boolean

  constructor(initial = readInitialQuality()) {
    this.level = initial.level
    this.auto = initial.auto
  }

  get profile(): QualityProfile {
    return QUALITY_PROFILES[this.level]
  }

  onChange(listener: (profile: QualityProfile, auto: boolean) => void): void {
    this.listeners.push(listener)
  }

  /** Escolha do jogador, no menu de pausa. Persiste e desliga o automático. */
  choose(level: QualityLevel): void {
    this.auto = false
    saveQuality(level)
    this.set(level)
  }

  /**
   * Chamado todo frame com o intervalo de parede entre ticks (ver
   * `Loop.intervalMs`) e o orçamento do governador. Só o intervalo conta: em
   * WebGPU a GPU atrasada nem sempre aparece no tempo de CPU do frame.
   */
  update(dt: number, intervalMs: number, targetMs: number): void {
    if (!this.auto || this.level === 'baixo') return
    if (this.settle > 0) {
      this.settle -= dt
      return
    }
    const sample = Math.min(intervalMs, HITCH_CLAMP_MS)
    this.smoothed = this.smoothed === 0 ? sample : this.smoothed + (sample - this.smoothed) * 0.08
    if (this.smoothed > targetMs * OVER_BUDGET_FACTOR) {
      this.overBudget += dt
      if (this.overBudget >= OVER_BUDGET_SECONDS) {
        this.overBudget = 0
        this.settle = SETTLE_SECONDS
        this.set(QUALITY_LEVELS[QUALITY_LEVELS.indexOf(this.level) + 1])
      }
    } else {
      this.overBudget = 0
    }
  }

  private set(level: QualityLevel): void {
    if (level === this.level) return
    this.level = level
    this.smoothed = 0
    this.overBudget = 0
    console.info(`[qualidade] ${level}${this.auto ? ' (automático)' : ''}`)
    for (const listener of this.listeners) listener(this.profile, this.auto)
  }
}
