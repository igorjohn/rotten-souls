import type { RenderContext } from '../core/renderer'

interface Sample {
  fps: number
  frameMs: number
  drawCalls: number
  triangles: number
}

/**
 * Painel de perf mínimo, sem dependência externa. Fecha marco com número,
 * como manda a seção 8 do briefing. Alterna com F3.
 */
export class StatsPanel {
  private readonly root = document.createElement('div')
  private frames = 0
  private accumulatorMs = 0
  private timer = 0
  private visible = false
  private last: Sample = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 }

  constructor(private readonly ctx: RenderContext) {
    this.root.id = 'stats-panel'
    this.root.style.cssText = [
      'position:fixed',
      'left:10px',
      'bottom:10px',
      'z-index:80',
      'font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#9fb3c8',
      'background:rgba(5,7,12,.72)',
      'border:1px solid rgba(143,169,201,.18)',
      'padding:7px 10px',
      'white-space:pre',
      'pointer-events:none',
      'display:none',
    ].join(';')
    document.body.appendChild(this.root)

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || (e.code === 'Backquote' && e.shiftKey)) {
        e.preventDefault()
        this.toggle()
      }
    })
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible
    this.root.style.display = this.visible ? 'block' : 'none'
  }

  get snapshot(): Sample {
    return { ...this.last }
  }

  update(dt: number, frameMs: number): void {
    this.frames++
    this.accumulatorMs += frameMs
    this.timer += dt
    if (this.timer < 0.5) return

    // Os contadores sao zerados uma vez por frame no beginFrame, entao no fim
    // do frame eles ja sao o total do frame: passe de sombra, passe de cena e
    // todos os passes de pos-processo somados.
    const info = this.ctx.renderer.info
    this.last = {
      fps: Math.round(this.frames / this.timer),
      frameMs: Number((this.accumulatorMs / this.frames).toFixed(2)),
      drawCalls: info.render.drawCalls,
      triangles: info.render.triangles,
    }
    this.frames = 0
    this.accumulatorMs = 0
    this.timer = 0

    if (!this.visible) return
    const s = this.last
    this.root.textContent = [
      `backend    ${this.ctx.backend}`,
      `fps        ${s.fps}`,
      `frame      ${s.frameMs} ms`,
      `draw calls ${s.drawCalls}`,
      `triangles  ${s.triangles.toLocaleString('pt-BR')}`,
      `escala     ${this.ctx.resolutionScale.toFixed(2)}`,
      `geometrias ${info.memory.geometries}  texturas ${info.memory.textures}`,
    ].join('\n')
  }
}
