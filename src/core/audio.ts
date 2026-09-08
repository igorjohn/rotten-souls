/**
 * Áudio do jogo, inteiro sintetizado na Web Audio API. Nenhum arquivo de som
 * entra no bundle.
 *
 * A escolha não é preguiça: som de arena escura é vento, passo em pedra, corte
 * no ar, impacto e um bordão grave. Tudo isso é ruído filtrado e oscilador com
 * envelope, que sai mais leve que qualquer amostra comprimida, não tem licença
 * pra rastrear e responde a parâmetro (peso do golpe, distância do braseiro)
 * sem precisar de uma variação gravada pra cada caso.
 */

export type Bus = 'sfx' | 'ambient' | 'music'

interface Buses {
  sfx: GainNode
  ambient: GainNode
  music: GainNode
}

const MASTER_LEVEL = 0.85

export class Audio {
  private context: AudioContext | null = null
  private buses: Buses | null = null
  private noise: AudioBuffer | null = null
  private ambientSource: AudioBufferSourceNode | null = null
  private musicNodes: AudioNode[] = []
  private musicPulse = 0
  private musicTimer: number | null = null
  private started = false

  /** Precisa de um gesto do usuário. Chamado no clique do botão Entrar. */
  start(): void {
    if (this.started) return
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.started = true

    const context = new Ctor()
    this.context = context
    const master = context.createGain()
    master.gain.value = MASTER_LEVEL
    master.connect(context.destination)

    this.buses = {
      sfx: makeBus(context, master, 0.9),
      ambient: makeBus(context, master, 0.42),
      music: makeBus(context, master, 0.5),
    }

    this.noise = makeNoiseBuffer(context, 2.5)
    this.startAmbient()
    void context.resume()
  }

  get enabled(): boolean {
    return this.context !== null
  }

  setBusLevel(bus: Bus, level: number): void {
    if (!this.buses) return
    this.buses[bus].gain.value = level
  }

  /** Vento contínuo: ruído rosa passado por um filtro que respira. */
  private startAmbient(): void {
    const { context, buses, noise } = this
    if (!context || !buses || !noise) return

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
   * Passo. `weight` de 0 a 1 muda o corpo do som: andar é seco, correr é mais
   * pesado e um pouco mais grave.
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
    const peak = 0.13 + weight * 0.14
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 + weight * 0.05)

    source.connect(filter).connect(gain).connect(buses.sfx)
    source.start(now, Math.random() * 2)
    source.stop(now + 0.24)
  }

  /** Corte no ar. O pesado é mais longo, mais grave e mais alto. */
  swing(heavy = false): void {
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
   * Música do chefe: bordão grave em quinta, um coro fingido por osciladores
   * levemente desafinados, e um tambor lento. Nada de melodia, porque melodia
   * cansa em cinco minutos de luta.
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
      this.musicNodes.push(osc, filter, gain)
    }

    // Tambor a cada dois segundos e meio, um pouco fora do quadrado.
    this.musicPulse = 0
    const beat = () => {
      if (!this.context || this.musicNodes.length === 0) return
      this.drum(fade, this.musicPulse % 4 === 0)
      this.musicPulse++
      this.musicTimer = window.setTimeout(beat, 2300 + Math.random() * 260)
    }
    this.musicTimer = window.setTimeout(beat, 1200)
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
    window.setTimeout(() => {
      for (const node of nodes) {
        const osc = node as OscillatorNode
        if (typeof osc.stop === 'function') osc.stop()
        node.disconnect()
      }
    }, 1900)
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

  dispose(): void {
    this.stopBossMusic()
    this.ambientSource?.stop()
    void this.context?.close()
    this.context = null
  }
}

function makeBus(context: AudioContext, master: GainNode, level: number): GainNode {
  const gain = context.createGain()
  gain.gain.value = level
  gain.connect(master)
  return gain
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
