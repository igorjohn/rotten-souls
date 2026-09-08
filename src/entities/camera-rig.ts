import { MathUtils, Vector2, Vector3, type Object3D, type PerspectiveCamera } from 'three/webgpu'
import { LAYER, membership, type Physics } from '../core/physics'
import { SPAWN_FACING } from '../world/layout'

const PIVOT_HEIGHT = 1.55
const SHOULDER = 0.62
/** Com lock-on o jogador sai mais pro lado, senao ele tapa o alvo. */
const SHOULDER_LOCKED = 1.05
const BASE_DISTANCE = 4.3
const LOCK_DISTANCE = 5.4
const MIN_PITCH = -0.52
const MAX_PITCH = 0.95
const COLLISION_PAD = 0.34
const MIN_DISTANCE = 1.5

/**
 * Câmera de ombro. Sem lock-on ela é livre; com lock-on ela se coloca atrás do
 * jogador olhando pro alvo e enquadra os dois. Nunca atravessa parede: a
 * distância é cortada por um raio do pivô até a posição desejada.
 */
export class CameraRig {
  yaw = SPAWN_FACING
  pitch = 0.14

  private readonly pivot = new Vector3()
  private readonly desired = new Vector3()
  private readonly lookTarget = new Vector3()
  private readonly lateral = new Vector3()
  private readonly forward = new Vector3()
  private readonly toTarget = new Vector3()
  private readonly rayDirection = new Vector3()
  private distance = BASE_DISTANCE
  private shake = 0
  private shakeStrength = 0
  private cinematic: Cinematic | null = null

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly physics: Physics,
  ) {}

  /** Direção pra frente no plano, do ponto de vista da câmera. */
  getForward(out: Vector3): Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
  }

  /**
   * Direita da câmera, que é `frente cruzado com cima`. Com `yaw` em zero a
   * câmera olha pra +Z e a direita é -X, não +X: num sistema destro com Y pra
   * cima, Z cruzado com Y dá -X. O sinal estava trocado e deixava A e D
   * invertidos desde o M1.
   */
  getRight(out: Vector3): Vector3 {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw))
  }

  addLook(delta: Vector2): void {
    this.yaw -= delta.x
    this.pitch = MathUtils.clamp(this.pitch + delta.y, MIN_PITCH, MAX_PITCH)
  }

  punch(strength: number): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength)
    this.shake = 0.28
  }

  /**
   * Toma a câmera por um tempo e faz um movimento roteirizado. Usado na
   * apresentação do chefe. Quando acaba, a câmera volta pro ombro sozinha,
   * partindo de onde parou, pra não ter corte seco.
   */
  playCinematic(shot: {
    from: Vector3
    to: Vector3
    lookFrom: Vector3
    lookTo: Vector3
    duration: number
  }): void {
    this.cinematic = {
      time: 0,
      duration: shot.duration,
      from: shot.from.clone(),
      to: shot.to.clone(),
      lookFrom: shot.lookFrom.clone(),
      lookTo: shot.lookTo.clone(),
    }
  }

  get inCinematic(): boolean {
    return this.cinematic !== null
  }

  cancelCinematic(): void {
    this.cinematic = null
  }

  update(dt: number, follow: Object3D, height: number, target: Object3D | null): void {
    if (this.cinematic) {
      this.updateCinematic(dt)
      return
    }
    this.pivot.copy(follow.position)
    this.pivot.y += PIVOT_HEIGHT * (height / 1.85)

    if (target) {
      this.toTarget.copy(target.position).sub(follow.position)
      const flat = Math.hypot(this.toTarget.x, this.toTarget.z)
      const desiredYaw = Math.atan2(this.toTarget.x, this.toTarget.z)
      // Alvo alto pede a câmera mais baixa, senão o chefe sai do quadro.
      const heightDelta = target.position.y + 1.6 - this.pivot.y
      const desiredPitch = MathUtils.clamp(
        -Math.atan2(heightDelta, Math.max(2.5, flat)) * 0.55 + 0.04,
        MIN_PITCH,
        MAX_PITCH,
      )
      this.yaw = approachAngle(this.yaw, desiredYaw, dt * 7)
      this.pitch += (desiredPitch - this.pitch) * Math.min(1, dt * 6)
      this.distance += (Math.min(LOCK_DISTANCE, 3.6 + flat * 0.12) - this.distance) * Math.min(1, dt * 4)
    } else {
      this.distance += (BASE_DISTANCE - this.distance) * Math.min(1, dt * 4)
    }

    this.getForward(this.forward)
    this.getRight(this.lateral)

    const shoulder = target ? SHOULDER_LOCKED : SHOULDER
    const cosPitch = Math.cos(this.pitch)
    this.desired
      .copy(this.pivot)
      .addScaledVector(this.lateral, shoulder)
      .addScaledVector(this.forward, -this.distance * cosPitch)
      .setY(this.pivot.y + this.distance * Math.sin(this.pitch))

    this.clampAgainstWorld()

    if (this.shake > 0) {
      this.shake -= dt
      const amount = this.shakeStrength * Math.max(0, this.shake) * 0.6
      this.desired.x += (Math.random() - 0.5) * amount
      this.desired.y += (Math.random() - 0.5) * amount
      this.desired.z += (Math.random() - 0.5) * amount
      if (this.shake <= 0) this.shakeStrength = 0
    }

    this.camera.position.copy(this.desired)

    this.lookTarget.copy(this.pivot)
    if (target) {
      // Mira entre o jogador e o alvo, pesando pro alvo. E o que mantem os dois
      // no quadro. O deslocamento de ombro entra depois da mistura, senao ele
      // se perde e o jogador volta pro centro tapando o alvo.
      this.lookTarget.lerp(
        this.toTarget.copy(target.position).setY(target.position.y + 1.4),
        0.4,
      )
    } else {
      this.lookTarget.y += 0.25
    }
    this.lookTarget.addScaledVector(this.lateral, shoulder)
    this.camera.lookAt(this.lookTarget)
  }

  private updateCinematic(dt: number): void {
    const shot = this.cinematic
    if (!shot) return
    shot.time += dt
    const t = Math.min(1, shot.time / shot.duration)
    // Suavizado nas duas pontas: o movimento entra e sai sem solavanco.
    const eased = t * t * (3 - 2 * t)

    this.desired.copy(shot.from).lerp(shot.to, eased)
    this.camera.position.copy(this.desired)
    this.lookTarget.copy(shot.lookFrom).lerp(shot.lookTo, eased)
    this.camera.lookAt(this.lookTarget)

    if (t >= 1) this.cinematic = null
  }

  /** Corta a distância se tem parede entre o pivô e a câmera. */
  private clampAgainstWorld(): void {
    this.rayDirection.copy(this.desired).sub(this.pivot)
    const length = this.rayDirection.length()
    if (length < 0.001) return
    this.rayDirection.divideScalar(length)

    const ray = new this.physics.api.Ray(
      { x: this.pivot.x, y: this.pivot.y, z: this.pivot.z },
      { x: this.rayDirection.x, y: this.rayDirection.y, z: this.rayDirection.z },
    )
    const hit = this.physics.world.castRay(
      ray,
      length,
      true,
      undefined,
      membership(LAYER.player, LAYER.world),
    )
    if (hit && hit.timeOfImpact < length) {
      const safe = Math.max(MIN_DISTANCE, hit.timeOfImpact - COLLISION_PAD)
      this.desired.copy(this.pivot).addScaledVector(this.rayDirection, safe)
    }
  }
}

interface Cinematic {
  time: number
  duration: number
  from: Vector3
  to: Vector3
  lookFrom: Vector3
  lookTo: Vector3
}

function approachAngle(current: number, target: number, t: number): number {
  let delta = target - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * Math.min(1, t)
}
