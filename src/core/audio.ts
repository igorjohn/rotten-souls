/**
 * Áudio do jogo.
 *
 * Duas fontes, e a divisão é por natureza do som, não por preguiça:
 *
 * - **Sintetizado na Web Audio API.** Todo efeito curto: passo, corte, impacto,
 *   estalo de braseiro, clique de menu, trava do alvo, rugido, música do chefe.
 *   Som de arena escura é ruído filtrado com envelope, e isso sai mais leve que
 *   qualquer amostra comprimida e ainda é parametrizável (peso do golpe,
 *   distância do braseiro) sem uma gravação pra cada caso.
 * - **Amostra gravada ou gerada.** O que é longo, musical ou textural, que
 *   oscilador não imita: o stinger da travessia do portão de névoa e as telas
 *   de morte e vitória vêm do Lyria 3 (`scripts/gen-audio.mjs`, catálogo em
 *   `public/assets/audio/cues`); o corte no ar vem de um banco gravado
 *   (`public/assets/audio/swings`).
 *
 * A trilha do menu não mora aqui: ela toca antes de existir gesto do usuário,
 * então é um `<audio>` comum em `src/core/menu-music.ts`.
 *
 * A regra vale pros dois bancos: **amostra quando existe, síntese como
 * reserva, e o jogo nunca quebra se o arquivo faltar.** Tudo que toca amostra
 * tem um `synth...` equivalente atrás.
 */

export type Bus = 'sfx' | 'ambient' | 'music'

interface Buses {
  sfx: GainNode
  ambient: GainNode
  music: GainNode
}

/** Qualquer coisa com posição no mundo. Evita importar o three aqui. */
interface Ponto {
  x: number
  y: number
  z: number
}

/**
 * O bastante da câmera pra posicionar o ouvinte. A `PerspectiveCamera` do three
 * satisfaz isso por estrutura, sem o módulo de áudio conhecer o renderizador.
 */
export interface ListenerPose {
  position: Ponto
  matrixWorld: { elements: ArrayLike<number> }
}

const MASTER_LEVEL = 0.85

/** Amostras de corte no ar, geradas por `scripts/trim-swings.py`. */
const SWINGS_DIR = 'assets/audio/swings'
/** Clipes gerados pelo Lyria e cortados por `scripts/gen-audio.mjs --master`. */
const CUES_DIR = 'assets/audio/cues'

/** Passada do chefe em metros. Ele tem duas vezes e meia a altura do jogador. */
const BOSS_STRIDE = 3.8
/** Além disso o braseiro não vale um estalo, é só custo de nó. */
const BRAZIER_RANGE = 26

/**
 * `?mudo` na URL abre o jogo sem som. Serve pra abrir uma segunda aba de teste
 * sem tocar por cima de quem está trabalhando na máquina. `?mute` continua
 * valendo porque era o nome que este módulo usava antes de o `main.ts` adotar
 * `mudo`, e um parâmetro de silêncio que falha calado é o pior tipo de bug.
 */
function mutedByUrl(): boolean {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.has('mudo') || params.has('mute')
  } catch {
    return false
  }
}

/**
 * Contexto offline não tem alto-falante: ele existe pra medir RMS mais rápido
 * que tempo real. Zerar o mestre nele não silencia nada, só devolveria zero pra
 * régua, então a bateria de medição roda com o ganho de verdade.
 */
function isOffline(context: BaseAudioContext): boolean {
  return typeof OfflineAudioContext !== 'undefined' && context instanceof OfflineAudioContext
}

export class Audio {
  private context: AudioContext | null = null
  private buses: Buses | null = null
  private noise: AudioBuffer | null = null
  private ambientSource: AudioBufferSourceNode | null = null
  private musicNodes: AudioNode[] = []
  private musicFilters: BiquadFilterNode[] = []
  private musicPulse = 0
  private musicBeatMs = 2300
  private musicTimer: number | null = null
  private started = false
  /** Banco de cortes no ar. Vazio até o fetch terminar; aí `swing` passa a usá-lo. */
  private swings: AudioBuffer[] = []
  private lastSwing = -1
  /** Clipes gerados, por nome do cue. Vazio até o fetch terminar. */
  private cues = new Map<string, AudioBuffer>()
  private cuesPromise: Promise<void> | null = null

  private braziers: Ponto[] = []
  private brazierTimer: number | null = null
  private gateNodes: AudioNode[] = []
  private listener: Ponto = { x: 0, y: 1.6, z: 0 }

  private bossStrideDistance = 0
  private bossLast: Ponto | null = null
  private exhausted = false

  // ─────────────────────────────────────────────────────────────────────────
  // Ciclo de vida
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Cria o contexto e os barramentos. Idempotente, porque tanto o menu quanto o
   * botão Entrar podem ser o primeiro a chamar.
   */
  private ensureContext(): AudioContext | null {
    if (this.context) return this.context
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null

    const context = new Ctor()
    this.context = context
    const master = context.createGain()
    master.gain.value = mutedByUrl() && !isOffline(context) ? 0 : MASTER_LEVEL
    master.connect(context.destination)

    this.buses = {
      sfx: makeBus(context, master, 0.9),
      ambient: makeBus(context, master, 0.168),
      music: makeBus(context, master, 0.5),
    }
    this.noise = makeNoiseBuffer(context, 2.5)
    void this.loadCues(context)
    return context
  }

