import { RenderTarget, type WebGPURenderer } from 'three/webgpu'

/**
 * Captura de frame pro fluxo de verificação visual, só em desenvolvimento.
 *
 * Não dá pra ler o canvas direto: num canvas de WebGPU o primeiro
 * `toDataURL` congela o conteúdo devolvido, e todas as capturas seguintes
 * repetem a primeira imagem. Então o frame é desenhado de novo num alvo de
 * render próprio e os pixels são lidos de lá, o que pode ser repetido à vontade.
 */
export interface Capturer {
  capture(name: string): Promise<string>
}

interface Pending {
  name: string
  resolve: (path: string) => void
}

let pending: Pending | null = null

export function requestScreenshot(name: string): Promise<string> {
  return new Promise((resolve) => {
    pending = { name, resolve }
  })
}

export interface CaptureContext {
  renderer: WebGPURenderer
  /** Desenha um frame completo no alvo de render que estiver ativo. */
  drawFrame(): void
  size(): { width: number; height: number }
}

let target: RenderTarget | null = null

/** Chamada no fim do estágio de render. Não faz nada se ninguém pediu foto. */
export function flushScreenshot(ctx: CaptureContext): void {
  if (!pending) return
  const job = pending
  pending = null
  void grab(ctx, job)
}

async function grab(ctx: CaptureContext, job: Pending): Promise<void> {
  const { width, height } = ctx.size()
  try {
    if (!target) {
      target = new RenderTarget(width, height)
    } else if (target.width !== width || target.height !== height) {
      target.setSize(width, height)
    }

    const previous = ctx.renderer.getRenderTarget()
    ctx.renderer.setRenderTarget(target)
    ctx.drawFrame()
    ctx.renderer.setRenderTarget(previous)

    const pixels = await ctx.renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      width,
      height,
    )

    const path = await upload(job.name, toPng(pixels as Uint8Array, width, height))
    console.info(`[shot] ${path}`)
    job.resolve(path)
  } catch (error) {
    console.warn('[shot] falhou', error)
    job.resolve('')
  }
}

/** No WebGPU a leitura já vem com a origem no canto superior esquerdo. */
function toPng(pixels: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  const image = context.createImageData(width, height)
  image.data.set(pixels)
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

async function upload(name: string, data: string): Promise<string> {
  const response = await fetch('/__shot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, data }),
  })
  const result = (await response.json()) as { path: string }
  return result.path
}

declare global {
  interface Window {
    shot: (name: string) => Promise<string>
  }
}

export function exposeScreenshotHelper(): void {
  window.shot = requestScreenshot
}
