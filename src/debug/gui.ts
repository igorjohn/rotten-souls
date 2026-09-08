interface Binding {
  label: string
  min: number
  max: number
  step: number
  get: () => number
  set: (value: number) => void
}

/**
 * Painel de sliders pro look dev. Sem dependência externa: são vinte linhas de
 * DOM e o briefing pede projeto magro. Abre e fecha com F4, só em desenvolvimento.
 */
export class LookDevGui {
  private readonly root = document.createElement('div')
  private readonly body = document.createElement('div')
  private open = false
  private readonly rows: Array<() => void> = []

  constructor() {
    this.root.id = 'lookdev'
    this.root.style.cssText = [
      'position:fixed',
      'right:10px',
      'top:10px',
      'z-index:90',
      'width:262px',
      'max-height:86vh',
      'overflow-y:auto',
      'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#c3b9a4',
      'background:rgba(5,7,12,.9)',
      'border:1px solid rgba(143,169,201,.2)',
      'padding:8px 10px 10px',
      'display:none',
    ].join(';')

    const title = document.createElement('div')
    title.textContent = 'look dev  ·  F4 fecha'
    title.style.cssText =
      'letter-spacing:.1em;text-transform:uppercase;color:#7d8ea3;margin-bottom:8px;font-size:10px'
    this.root.append(title, this.body)
    document.body.appendChild(this.root)

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F4') {
        e.preventDefault()
        this.toggle()
      }
    })
  }

  section(name: string): void {
    const el = document.createElement('div')
    el.textContent = name
    el.style.cssText =
      'margin:10px 0 4px;color:#8fa9c9;letter-spacing:.08em;text-transform:uppercase;font-size:10px;border-top:1px solid rgba(143,169,201,.14);padding-top:7px'
    this.body.appendChild(el)
  }

  add(binding: Binding): void {
    const row = document.createElement('label')
    row.style.cssText = 'display:block;margin:5px 0'

    const head = document.createElement('div')
    head.style.cssText = 'display:flex;justify-content:space-between;gap:8px'
    const name = document.createElement('span')
    name.textContent = binding.label
    const value = document.createElement('span')
    value.style.color = '#e0d5bb'
    head.append(name, value)

    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(binding.min)
    input.max = String(binding.max)
    input.step = String(binding.step)
    input.value = String(binding.get())
    input.style.cssText = 'width:100%;accent-color:#ff8a2a;margin-top:2px'
    input.addEventListener('input', () => {
      binding.set(Number(input.value))
      value.textContent = input.value
    })

    value.textContent = String(binding.get())
    row.append(head, input)
    this.body.appendChild(row)
    this.rows.push(() => {
      input.value = String(binding.get())
      value.textContent = input.value
    })
  }

  /** Slider ligado direto num uniform do TSL. */
  uniform(
    label: string,
    target: { value: number },
    min: number,
    max: number,
    step = 0.01,
  ): void {
    this.add({
      label,
      min,
      max,
      step,
      get: () => target.value,
      set: (v) => {
        target.value = v
      },
    })
  }

  refresh(): void {
    for (const row of this.rows) row()
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open
    this.root.style.display = this.open ? 'block' : 'none'
  }

  /** Despeja os valores atuais no console, pra colar em código depois de afinar. */
  dump(label: string): void {
    const values: Record<string, number> = {}
    for (const child of this.body.querySelectorAll('label')) {
      const name = child.querySelector('span')?.textContent ?? ''
      const input = child.querySelector('input')
      if (name && input) values[name] = Number((input as HTMLInputElement).value)
    }
    console.info(`[look dev] ${label}`, JSON.stringify(values, null, 2))
  }
}
