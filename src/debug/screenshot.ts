/**
 * Captura o canvas e manda pro endpoint /__shot do Vite, que grava em
 * docs/screenshots. Só existe em desenvolvimento.
 */
let pending: { name: string; resolve: (path: string) => void } | null = null

export function requestScreenshot(name: string): Promise<string> {
  return new Promise((resolve) => {
    pending = { name, resolve }
  })
}

/** Chamada no fim do estágio de render, com o frame já desenhado. */
export function flushScreenshot(canvas: HTMLCanvasElement): void {
  if (!pending) return
  const job = pending
  pending = null
  const data = canvas.toDataURL('image/png')
  void fetch('/__shot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: job.name, data }),
  })
    .then((r) => r.json())
    .then((r) => {
      console.info(`[shot] ${r.path}`)
      job.resolve(r.path)
    })
    .catch((error) => {
      console.warn('[shot] falhou', error)
      job.resolve('')
    })
}

declare global {
  interface Window {
    shot: (name: string) => Promise<string>
  }
}

export function exposeScreenshotHelper(): void {
  window.shot = requestScreenshot
}
