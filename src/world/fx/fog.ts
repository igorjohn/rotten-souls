import { Color, type Scene } from 'three/webgpu'
import { exp, float, oneMinus, positionView, positionWorld, smoothstep, uniform } from 'three/tsl'
import { fog } from 'three/tsl'

function createFogControls() {
  return {
    /** Densidade que come o fundo em qualquer altura. */
    distanceDensity: uniform(0.0115),
    /** Densidade extra colada no chão. */
    groundDensity: uniform(0.042),
    /** Altura, em metros, onde a névoa de chão já acabou. */
    groundHeight: uniform(2.4),
    color: uniform(new Color('#131c29')),
  }
}

export type FogControls = ReturnType<typeof createFogControls>

/**
 * Névoa em duas camadas, como manda a seção 3: uma de altura, mais densa nos
 * primeiros metros, que esconde a junção entre chão e parede, e uma de
 * distância, que come o fundo e barateia tudo que está longe.
 */
export function buildFog(scene: Scene): FogControls {
  const controls = createFogControls()

  const depth = positionView.z.negate().max(0)
  const heightFactor = oneMinus(smoothstep(float(0), controls.groundHeight, positionWorld.y))
  const density = controls.distanceDensity.add(controls.groundDensity.mul(heightFactor))

  // Exponencial ao quadrado: fica limpo perto e fecha rápido longe.
  const amount = depth.mul(density)
  const factor = oneMinus(exp(amount.mul(amount).negate()))

  scene.fog = null
  scene.fogNode = fog(controls.color, factor.clamp(0, 1))
  return controls
}
