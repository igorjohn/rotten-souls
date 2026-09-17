import {
  Color,
  DirectionalLight,
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

/** Um fogo da arena, como dado. A luz pontual que o representa pode ser emprestada. */
interface BrazierSource {
  position: Vector3
  distance: number
  /** Fase do tremor, presa ao braseiro e não à luz, pra não pular quando a luz troca de dono. */
  seed: number
}

export interface Lighting {
  moon: DirectionalLight
  fill: HemisphereLight
  /** Luzes pontuais acesas. No perfil `alto` é uma por braseiro; nos outros, menos. */
  braziers: PointLight[]
  /** Onde a bacia de cada braseiro fica, pro efeito de fogo se plantar em cima. */
  brazierPositions: Vector3[]
  root: Group
  /** @internal */
  sources: BrazierSource[]
  /** @internal Índice da fonte que cada luz representa hoje. */
  assigned: number[]
}

/**
 * Uma única luz com sombra em tempo real, a lua. Braseiros são luz pontual de
 * raio curto e não projetam sombra, como manda a seção 4.
 */
export function buildLighting(scene: Scene): Lighting {
  const root = new Group()
  root.name = 'lighting'

  const moon = buildMoon(1536)
  root.add(moon, moon.target)

  // Preenchimento mínimo pra sombra não virar preto chapado. Frio em cima, terra embaixo.
  const fill = new HemisphereLight(PALETTE.moon.getHex(), 0x140f0a, 0.06)
  root.add(fill)

  const sources = buildBrazierSources()
  const brazierPositions = sources.map(
    (source) => new Vector3(source.position.x, source.position.y - 0.55, source.position.z),
  )

  scene.add(root)
  const lighting: Lighting = { moon, fill, braziers: [], brazierPositions, root, sources, assigned: [] }
  setBrazierLightBudget(lighting, Infinity)
  return lighting
}

function buildMoon(shadowMapSize: number): DirectionalLight {
  const moon = new DirectionalLight(PALETTE.moon.getHex(), 1.05)
  moon.name = 'moon'
  // De trás e de cima da arena, olhando pro centro.
  moon.position.set(-26, 34, -30)
  moon.target.position.set(0, 0, 4)
  moon.castShadow = true
  moon.shadow.mapSize.set(shadowMapSize, shadowMapSize)
  moon.shadow.camera.near = 6
  moon.shadow.camera.far = 110
  moon.shadow.camera.left = -27
  moon.shadow.camera.right = 27
  moon.shadow.camera.top = 27
  moon.shadow.camera.bottom = -27
  moon.shadow.bias = -0.0007
  moon.shadow.normalBias = 0.035
  moon.shadow.intensity = 0.92
  return moon
}

/**
 * Troca o tamanho do mapa de sombra da lua. Mudar `mapSize` numa luz viva
 * quebra no WebGPU do r185: o alvo é redimensionado e destruído no passe de
 * sombra, mas os materiais seguem apontando pra textura antiga, e todo frame
 * vira erro de validação. Trocar a luz inteira por outra recompila os
 * materiais uma vez e sai limpo. Ver decisions.md, 2026-09-17.
 */
export function setMoonShadowSize(lighting: Lighting, size: number): void {
  const old = lighting.moon
  if (old.shadow.mapSize.x === size) return
  const moon = buildMoon(size)
  moon.intensity = old.intensity
  lighting.root.remove(old, old.target)
  old.dispose()
  lighting.root.add(moon, moon.target)
  lighting.moon = moon
}

function buildBrazierSources(): BrazierSource[] {
  const sources: BrazierSource[] = []
  const step = (Math.PI * 2) / LAYOUT.brazierCount
  for (let i = 0; i < LAYOUT.brazierCount; i++) {
    const angle = i * step + step / 2
    if (insideEntrance(angle)) continue
    const { x, z } = ringPosition(angle, LAYOUT.brazierRadius)
    sources.push({
      position: new Vector3(x, LAYOUT.brazierHeight + 0.55, z),
      distance: 12,
      seed: sources.length * 12.9898,
    })
  }

  // Dois na entrada, marcando o caminho da escadaria.
  const { x, z } = ringPosition(LAYOUT.entranceAngle, LAYOUT.floorRadius + 4)
  const lateral = new Vector3(-z, 0, x).normalize().multiplyScalar(3.1)
  for (const side of [-1, 1]) {
    sources.push({
      position: new Vector3(
        x + lateral.x * side,
        LAYOUT.entranceLandingHeight + 1.4,
        z + lateral.z * side,
      ),
      distance: 10,
      seed: sources.length * 12.9898,
    })
  }

  return sources
}

/**
 * Quantas luzes pontuais existem na cena. O Three em forward avalia toda luz
 * em todo pixel, e trocar a lista de luzes recompila os shaders, então a
 * lista só muda aqui, na troca de perfil. Com orçamento menor que o número
 * de braseiros, as luzes viram um pool que `updateBrazierLights` distribui
 * entre os braseiros mais próximos do jogador a cada frame.
 */
export function setBrazierLightBudget(lighting: Lighting, budget: number): void {
  const count = Math.min(lighting.sources.length, budget)
  while (lighting.braziers.length > count) {
    const light = lighting.braziers.pop()!
    lighting.root.remove(light)
    light.dispose()
  }
  while (lighting.braziers.length < count) {
    const light = new PointLight(PALETTE.fire.getHex(), 15, 12, 2)
    light.name = `brazier-light-${lighting.braziers.length}`
    light.castShadow = false
    lighting.root.add(light)
    lighting.braziers.push(light)
  }
  // Recomeça do zero: cada luz pega o braseiro de mesmo índice e a poda
  // do próximo frame corrige.
  lighting.assigned = lighting.braziers.map((_, i) => i)
  for (let i = 0; i < count; i++) applySource(lighting.braziers[i], lighting.sources[i])
}

function applySource(light: PointLight, source: BrazierSource): void {
  light.position.copy(source.position)
  light.distance = source.distance
}

/** Trocar de braseiro só quando o candidato está este tanto mais perto. Evita luz pulando. */
const SWAP_MARGIN = 1.5

const _order: number[] = []
const _distance: number[] = []

/**
 * Tremor de chama e, quando há menos luzes que braseiros, a distribuição das
 * luzes entre os braseiros mais próximos do foco (o jogador). Chamado todo
 * frame.
 */
export function updateBrazierLights(lighting: Lighting, focus: Vector3, elapsed: number): void {
  const { sources, braziers, assigned } = lighting

  if (braziers.length < sources.length) {
    for (let i = 0; i < sources.length; i++) {
      _order[i] = i
      _distance[i] = sources[i].position.distanceToSquared(focus)
    }
    _order.length = sources.length
    _order.sort((a, b) => _distance[a] - _distance[b])

    for (let rank = 0; rank < braziers.length; rank++) {
      const candidate = _order[rank]
      if (assigned.includes(candidate)) continue
      // Tira o braseiro mais distante do pool, se o candidato estiver mais perto por margem.
      let worst = 0
      for (let slot = 1; slot < assigned.length; slot++) {
        if (_distance[assigned[slot]] > _distance[assigned[worst]]) worst = slot
      }
      const margin = Math.sqrt(_distance[assigned[worst]]) - Math.sqrt(_distance[candidate])
      if (margin < SWAP_MARGIN) continue
      assigned[worst] = candidate
      applySource(braziers[worst], sources[candidate])
    }
  }

  for (let i = 0; i < braziers.length; i++) {
    const source = sources[assigned[i]]
    const flicker =
      Math.sin(elapsed * 11.3 + source.seed) * 0.5 +
      Math.sin(elapsed * 23.7 + source.seed * 1.7) * 0.3 +
      Math.sin(elapsed * 4.1 + source.seed * 0.6) * 0.2
    braziers[i].intensity = 14.5 + flicker * 3.4
  }
}
