import {
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  PointLight,
  Scene,
  Vector3,
} from 'three/webgpu'
import { LAYOUT, ringPosition, insideEntrance } from './layout'

export const PALETTE = {
  void: new Color('#05070c'),
  moon: new Color('#8fa9c9'),
  fire: new Color('#ff8a2a'),
  ember: new Color('#ffd17a'),
  moss: new Color('#3d4a2b'),
} as const

export interface Lighting {
  moon: DirectionalLight
  braziers: PointLight[]
  root: Group
}

/**
 * Uma única luz com sombra em tempo real, a lua. Braseiros são luz pontual de
 * raio curto e não projetam sombra, como manda a seção 4.
 */
export function buildLighting(scene: Scene): Lighting {
  const root = new Group()
  root.name = 'lighting'

  scene.fog = new FogExp2(PALETTE.void.getHex(), 0.026)

  const moon = new DirectionalLight(PALETTE.moon.getHex(), 2.1)
  moon.name = 'moon'
  // De trás e de cima da arena, olhando pro centro.
  moon.position.set(-26, 34, -30)
  moon.target.position.set(0, 0, 4)
  moon.castShadow = true
  moon.shadow.mapSize.set(2048, 2048)
  moon.shadow.camera.near = 6
  moon.shadow.camera.far = 110
  moon.shadow.camera.left = -34
  moon.shadow.camera.right = 34
  moon.shadow.camera.top = 34
  moon.shadow.camera.bottom = -34
  moon.shadow.bias = -0.0007
  moon.shadow.normalBias = 0.035
  moon.shadow.intensity = 0.92
  root.add(moon, moon.target)

  // Preenchimento mínimo pra sombra não virar preto chapado. Frio em cima, terra embaixo.
  const fill = new HemisphereLight(PALETTE.moon.getHex(), 0x1a1712, 0.22)
  root.add(fill)

  const braziers = buildBraziers()
  for (const light of braziers) root.add(light)

  scene.add(root)
  return { moon, braziers, root }
}

function buildBraziers(): PointLight[] {
  const lights: PointLight[] = []
  const step = (Math.PI * 2) / LAYOUT.brazierCount
  for (let i = 0; i < LAYOUT.brazierCount; i++) {
    const angle = i * step + step / 2
    if (insideEntrance(angle)) continue
    const { x, z } = ringPosition(angle, LAYOUT.brazierRadius)
    const light = new PointLight(PALETTE.fire.getHex(), 26, 13, 2)
    light.name = `brazier-${i}`
    light.position.set(x, LAYOUT.brazierHeight + 0.55, z)
    light.castShadow = false
    lights.push(light)
  }

  // Dois na entrada, marcando o caminho da escadaria.
  const { x, z } = ringPosition(LAYOUT.entranceAngle, LAYOUT.floorRadius + 4)
  const lateral = new Vector3(-z, 0, x).normalize().multiplyScalar(3.1)
  for (const side of [-1, 1]) {
    const light = new PointLight(PALETTE.fire.getHex(), 20, 11, 2)
    light.position.set(
      x + lateral.x * side,
      LAYOUT.entranceLandingHeight + 1.4,
      z + lateral.z * side,
    )
    light.castShadow = false
    lights.push(light)
  }

  return lights
}

/** Tremor de chama. Chamado todo frame, é barato e faz muita diferença. */
export function flickerBraziers(lights: PointLight[], elapsed: number): void {
  for (let i = 0; i < lights.length; i++) {
    const light = lights[i]
    const seed = i * 12.9898
    const flicker =
      Math.sin(elapsed * 11.3 + seed) * 0.5 +
      Math.sin(elapsed * 23.7 + seed * 1.7) * 0.3 +
      Math.sin(elapsed * 4.1 + seed * 0.6) * 0.2
    light.intensity = 24 + flicker * 5.5
  }
}
