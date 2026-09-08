/**
 * HUD em HTML por cima do canvas. Nenhuma UI dentro do WebGL.
 * Cada barra tem duas camadas: b e o valor atual, i e o rastro do dano.
 */

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`elemento ausente no HTML: ${selector}`)
  return node
}

class Bar {
  private readonly fill: HTMLElement
  private readonly trail: HTMLElement
  private value = 1

  constructor(private readonly root: HTMLElement) {
    this.fill = root.querySelector('b')!
    this.trail = root.querySelector('i')!
    this.set(1)
  }

  set(ratio: number): void {
    const next = Math.max(0, Math.min(1, ratio))
    this.value = next
    this.fill.style.transform = `scaleX(${next})`
    this.trail.style.transform = `scaleX(${next})`
  }

  /** Baixa o valor na hora e deixa o rastro descer devagar. */
  damage(ratio: number): void {
    const next = Math.max(0, Math.min(1, ratio))
    const previous = this.value
    this.value = next
    this.fill.style.transform = `scaleX(${next})`
    if (next < previous) {
      // O rastro so anda depois, pela transicao com delay do CSS.
      requestAnimationFrame(() => {
        this.trail.style.transform = `scaleX(${next})`
      })
    } else {
      this.trail.style.transform = `scaleX(${next})`
    }
  }

  addClass(name: string): void {
    this.root.classList.add(name)
  }

  removeClass(name: string): void {
    this.root.classList.remove(name)
  }
}

export class Hud {
  private readonly root = el('#hud')
  private readonly health = new Bar(el('.bar-health'))
  private readonly stamina = new Bar(el('.bar-stamina'))
  private readonly bossRoot = el('#hud-boss')
  private readonly bossBar = new Bar(el('.bar-boss'))
  private readonly bossName = el('.boss-name')
  private readonly lockon = el('#lockon')
  private readonly hint = el('#hint')
  private readonly death = el('#overlay-death')
  private readonly victory = el('#overlay-victory')
  private readonly areaTitle = el('#overlay-area')
  private readonly loading = el('#loading')
  private readonly loadingBar = el('.loading-bar i')
  private readonly loadingStatus = el('#loading-status')
  private readonly startGate = el('#start-gate')
  private hintTimer = 0

  show(): void {
    this.root.classList.add('visible')
  }

  hide(): void {
    this.root.classList.remove('visible')
  }

  setHealth(ratio: number): void {
    this.health.damage(ratio)
  }

  setStamina(ratio: number, spent: boolean): void {
    this.stamina.set(ratio)
    if (spent) this.stamina.addClass('spent')
    else this.stamina.removeClass('spent')
  }

  showBoss(name: string): void {
    this.bossName.textContent = name
    this.bossRoot.classList.remove('hidden')
  }

  hideBoss(): void {
    this.bossRoot.classList.add('hidden')
  }

  setBossHealth(ratio: number, phaseTwo: boolean): void {
    this.bossBar.damage(ratio)
    if (phaseTwo) this.bossBar.addClass('phase-two')
    else this.bossBar.removeClass('phase-two')
  }

  setLockOn(screen: { x: number; y: number } | null): void {
    if (!screen) {
      this.lockon.classList.add('hidden')
      return
    }
    this.lockon.classList.remove('hidden')
    this.lockon.style.transform = `translate(${screen.x}px, ${screen.y}px)`
  }

  showHint(text: string, seconds = 3): void {
    this.hint.textContent = text
    this.hint.classList.add('visible')
    this.hintTimer = seconds
  }

  update(dt: number): void {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt
      if (this.hintTimer <= 0) this.hint.classList.remove('visible')
    }
  }

  showDeath(): void {
    this.death.classList.remove('hidden')
    requestAnimationFrame(() => this.death.classList.add('showing'))
  }

  hideDeath(): void {
    this.death.classList.remove('showing')
    window.setTimeout(() => this.death.classList.add('hidden'), 900)
  }

  showVictory(): void {
    this.victory.classList.remove('hidden')
    requestAnimationFrame(() => this.victory.classList.add('showing'))
  }

  showAreaTitle(seconds = 4): void {
    this.areaTitle.classList.remove('hidden')
    requestAnimationFrame(() => this.areaTitle.classList.add('showing'))
    window.setTimeout(() => {
      this.areaTitle.classList.remove('showing')
      window.setTimeout(() => this.areaTitle.classList.add('hidden'), 1300)
    }, seconds * 1000)
  }

  setLoading(ratio: number, status: string): void {
    if (ratio >= 0) this.loadingBar.style.width = `${Math.round(ratio * 100)}%`
    if (status) this.loadingStatus.textContent = status
  }

  finishLoading(): void {
    this.loadingBar.style.width = '100%'
    this.loading.classList.add('gone')
    window.setTimeout(() => this.loading.classList.add('hidden'), 900)
    this.startGate.classList.remove('hidden')
  }

  onStart(fn: () => void): void {
    const button = el<HTMLButtonElement>('#start-button')
    button.addEventListener('click', () => {
      this.startGate.classList.add('gone')
      window.setTimeout(() => this.startGate.classList.add('hidden'), 900)
      fn()
    })
  }
}

export function setRendererBadge(text: string): void {
  el('#renderer-badge').textContent = text
}