  /** Entrada no jogo. Chamado no clique do botão Entrar, que é o gesto válido. */
  start(): void {
    if (this.started) return
    const context = this.ensureContext()
    if (!context) return
    this.started = true

    this.startAmbient()
    void this.loadSwings(context)
    void context.resume()
  }

  get enabled(): boolean {
    return this.context !== null
  }

  setBusLevel(bus: Bus, level: number): void {
    if (!this.buses) return
    this.buses[bus].gain.value = level
  }

  /**
   * Posições fixas do mundo que emitem som. Chamado uma vez, na entrada.
   * O áudio não conhece a arena; recebe pontos e cuida do resto.
   */
  placeWorld(mundo: { braziers?: readonly Ponto[]; gate?: Ponto }): void {
    if (mundo.braziers) {
      this.braziers = mundo.braziers.map((p) => ({ x: p.x, y: p.y, z: p.z }))
      this.scheduleCrackle()
    }
    if (mundo.gate) this.startGateHum(mundo.gate)
  }

  /** Uma vez por frame, com a câmera já posicionada. */
  setListener(pose: ListenerPose): void {
    const context = this.context
    if (!context) return
    const { position, matrixWorld } = pose
    this.listener = { x: position.x, y: position.y, z: position.z }

    const e = matrixWorld.elements
    // Frente da câmera é o menos Z da matriz de mundo; cima é o Y.
    const forward = [-e[8], -e[9], -e[10]] as const
    const up = [e[4], e[5], e[6]] as const

    const alvo = context.listener as AudioListener & {
      positionX?: AudioParam
      forwardX?: AudioParam
      setPosition?: (x: number, y: number, z: number) => void
      setOrientation?: (...args: number[]) => void
    }
    if (alvo.positionX && alvo.forwardX) {
      alvo.positionX.value = position.x
      ;(alvo as unknown as Record<string, AudioParam>).positionY.value = position.y
      ;(alvo as unknown as Record<string, AudioParam>).positionZ.value = position.z
      alvo.forwardX.value = forward[0]
      ;(alvo as unknown as Record<string, AudioParam>).forwardY.value = forward[1]
      ;(alvo as unknown as Record<string, AudioParam>).forwardZ.value = forward[2]
      ;(alvo as unknown as Record<string, AudioParam>).upX.value = up[0]
      ;(alvo as unknown as Record<string, AudioParam>).upY.value = up[1]
      ;(alvo as unknown as Record<string, AudioParam>).upZ.value = up[2]
    } else {
      alvo.setPosition?.(position.x, position.y, position.z)
      alvo.setOrientation?.(forward[0], forward[1], forward[2], up[0], up[1], up[2])
    }
  }

  dispose(): void {
    this.stopBossMusic()
    if (this.brazierTimer !== null) window.clearTimeout(this.brazierTimer)
    this.brazierTimer = null
    stopAll(this.gateNodes)
    this.ambientSource?.stop()
    void this.context?.close()
    this.context = null
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bancos de amostra
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Busca o banco de cortes em segundo plano. Não bloqueia a entrada na arena:
   * até terminar, `swing` usa o sintetizado. São 148 KB, então na prática já
   * está pronto antes do primeiro golpe.
   */
  private async loadSwings(context: AudioContext): Promise<void> {
    try {
      const resposta = await fetch(`${SWINGS_DIR}/manifest.json`)
      if (!resposta.ok) return
      const manifesto = (await resposta.json()) as { amostras?: { arquivo: string }[] }
      const arquivos = manifesto.amostras ?? []
      if (arquivos.length === 0) return

      const buffers = await Promise.all(
        arquivos.map(async ({ arquivo }) => {
          const dados = await fetch(`${SWINGS_DIR}/${arquivo}`)
          if (!dados.ok) throw new Error(arquivo)
          return context.decodeAudioData(await dados.arrayBuffer())
        }),
      )
      this.swings = buffers
    } catch {
      // Sem banco o jogo continua com o corte sintetizado. Nada a fazer aqui.
    }
  }

  /**
   * Mesmo padrão pros clipes gerados. Um cue que não carregar simplesmente não
   * entra no mapa, e quem for tocá-lo cai no sintetizado. Cada arquivo é
   * tolerado sozinho: um 404 no de vitória não derruba o do menu.
   */
  private loadCues(context: AudioContext): Promise<void> {
    if (this.cuesPromise) return this.cuesPromise
    this.cuesPromise = (async () => {
      try {
        const resposta = await fetch(`${CUES_DIR}/manifest.json`)
        if (!resposta.ok) return
        const manifesto = (await resposta.json()) as {
          cues?: Record<string, { arquivo: string }>
        }
        const entradas = Object.entries(manifesto.cues ?? {})
        await Promise.all(
          entradas.map(async ([nome, cue]) => {
            try {
              const dados = await fetch(`${CUES_DIR}/${cue.arquivo}`)
              if (!dados.ok) return
              this.cues.set(nome, await context.decodeAudioData(await dados.arrayBuffer()))
            } catch {
              // Cue solto que falhou: os outros seguem.
            }
          }),
        )
      } catch {
        // Sem catálogo, tudo cai no sintetizado.
      }
    })()
    return this.cuesPromise
  }

  /** Toca um clipe gerado. Devolve `false` quando ele não está disponível. */
  private playCue(nome: string, level: number, destino?: AudioNode): boolean {
    const { context, buses } = this
    const buffer = this.cues.get(nome)
    if (!context || !buses || !buffer) return false
    const source = context.createBufferSource()
    source.buffer = buffer
    const gain = context.createGain()
    gain.gain.value = level
    source.connect(gain).connect(destino ?? buses.music)
    source.start(context.currentTime)
    return true
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Interface
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Confirmação do botão Entrar. Uma badalada seca de metal grave com um baque
   * embaixo, o gesto de bater num portão de ferro, não um bipe de interface.
   */
  uiConfirm(): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return
    const now = context.currentTime

    // Parciais não harmônicos: é isso que faz soar metal e não flauta.
    for (const [frequency, level, decay] of [
      [196, 0.2, 2.2],
      [293, 0.12, 1.8],
      [431, 0.07, 1.4],
      [622, 0.04, 1],
    ] as const) {
      const osc = context.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(frequency, now)
      osc.frequency.linearRampToValueAtTime(frequency * 0.995, now + decay)
      const gain = context.createGain()
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(level, now + 0.004)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      osc.connect(gain).connect(buses.sfx)
      osc.start(now)
      osc.stop(now + decay + 0.05)
    }

    const thud = context.createOscillator()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(96, now)
    thud.frequency.exponentialRampToValueAtTime(44, now + 0.4)
    const thudGain = context.createGain()
    thudGain.gain.setValueAtTime(0.34, now)
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55)
    thud.connect(thudGain).connect(buses.sfx)
    thud.start(now)
    thud.stop(now + 0.6)

    const strike = context.createBufferSource()
    strike.buffer = noise
    const strikeFilter = context.createBiquadFilter()
    strikeFilter.type = 'bandpass'
    strikeFilter.frequency.value = 2600
    strikeFilter.Q.value = 0.9
    const strikeGain = context.createGain()
    strikeGain.gain.setValueAtTime(0.16, now)
    strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
    strike.connect(strikeFilter).connect(strikeGain).connect(buses.sfx)
    strike.start(now, Math.random() * 2)
    strike.stop(now + 0.16)
  }

