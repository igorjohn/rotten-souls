import { Timer } from 'three/webgpu'

export type Stage = 'input' | 'simulate' | 'animate' | 'camera' | 'render'

type StageFn = (dt: number, elapsed: number) => void

/**
 * Ordem de update fixa. Ninguém roda fora de estágio, o que evita o clássico
 * "a câmera usou a posição do frame passado".
 */
const ORDER: Stage[] = ['input', 'simulate', 'animate', 'camera', 'render']

export class Loop {
  private readonly timer = new Timer()
  private readonly stages = new Map<Stage, StageFn[]>()
  private running = false
  private lastFrameMs = 0
  private frameStart = 0

  /**
   * Em dev o painel de preview roda a pagina como documento oculto, e o
   * requestAnimationFrame simplesmente nao dispara. Sem isso nao da pra
   * verificar nada visualmente, que e a regra da secao 8.
   */
  private readonly allowHiddenTicks = import.meta.env.DEV
  /**
   * O Chrome estrangula setTimeout pra um por segundo em documento oculto, o
   * que deixaria o jogo a 1 fps no painel de preview. MessageChannel nao sofre
   * esse estrangulamento e roda no fim da fila de tarefas, entao serve de
   * relogio de desenvolvimento.
   */
  private readonly channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null
  private pendingTick: (() => void) | null = null

  constructor(private readonly maxDelta = 1 / 20) {
    for (const stage of ORDER) this.stages.set(stage, [])
    if (this.channel) {
      this.channel.port1.onmessage = () => {
        const tick = this.pendingTick
        this.pendingTick = null
        tick?.()
      }
    }
  }

  private schedule(tick: () => void): void {
    if (this.allowHiddenTicks && document.hidden && this.channel) {
      this.pendingTick = tick
      this.channel.port2.postMessage(0)
    } else {
      requestAnimationFrame(tick)
    }
  }

  on(stage: Stage, fn: StageFn): void {
    this.stages.get(stage)!.push(fn)
  }

  get frameMs(): number {
    return this.lastFrameMs
  }

  start(): void {
    if (this.running) return
    this.running = true
    // Em producao o Timer pausa sozinho com a aba em segundo plano. Em dev isso
    // zeraria o delta dentro do painel de preview, que roda como documento
    // oculto, e nada andaria. O clamp de maxDelta ja evita o pulo na volta.
    if (!this.allowHiddenTicks) this.timer.connect(document)
    const tick = () => {
      if (!this.running) return
      this.frameStart = performance.now()
      this.timer.update()
      const dt = Math.min(this.timer.getDelta(), this.maxDelta)
      const elapsed = this.timer.getElapsed()
      for (const stage of ORDER) {
        const fns = this.stages.get(stage)!
        for (let i = 0; i < fns.length; i++) fns[i](dt, elapsed)
      }
      this.lastFrameMs = performance.now() - this.frameStart
      this.schedule(tick)
    }
    this.schedule(tick)
  }

  stop(): void {
    this.running = false
    if (!this.allowHiddenTicks) this.timer.disconnect()
  }
}
