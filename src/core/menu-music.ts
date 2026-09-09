/**
 * Música do menu.
 *
 * Fica fora do `audio.ts` de propósito. Aquele módulo é o grafo de Web Audio do
 * jogo, com barramentos e som posicional, e nasce dentro de um gesto do
 * usuário. O menu aparece antes de qualquer gesto, então a trilha dele é um
 * `<audio>` comum: transmite em vez de decodificar um megabyte na memória, e
 * não depende do `AudioContext` existir ainda.
 *
 * Sobre tocar sozinho: o navegador bloqueia áudio antes da primeira interação
 * com a página, e isso não tem como contornar. Então a trilha tenta tocar na
 * hora e, se levar bloqueio, fica armada e entra no primeiro clique ou tecla,
 * o que for. Na prática ela começa sozinha em quase toda visita, porque o
 * bloqueio só vale pra primeira vez que se abre o domínio.
 */

const FAIXA = 'assets/audio/menu/tema-menu.m4a'
const VOLUME = 0.42
/** Tempo pra sumir quando o jogo começa, em segundos. */
const SAIDA = 1.4

export class MenuMusic {
  private readonly element: HTMLAudioElement
  private armed: (() => void) | null = null
  private fading = 0

  constructor() {
    this.element = new window.Audio(FAIXA)
    this.element.loop = true
    this.element.volume = VOLUME
    this.element.preload = 'auto'
  }

  /** Silencia de vez. Usado pelo `?mudo`, que abre o jogo sem som nenhum. */
  mute(): void {
    this.element.muted = true
    this.element.volume = 0
  }

  /** Tenta tocar. Se o navegador barrar, arma pra tocar no primeiro gesto. */
  start(): void {
    const tocar = this.element.play()
    if (!tocar || typeof tocar.catch !== 'function') return
    tocar.catch(() => {
      // Bloqueio de autoplay. Não é erro, é política do navegador.
      const destravar = () => {
        void this.element.play().catch(() => undefined)
        this.disarm()
      }
      this.armed = destravar
      window.addEventListener('pointerdown', destravar, { once: true })
      window.addEventListener('keydown', destravar, { once: true })
    })
  }

  private disarm(): void {
    if (!this.armed) return
    window.removeEventListener('pointerdown', this.armed)
    window.removeEventListener('keydown', this.armed)
    this.armed = null
  }

  /**
   * Some e para. O corte seco entrega que é um arquivo tocando; a queda de um
   * segundo e meio deixa a trilha do menu virar o silêncio da arena.
   */
  fadeOut(): void {
    this.disarm()
    if (this.element.paused || this.fading) return
    const inicio = performance.now()
    const volumeInicial = this.element.volume
    this.fading = window.setInterval(() => {
      const t = (performance.now() - inicio) / (SAIDA * 1000)
      if (t >= 1) {
        this.element.pause()
        this.element.currentTime = 0
        window.clearInterval(this.fading)
        this.fading = 0
        return
      }
      this.element.volume = volumeInicial * (1 - t)
    }, 40)
  }
}