  /**
   * Abrir e fechar o menu de pausa. É o som mais apagado do jogo de propósito:
   * interface não pode competir com combate. Um sopro curto de ruído grave com
   * uma nota abafada por baixo, descendo ao abrir (o mundo se recolhe) e
   * subindo ao fechar. Sem transiente duro, senão a orelha lê como golpe e o
   * jogador procura de onde veio.
   *
   * O nível é calibrado por medida, não por gosto: fica perto de um décimo do
   * RMS de um impacto, na mesma faixa do estalo de braseiro distante.
   */
  pauseToggle(opening: boolean): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return
    const now = context.currentTime

    const de = opening ? 190 : 124
    const para = opening ? 124 : 190

    const tom = context.createOscillator()
    tom.type = 'sine'
    tom.frequency.setValueAtTime(de, now)
    tom.frequency.exponentialRampToValueAtTime(para, now + 0.17)
    const tomGain = context.createGain()
    tomGain.gain.setValueAtTime(0, now)
    tomGain.gain.linearRampToValueAtTime(0.075, now + 0.03)
    tomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    tom.connect(tomGain).connect(buses.sfx)
    tom.start(now)
    tom.stop(now + 0.34)

    const sopro = context.createBufferSource()
    sopro.buffer = noise
    sopro.playbackRate.value = 0.7
    const filtro = context.createBiquadFilter()
    filtro.type = 'lowpass'
    filtro.frequency.setValueAtTime(opening ? 1100 : 520, now)
    filtro.frequency.exponentialRampToValueAtTime(opening ? 480 : 1200, now + 0.2)
    const soproGain = context.createGain()
    soproGain.gain.setValueAtTime(0, now)
    soproGain.gain.linearRampToValueAtTime(0.055, now + 0.035)
    soproGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26)
    sopro.connect(filtro).connect(soproGain).connect(buses.sfx)
    sopro.start(now, Math.random() * 2)
    sopro.stop(now + 0.3)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ambiente
  // ─────────────────────────────────────────────────────────────────────────

  /** Vento contínuo: ruído rosa passado por um filtro que respira. */
  private startAmbient(): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise || this.ambientSource) return

    const source = context.createBufferSource()
    source.buffer = noise
    source.loop = true

    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 380
    band.Q.value = 0.6

    const shelf = context.createBiquadFilter()
    shelf.type = 'lowshelf'
    shelf.frequency.value = 200
    shelf.gain.value = 6

    // Respiração lenta do vento, entre 0,05 e 0,12 Hz.
    const lfo = context.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = context.createGain()
    lfoGain.gain.value = 180
    lfo.connect(lfoGain).connect(band.frequency)
    lfo.start()

    source.connect(band).connect(shelf).connect(buses.ambient)
    source.start()
    this.ambientSource = source
  }

  /**
   * Estalo de braseiro, posicional. Em vez de doze laços de fogo tocando
   * sempre, um agendador sorteia um braseiro perto do ouvinte e solta um estalo
   * curto por um `PannerNode` na posição dele. O fogo aparece de onde o fogo
   * está e o custo é de um punhado de nós por segundo, não de doze fontes vivas.
   */
  private scheduleCrackle(): void {
    if (this.brazierTimer !== null || this.braziers.length === 0) return
    const tick = () => {
      this.brazierTimer = null
      if (!this.context) return
      this.crackle()
      this.brazierTimer = window.setTimeout(tick, 150 + Math.random() * 380)
    }
    this.brazierTimer = window.setTimeout(tick, 400)
  }

  private crackle(): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return

    // Sorteio com peso pela proximidade: o braseiro do lado estala mais que o
    // do outro lado da arena, que é o que a orelha espera.
    const perto: { ponto: Ponto; peso: number }[] = []
    let total = 0
    for (const ponto of this.braziers) {
      const d = Math.hypot(
        ponto.x - this.listener.x,
        ponto.y - this.listener.y,
        ponto.z - this.listener.z,
      )
      if (d > BRAZIER_RANGE) continue
      const peso = 1 / (1 + d * 0.35)
      perto.push({ ponto, peso })
      total += peso
    }
    if (perto.length === 0) return

    let sorteio = Math.random() * total
    let escolhido = perto[perto.length - 1].ponto
    for (const item of perto) {
      sorteio -= item.peso
      if (sorteio <= 0) {
        escolhido = item.ponto
        break
      }
    }

    const now = context.currentTime
    const panner = makePanner(context, escolhido, 2.5, 30, 1.3)
    panner.connect(buses.ambient)

    const source = context.createBufferSource()
    source.buffer = noise
    source.playbackRate.value = 0.9 + Math.random() * 1.1

    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 900 + Math.random() * 1900
    // Q baixo de propósito. Com Q 5 o estalo media 0,003 de RMS a três metros
    // do braseiro, contra 0,071 do vento: o filtro estreito jogava fora quase
    // todo o ruído, que já vem suavizado da fonte. Com Q perto de 2 e ganho
    // alto ele mede 0,040 a três metros e 0,007 a catorze, que é fogo que se
    // ouve de perto e some de longe.
    filter.Q.value = 1.4 + Math.random() * 1.2

    const duration = 0.03 + Math.random() * 0.09
    const gain = context.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(4.5 + Math.random() * 4.5, now + 0.003)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    source.connect(filter).connect(gain).connect(panner)
    source.start(now, Math.random() * 2)
    source.stop(now + duration + 0.05)
    window.setTimeout(() => panner.disconnect(), (duration + 0.3) * 1000)
  }

  /**
   * Zumbido do portão de névoa. Fica preso na posição do portão com queda por
   * distância, então ele cresce sozinho conforme o jogador se aproxima e é o
   * aviso de que aquilo ali não é uma parede qualquer.
   */
  private startGateHum(gate: Ponto): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise || this.gateNodes.length > 0) return
    const now = context.currentTime

    const panner = makePanner(context, { x: gate.x, y: gate.y + 2, z: gate.z }, 4, 34, 1.1)
    panner.connect(buses.ambient)
    this.gateNodes.push(panner)

    const bed = context.createGain()
    bed.gain.setValueAtTime(0, now)
    bed.gain.linearRampToValueAtTime(1, now + 4)
    bed.connect(panner)
    this.gateNodes.push(bed)

    // Dois graves quase na mesma nota. O batimento entre eles é o que dá a
    // sensação de coisa viva parada ali, sem custar nada.
    for (const [frequency, level] of [
      [43.5, 0.5],
      [44.9, 0.4],
      [87, 0.14],
    ] as const) {
      const osc = context.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = frequency
      const gain = context.createGain()
      gain.gain.value = level
      osc.connect(gain).connect(bed)
      osc.start(now)
      this.gateNodes.push(osc, gain)
    }

    const sopro = context.createBufferSource()
    sopro.buffer = noise
    sopro.loop = true
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 620
    band.Q.value = 1.4
    const soproGain = context.createGain()
    soproGain.gain.value = 0.22
    const lfo = context.createOscillator()
    lfo.frequency.value = 0.19
    const lfoGain = context.createGain()
    lfoGain.gain.value = 0.12
    lfo.connect(lfoGain).connect(soproGain.gain)
    lfo.start(now)
    sopro.connect(band).connect(soproGain).connect(bed)
    sopro.start(now)
    this.gateNodes.push(sopro, band, soproGain, lfo, lfoGain)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Passos
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Passo do jogador. `weight` de 0 a 1 muda o corpo do som: andar é seco,
   * correr é mais pesado e um pouco mais grave.
   *
   * Tem duas camadas. O ruído de banda é o contato da sola; o baque curto por
   * baixo é o corpo. O baque entrou porque só com a camada de ruído o passo
   * media 0,012 de RMS contra 0,074 do vento, ou seja, ficava enterrado debaixo
   * do ambiente. Corpo grave rende RMS sem precisar de pico alto, que é o que
   * estouraria a mistura quando o passo cai junto com um golpe.
   */
  footstep(weight = 0.5): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return
    const now = context.currentTime

    const source = context.createBufferSource()
    source.buffer = noise
    source.playbackRate.value = 0.8 + Math.random() * 0.5

    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 900 - weight * 350 + Math.random() * 200
    filter.Q.value = 1.1

    const gain = context.createGain()
    const peak = 0.22 + weight * 0.2
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 + weight * 0.05)

    source.connect(filter).connect(gain).connect(buses.sfx)
    source.start(now, Math.random() * 2)
    source.stop(now + 0.24)

    const body = context.createOscillator()
    body.type = 'sine'
    body.frequency.setValueAtTime(168 - weight * 26, now)
    body.frequency.exponentialRampToValueAtTime(72, now + 0.14)
    const bodyGain = context.createGain()
    bodyGain.gain.setValueAtTime(0, now)
    bodyGain.gain.linearRampToValueAtTime(0.1 + weight * 0.07, now + 0.006)
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17)
    body.connect(bodyGain).connect(buses.sfx)
    body.start(now)
    body.stop(now + 0.2)
  }

  /**
   * Passo do chefe, por distância percorrida. O jogo só entrega a posição dele
   * a cada frame; a passada mora aqui porque é decisão de som, não de combate.
   */
  bossStride(position: Ponto): void {
    if (!this.context) return
    const last = this.bossLast
    this.bossLast = { x: position.x, y: position.y, z: position.z }
    if (!last) return

    const passo = Math.hypot(position.x - last.x, position.z - last.z)
    // Teleporte de respawn não vira passo.
    if (passo > 1.5) {
      this.bossStrideDistance = 0
      return
    }
    this.bossStrideDistance += passo
    if (this.bossStrideDistance < BOSS_STRIDE) return
    this.bossStrideDistance = 0
    this.bossFootstep()
  }

  /**
   * Passo do chefe. Não é o passo do jogador com o volume alto: ele tem duas
   * vezes e meia a altura, então o som desce quase duas oitavas, ganha um baque
   * de sub que o do jogador não tem e sai com um rabo de poeira que continua
   * meio segundo depois do impacto. É essa cauda que dá o peso.
   */
  bossFootstep(): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return
    const now = context.currentTime

    // Baque: seno que desce até o sub. É o corpo do passo.
    const thud = context.createOscillator()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(88 + Math.random() * 14, now)
    thud.frequency.exponentialRampToValueAtTime(31, now + 0.36)
    const thudGain = context.createGain()
    thudGain.gain.setValueAtTime(0, now)
    thudGain.gain.linearRampToValueAtTime(0.3, now + 0.008)
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)
    thud.connect(thudGain).connect(buses.sfx)
    thud.start(now)
    thud.stop(now + 0.55)

    // Pedra: o contato da bota, grave e curto.
    const stone = context.createBufferSource()
    stone.buffer = noise
    stone.playbackRate.value = 0.45 + Math.random() * 0.2
    const stoneFilter = context.createBiquadFilter()
    stoneFilter.type = 'bandpass'
    stoneFilter.frequency.value = 190 + Math.random() * 90
    stoneFilter.Q.value = 0.9
    const stoneGain = context.createGain()
    stoneGain.gain.setValueAtTime(0, now)
    stoneGain.gain.linearRampToValueAtTime(0.24, now + 0.01)
    stoneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    stone.connect(stoneFilter).connect(stoneGain).connect(buses.sfx)
    stone.start(now, Math.random() * 2)
    stone.stop(now + 0.36)

    // Rabo de poeira: entra depois do impacto e sai devagar.
    const dust = context.createBufferSource()
    dust.buffer = noise
    dust.playbackRate.value = 0.7 + Math.random() * 0.3
    const dustFilter = context.createBiquadFilter()
    dustFilter.type = 'lowpass'
    dustFilter.frequency.setValueAtTime(2200, now)
    dustFilter.frequency.exponentialRampToValueAtTime(420, now + 0.7)
    const dustGain = context.createGain()
    dustGain.gain.setValueAtTime(0, now)
    dustGain.gain.linearRampToValueAtTime(0.085, now + 0.05)
    dustGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72)
    dust.connect(dustFilter).connect(dustGain).connect(buses.sfx)
    dust.start(now, Math.random() * 2)
    dust.stop(now + 0.8)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Combate
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Corte no ar. Sorteia uma amostra do banco e nunca repete a anterior, que é
   * o que mata a sensação de som de jogo barato numa sequência de três golpes.
   * O pesado desce o pitch e sobe o volume, em vez de ter um banco só dele: as
   * gravações têm todas o mesmo caráter, separar em dois conjuntos daria uma
   * variedade menor por golpe sem soar mais pesado.
   */
  swing(heavy = false): void {
    if (this.playSwingSample(heavy)) return
    this.synthSwing(heavy)
  }

  /** Devolve `false` quando o banco ainda não carregou, pra cair no sintetizado. */
  private playSwingSample(heavy: boolean): boolean {
    const { context, buses, swings } = this
    if (!context || !buses || swings.length === 0) return false

    let index = Math.floor(Math.random() * swings.length)
    if (swings.length > 1 && index === this.lastSwing) {
      index = (index + 1 + Math.floor(Math.random() * (swings.length - 1))) % swings.length
    }
    this.lastSwing = index

    const source = context.createBufferSource()
    source.buffer = swings[index]
    // Pitch é o que separa leve de pesado; o tremor evita o efeito de eco
    // quando dois golpes iguais saem colados.
    source.playbackRate.value = (heavy ? 0.82 : 1.05) * (0.94 + Math.random() * 0.12)

    const gain = context.createGain()
    gain.gain.value = heavy ? 0.85 : 0.6

    source.connect(gain).connect(buses.sfx)
    source.start(context.currentTime)
    return true
  }

  private synthSwing(heavy: boolean): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return
    const now = context.currentTime
    const duration = heavy ? 0.42 : 0.26

    const source = context.createBufferSource()
    source.buffer = noise

    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 2.4
    // Varredura de grave pra agudo: é o que dá a sensação de lâmina passando.
    filter.frequency.setValueAtTime(heavy ? 300 : 520, now)
    filter.frequency.exponentialRampToValueAtTime(heavy ? 1500 : 2400, now + duration * 0.7)

    const gain = context.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(heavy ? 0.34 : 0.22, now + duration * 0.35)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    source.connect(filter).connect(gain).connect(buses.sfx)
    source.start(now)
    source.stop(now + duration + 0.05)
  }

  /**
   * Impacto. Um estalo de ruído por cima e um baque de seno por baixo.
   * `power` de 0 a 1 controla os dois.
   */
  impact(power = 0.6): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return
    const now = context.currentTime

    const crack = context.createBufferSource()
    crack.buffer = noise
    const crackFilter = context.createBiquadFilter()
    crackFilter.type = 'highpass'
    crackFilter.frequency.value = 1200
    const crackGain = context.createGain()
    crackGain.gain.setValueAtTime(0.3 * power, now)
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
    crack.connect(crackFilter).connect(crackGain).connect(buses.sfx)
    crack.start(now, Math.random() * 2)
    crack.stop(now + 0.14)

    const thud = context.createOscillator()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(150 + power * 60, now)
    thud.frequency.exponentialRampToValueAtTime(48, now + 0.22)
    const thudGain = context.createGain()
    thudGain.gain.setValueAtTime(0.42 * power, now)
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    thud.connect(thudGain).connect(buses.sfx)
    thud.start(now)
    thud.stop(now + 0.34)
  }

  /** Rugido do chefe na virada de fase. Grave, longo, com dissonância. */
  roar(): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return
    const now = context.currentTime
    const duration = 2.1

    for (const [ratio, level] of [
      [1, 0.3],
      [1.5, 0.16],
      [2.02, 0.1],
    ] as const) {
      const osc = context.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(58 * ratio, now)
      osc.frequency.linearRampToValueAtTime(42 * ratio, now + duration)
      const gain = context.createGain()
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(level, now + 0.25)
      gain.gain.setValueAtTime(level, now + duration * 0.6)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(900, now)
      filter.frequency.exponentialRampToValueAtTime(260, now + duration)
      osc.connect(filter).connect(gain).connect(buses.sfx)
      osc.start(now)
      osc.stop(now + duration + 0.1)
    }

    const air = context.createBufferSource()
    air.buffer = noise
    const airFilter = context.createBiquadFilter()
    airFilter.type = 'bandpass'
    airFilter.frequency.value = 420
    airFilter.Q.value = 0.8
    const airGain = context.createGain()
    airGain.gain.setValueAtTime(0, now)
    airGain.gain.linearRampToValueAtTime(0.22, now + 0.3)
    airGain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    air.connect(airFilter).connect(airGain).connect(buses.sfx)
    air.start(now)
    air.stop(now + duration + 0.1)
  }

  /**
   * Travar e soltar o alvo. Duas notas curtas de metal: sobe ao travar, desce
   * ao soltar. É informação, não música, então tem que ser bem curto.
   *
   * O nível saiu de 0,09 pra 0,27 por medida, não por gosto. Filtrando o
   * rendido numa banda de 1100 Hz Q 2,2, que é onde as duas notas moram, o aviso
   * media 0,014 de pico de RMS contra 0,042 do vento na mesma banda: nove
   * decibéis DEBAIXO do ambiente, ou seja, a informação mais importante da
   * câmera não chegava. Com 0,27 ele fica um decibel acima do vento.
   */
  lockOn(locked: boolean): void {
    const { context, buses } = this
    if (!context || !buses) return
    const now = context.currentTime
    const notas = locked ? [880, 1320] : [1320, 740]

    notas.forEach((frequency, i) => {
      const inicio = now + i * 0.055
      const osc = context.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = frequency
      const gain = context.createGain()
      gain.gain.setValueAtTime(0, inicio)
      gain.gain.linearRampToValueAtTime(0.27, inicio + 0.004)
      gain.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.13)
      osc.connect(gain).connect(buses.sfx)
      osc.start(inicio)
      osc.stop(inicio + 0.16)
    })
  }

  /**
   * Fôlego no fim da estamina. Só na borda de subida: enquanto o jogador segue
   * exausto o som não repete, senão vira arfada de desenho animado.
   *
   * Mesmo problema do lock-on, e pior: é ruído contra ruído. Na banda de 520 Hz
   * Q 1,6 ele media 0,012 de pico de RMS contra 0,051 do vento, treze decibéis
   * abaixo. O ganho foi de 0,2 pra 0,87, que o põe na altura do vento; quem faz
   * ele ser lido não é o nível e sim o gesto, ataque rápido e varredura do
   * filtro pra baixo, que o vento não tem.
   */
  setExhausted(spent: boolean): void {
    if (spent === this.exhausted) return
    this.exhausted = spent
    if (!spent) return

    const { context, buses, noise } = this
    if (!context || !buses || !noise) return
    const now = context.currentTime

    const source = context.createBufferSource()
    source.buffer = noise
    source.playbackRate.value = 0.85 + Math.random() * 0.2

    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(760, now)
    filter.frequency.exponentialRampToValueAtTime(340, now + 0.5)
    filter.Q.value = 1.6

    const gain = context.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.87, now + 0.09)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55)

    source.connect(filter).connect(gain).connect(buses.sfx)
    source.start(now, Math.random() * 2)
    source.stop(now + 0.6)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Momentos do ciclo
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Travessia do portão de névoa. É o clipe do Lyria, no barramento de efeito e
   * não no de música, porque ele tem que passar por cima do bordão do chefe que
   * começa no mesmo instante.
   */
  gateStinger(): void {
    if (this.playCue('portao-stinger', 0.95, this.buses?.sfx)) return
    this.synthGateStinger()
  }

  /**
   * Reserva do stinger: subida de cluster e uma pancada com queda de sub.
   * Os ganhos foram baixados pra bater com o clipe: medidos lado a lado, a
   * reserva dava 0,305 de RMS contra 0,157 do gerado, ou seja, quem caísse na
   * reserva levaria um susto duas vezes maior que o previsto.
   */
  private synthGateStinger(): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return
    const now = context.currentTime
    const hit = now + 1.6

    // Subida: cluster dissonante que aperta até a pancada.
    for (const [frequency, detune] of [
      [110, 0],
      [116, 12],
      [147, -9],
      [220, 7],
    ] as const) {
      const osc = context.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(frequency * 0.75, now)
      osc.frequency.exponentialRampToValueAtTime(frequency, hit)
      osc.detune.value = detune
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(300, now)
      filter.frequency.exponentialRampToValueAtTime(2400, hit)
      const gain = context.createGain()
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.075, hit)
      gain.gain.exponentialRampToValueAtTime(0.0001, hit + 1.6)
      osc.connect(filter).connect(gain).connect(buses.sfx)
      osc.start(now)
      osc.stop(hit + 1.8)
    }

    // Pancada e queda de sub.
    const drop = context.createOscillator()
    drop.type = 'sine'
    drop.frequency.setValueAtTime(120, hit)
    drop.frequency.exponentialRampToValueAtTime(26, hit + 1.5)
    const dropGain = context.createGain()
    dropGain.gain.setValueAtTime(0, hit)
    dropGain.gain.linearRampToValueAtTime(0.3, hit + 0.01)
    dropGain.gain.exponentialRampToValueAtTime(0.0001, hit + 2)
    drop.connect(dropGain).connect(buses.sfx)
    drop.start(hit)
    drop.stop(hit + 2.1)

    const crash = context.createBufferSource()
    crash.buffer = noise
    crash.loop = true
    const crashFilter = context.createBiquadFilter()
    crashFilter.type = 'lowpass'
    crashFilter.frequency.setValueAtTime(5200, hit)
    crashFilter.frequency.exponentialRampToValueAtTime(360, hit + 2)
    const crashGain = context.createGain()
    crashGain.gain.setValueAtTime(0, hit)
    crashGain.gain.linearRampToValueAtTime(0.17, hit + 0.02)
    crashGain.gain.exponentialRampToValueAtTime(0.0001, hit + 2.2)
    crash.connect(crashFilter).connect(crashGain).connect(buses.sfx)
    crash.start(hit, Math.random() * 2)
    crash.stop(hit + 2.3)
  }

  /**
   * Tela de morte. O bordão do chefe para junto: deixar a música rodando por
   * baixo da tela de morte tira o peso do silêncio, que é metade do efeito.
   */
  death(): void {
    this.stopBossMusic()
    if (this.playCue('morte', 0.9)) return
    this.synthToll(58, 3.4, 0.2)
  }

  /** Tela de vitória. A música já foi parada por quem chamou. */
  victory(): void {
    if (this.playCue('vitoria', 0.9)) return
    this.synthToll(87, 4.2, 0.155)
  }

  /**
   * Reserva das duas telas: uma badalada grave com parciais não harmônicos e
   * cauda longa. Grave demais pra ser sino, longa demais pra ser impacto.
   *
   * Os níveis foram baixados pra bater com os clipes que ela substitui, medidos
   * lado a lado em pico de RMS de janela de 50 ms: a morte dava 0,111 contra
   * 0,074 do gerado, e a vitória 0,091 contra 0,054. Quem caísse na reserva
   * levava as duas telas quatro decibéis mais altas que o previsto.
   */
  private synthToll(base: number, duration: number, level: number): void {
    const { context, buses } = this
    if (!context || !buses) return
    const now = context.currentTime

    for (const [ratio, share] of [
      [1, 1],
      [1.51, 0.5],
      [2.02, 0.32],
      [2.67, 0.18],
      [4.07, 0.09],
    ] as const) {
      const osc = context.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(base * ratio, now)
      osc.frequency.linearRampToValueAtTime(base * ratio * 0.985, now + duration)
      const gain = context.createGain()
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(level * share, now + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration * (0.5 + share * 0.5))
      osc.connect(gain).connect(buses.music)
      osc.start(now)
      osc.stop(now + duration + 0.2)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Música do chefe
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Música do chefe: bordão grave em quinta, um coro fingido por osciladores
   * levemente desafinados, e um tambor lento. Nada de melodia, porque melodia
   * cansa em cinco minutos de luta.
   *
   * Continua sintetizada de propósito, e não é um clipe do Lyria: ela precisa
   * responder à virada de fase abrindo o filtro e apertando o tambor, e um
   * arquivo fixo não faz isso sem cortar e cruzar duas faixas.
   */
  startBossMusic(): void {
    const { context, buses } = this
    if (!context || !buses || this.musicNodes.length > 0) return
    const now = context.currentTime

    const fade = context.createGain()
    fade.gain.setValueAtTime(0, now)
    fade.gain.linearRampToValueAtTime(1, now + 3.5)
    fade.connect(buses.music)
    this.musicNodes.push(fade)
    this.musicFilters = []
    this.musicBeatMs = 2300

    // Ré e Lá, uma quinta aberta, que é o intervalo mais sombrio e estável.
    for (const [frequency, level, detune] of [
      [36.7, 0.5, 0],
      [55, 0.34, -6],
      [73.4, 0.2, 7],
      [110, 0.11, -11],
    ] as const) {
      const osc = context.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = frequency
      osc.detune.value = detune
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 320
      filter.Q.value = 0.8
      const gain = context.createGain()
      gain.gain.value = level
      osc.connect(filter).connect(gain).connect(fade)
      osc.start(now)
      this.musicFilters.push(filter)
      this.musicNodes.push(osc, filter, gain)
    }

    // Tambor a cada dois segundos e meio, um pouco fora do quadrado.
    this.musicPulse = 0
    const beat = () => {
      if (!this.context || this.musicNodes.length === 0) return
      this.drum(fade, this.musicPulse % 4 === 0)
      this.musicPulse++
      this.musicTimer = window.setTimeout(beat, this.musicBeatMs + Math.random() * 260)
    }
    this.musicTimer = window.setTimeout(beat, 1200)
  }

  /**
   * Segunda vigília. O bordão abre o filtro e o tambor aperta, então a música
   * fica mais presente sem trocar de faixa e sem subir o volume.
   */
  intensifyMusic(): void {
    const { context } = this
    if (!context || this.musicNodes.length === 0) return
    const now = context.currentTime
    for (const filter of this.musicFilters) {
      filter.frequency.cancelScheduledValues(now)
      filter.frequency.setValueAtTime(filter.frequency.value, now)
      filter.frequency.linearRampToValueAtTime(620, now + 4)
    }
    this.musicBeatMs = 1500
  }

  stopBossMusic(): void {
    const { context } = this
    if (!context || this.musicNodes.length === 0) return
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer)
      this.musicTimer = null
    }
    const now = context.currentTime
    const fade = this.musicNodes[0] as GainNode
    fade.gain.cancelScheduledValues(now)
    fade.gain.setValueAtTime(fade.gain.value, now)
    fade.gain.linearRampToValueAtTime(0, now + 1.6)
    const nodes = this.musicNodes
    this.musicNodes = []
    this.musicFilters = []
    window.setTimeout(() => stopAll(nodes), 1900)
  }

  private drum(destination: AudioNode, accent: boolean): void {
    const { context } = this
    if (!context) return
    const now = context.currentTime
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(accent ? 78 : 62, now)
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.5)
    const gain = context.createGain()
    gain.gain.setValueAtTime(accent ? 0.5 : 0.3, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7)
    osc.connect(gain).connect(destination)
    osc.start(now)
    osc.stop(now + 0.75)
  }
}

