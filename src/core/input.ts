import { Vector2 } from 'three/webgpu'

export type Action = 'dodge' | 'light' | 'heavy' | 'lockOn' | 'interact' | 'pause'

const KEY_TO_ACTION: Record<string, Action> = {
  Space: 'dodge',
  KeyE: 'interact',
  KeyQ: 'lockOn',
  Escape: 'pause',
}

const MOUSE_TO_ACTION: Record<number, Action> = {
  0: 'light',
  2: 'heavy',
  1: 'lockOn',
}

/** Janela em que um comando fica guardado esperando a ação anterior terminar. */
const BUFFER_SECONDS = 0.28

interface Buffered {
  time: number
}

export class Input {
  /** Direção de movimento bruta, no espaço da câmera. Comprimento 0 a 1. */
  readonly move = new Vector2()
  /** Delta do mouse ou do analógico direito, consumido pela câmera a cada frame. */
  readonly look = new Vector2()

  running = false
  pointerLocked = false
  enabled = false
  /** Em iframe de preview o pointer lock e negado. Ai a camera le o mouse solto. */
  lookWithoutLock = false

  private readonly keys = new Set<string>()
  private readonly buffer = new Map<Action, Buffered>()
  private readonly held = new Set<Action>()
  private now = 0
  private gamepadIndex: number | null = null
  private lookSensitivity = 0.0021
  private prevGamepadButtons: boolean[] = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    canvas.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = (e as GamepadEvent).gamepad.index
    })
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null
    })
  }

  requestPointerLock(): void {
    const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        // Preview em iframe, kiosk ou permissao negada. Nao e fatal.
        this.lookWithoutLock = true
        console.info('[input] pointer lock negado, usando mouse solto para a camera')
      })
    }
    window.setTimeout(() => {
      if (!this.pointerLocked) this.lookWithoutLock = true
    }, 400)
  }

  exitPointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }

  /** Roda no estágio de input, antes de qualquer simulação. */
  update(dt: number): void {
    this.now += dt
    this.readKeyboardMove()
    this.readGamepad()
    for (const [action, entry] of this.buffer) {
      if (this.now - entry.time > BUFFER_SECONDS) this.buffer.delete(action)
    }
  }

  /** Consome um comando bufferizado. Retorna true uma única vez. */
  consume(action: Action): boolean {
    if (!this.buffer.has(action)) return false
    this.buffer.delete(action)
    return true
  }

  isHeld(action: Action): boolean {
    return this.held.has(action)
  }

  clearBuffer(): void {
    this.buffer.clear()
  }

  /** Zera o delta de câmera depois que a câmera já leu. */
  consumeLook(out: Vector2): void {
    out.copy(this.look)
    this.look.set(0, 0)
  }

  private press(action: Action): void {
    if (!this.enabled) return
    this.buffer.set(action, { time: this.now })
    this.held.add(action)
  }

  private release(action: Action): void {
    this.held.delete(action)
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    this.keys.add(e.code)
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.running = true
    const action = KEY_TO_ACTION[e.code]
    if (action) {
      if (action !== 'pause') e.preventDefault()
      this.press(action)
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.running = false
    const action = KEY_TO_ACTION[e.code]
    if (action) this.release(action)
  }

  private readonly onBlur = () => {
    this.keys.clear()
    this.held.clear()
    this.buffer.clear()
    this.running = false
    this.move.set(0, 0)
  }

  private readonly onMouseDown = (e: MouseEvent) => {
    const action = MOUSE_TO_ACTION[e.button]
    if (action) {
      e.preventDefault()
      this.press(action)
    }
  }

  private readonly onMouseUp = (e: MouseEvent) => {
    const action = MOUSE_TO_ACTION[e.button]
    if (action) this.release(action)
  }

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked && !(this.lookWithoutLock && this.enabled)) return
    this.look.x += e.movementX * this.lookSensitivity
    this.look.y += e.movementY * this.lookSensitivity
  }

  private readonly onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas
    if (this.pointerLocked) this.lookWithoutLock = false
  }

  private readKeyboardMove(): void {
    let x = 0
    let y = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    if (x !== 0 || y !== 0) {
      this.move.set(x, y).normalize()
    } else if (this.gamepadIndex === null) {
      this.move.set(0, 0)
    }
  }

  private readGamepad(): void {
    if (this.gamepadIndex === null) return
    const pad = navigator.getGamepads?.()[this.gamepadIndex]
    if (!pad) return

    const dead = 0.18
    const lx = Math.abs(pad.axes[0]) > dead ? pad.axes[0] : 0
    const ly = Math.abs(pad.axes[1]) > dead ? pad.axes[1] : 0
    if (lx !== 0 || ly !== 0) {
      this.move.set(lx, -ly)
      if (this.move.length() > 1) this.move.normalize()
    }

    const rx = Math.abs(pad.axes[2]) > dead ? pad.axes[2] : 0
    const ry = Math.abs(pad.axes[3]) > dead ? pad.axes[3] : 0
    this.look.x += rx * 0.045
    this.look.y += ry * 0.045

    // 0 A esquiva, 2 X ataque leve, 3 Y pesado, 10 R3 lock-on, 6 LT correr
    const map: Record<number, Action> = { 0: 'dodge', 2: 'light', 3: 'heavy', 10: 'lockOn', 9: 'pause' }
    for (const key of Object.keys(map)) {
      const index = Number(key)
      const pressed = pad.buttons[index]?.pressed ?? false
      if (pressed && !this.prevGamepadButtons[index]) this.press(map[index])
      if (!pressed && this.prevGamepadButtons[index]) this.release(map[index])
      this.prevGamepadButtons[index] = pressed
    }
    // Nao sobrescreve o teclado: correr e verdade se qualquer um dos dois pede.
    // Antes isso apagava o Shift direito sempre que havia um gamepad conectado.
    const gatilho = (pad.buttons[6]?.value ?? 0) > 0.4
    this.running =
      gatilho || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
  }
}
