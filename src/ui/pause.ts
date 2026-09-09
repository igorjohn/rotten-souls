/**
 * Menu de pausa.
 *
 * Tem escuta de teclado própria, e não passa pelo `Input`, de propósito: pausar
 * desliga o `Input`, e o `press` dele ignora tecla com o input desligado. Se a
 * pausa dependesse do buffer de comandos, ela abriria e não fecharia mais.
 *
 * `Enter` e `Esc` fazem a mesma coisa. O `Esc` está aí porque é o que todo mundo
 * aperta e porque o navegador já solta o cursor com ele; o `Enter` está aí
 * porque é o que a dica no canto da tela promete.
 */

const TECLAS = new Set(['Enter', 'NumpadEnter', 'Escape'])

export class PauseMenu {
  private readonly root: HTMLElement
  private readonly resumeButton: HTMLButtonElement
  private aberto = false
  /** Só responde depois que a partida começou. No menu inicial, não. */
  private armado = false

  constructor(
    private readonly onPause: () => void,
    private readonly onResume: () => void,
  ) {
    this.root = document.querySelector<HTMLElement>('#pause-menu')!
    this.resumeButton = document.querySelector<HTMLButtonElement>('#pause-resume')!
    this.resumeButton.addEventListener('click', () => this.close())
    window.addEventListener('keydown', this.onKeyDown)
  }

  get open(): boolean {
    return this.aberto
  }

  /** Liga o menu quando o jogador entra na arena. */
  arm(): void {
    this.armado = true
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.armado || event.repeat || !TECLAS.has(event.code)) return
    event.preventDefault()
    if (this.aberto) this.close()
    else this.show()
  }

  private show(): void {
    if (this.aberto) return
    this.aberto = true
    this.root.classList.remove('hidden')
    // O botão só ganha foco depois da entrada: focar de cara faz o navegador
    // desenhar o anel de foco antes de o painel existir na tela.
    window.setTimeout(() => {
      if (this.aberto) this.resumeButton.focus()
    }, 420)
    this.onPause()
  }

  close(): void {
    if (!this.aberto) return
    this.aberto = false
    this.resumeButton.blur()
    this.root.classList.add('saindo')
    // Espera a saída terminar antes de tirar do fluxo, senão o painel some seco.
    window.setTimeout(() => {
      this.root.classList.add('hidden')
      this.root.classList.remove('saindo')
    }, 260)
    this.onResume()
  }
}