function makeBus(context: AudioContext, master: GainNode, level: number): GainNode {
  const gain = context.createGain()
  gain.gain.value = level
  gain.connect(master)
  return gain
}

/**
 * Fonte posicionada no mundo. `equalpower` em vez de HRTF de propósito: HRTF
 * custa uma convolução por fonte e num jogo com doze braseiros isso aparece no
 * fio de áudio sem melhorar nada que se perceba num alto-falante de laptop.
 */
function makePanner(
  context: AudioContext,
  ponto: Ponto,
  refDistance: number,
  maxDistance: number,
  rolloff: number,
): PannerNode {
  const panner = context.createPanner()
  panner.panningModel = 'equalpower'
  panner.distanceModel = 'inverse'
  panner.refDistance = refDistance
  panner.maxDistance = maxDistance
  panner.rolloffFactor = rolloff
  const alvo = panner as PannerNode & {
    positionX?: AudioParam
    setPosition?: (x: number, y: number, z: number) => void
  }
  if (alvo.positionX) {
    alvo.positionX.value = ponto.x
    ;(alvo as unknown as Record<string, AudioParam>).positionY.value = ponto.y
    ;(alvo as unknown as Record<string, AudioParam>).positionZ.value = ponto.z
  } else {
    alvo.setPosition?.(ponto.x, ponto.y, ponto.z)
  }
  return panner
}

function stopAll(nodes: AudioNode[]): void {
  for (const node of nodes) {
    const osc = node as OscillatorNode
    try {
      if (typeof osc.stop === 'function') osc.stop()
    } catch {
      // Fonte que já parou sozinha lança; não é problema.
    }
    node.disconnect()
  }
}

/** Ruído branco levemente filtrado, reaproveitado por todos os efeitos. */
function makeNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    // Um polo de suavização tira o brilho de vidro do ruído branco puro.
    last = white * 0.32 + last * 0.68
    data[i] = last * 1.6
  }
  return buffer
}
