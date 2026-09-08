import { BoxGeometry, BufferAttribute, ExtrudeGeometry, Shape, type BufferGeometry } from 'three/webgpu'

/**
 * Ajudantes de geometria do kit. A regra é uma só: UV em unidades de mundo.
 * Assim a mesma pedra serve num degrau de trinta centímetros e num muro de nove
 * metros sem esticar, e a escala do material vale pra peça inteira.
 */

/**
 * Caixa com UV em metros. A `BoxGeometry` do Three dá UV de 0 a 1 por face, o
 * que faz a textura esticar em qualquer peça que não seja cúbica.
 */
export function box(width: number, height: number, depth: number, uvPerMeter: number): BoxGeometry {
  const geometry = new BoxGeometry(width, height, depth)
  const uv = geometry.attributes.uv as BufferAttribute

  // Ordem das faces na BoxGeometry: +X, -X, +Y, -Y, +Z, -Z, quatro vértices cada.
  const faces: Array<[number, number]> = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ]

  for (let face = 0; face < 6; face++) {
    const [u, v] = faces[face]
    for (let i = 0; i < 4; i++) {
      const index = face * 4 + i
      uv.setXY(index, uv.getX(index) * u * uvPerMeter, uv.getY(index) * v * uvPerMeter)
    }
  }
  uv.needsUpdate = true
  return geometry
}

/** Multiplica o UV já existente. A `ExtrudeGeometry` já entrega UV em mundo. */
export function scaleUv(geometry: BufferGeometry, factor: number): BufferGeometry {
  const uv = geometry.attributes.uv as BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * factor, uv.getY(i) * factor)
  }
  uv.needsUpdate = true
  return geometry
}

export interface BayOptions {
  /** Largura do painel, que é a corda do anel entre dois pilares. */
  width: number
  height: number
  depth: number
  openingWidth: number
  /** Altura onde o arco começa a curvar. */
  springHeight: number
  uvPerMeter: number
  /** Semente do desgaste da variante arruinada. */
  seed?: number
}

/**
 * Vão de arcada gótica: um painel de pedra com um arco ogival vazado.
 *
 * O arco é equilátero, que é a forma gótica clássica: dois arcos de raio igual
 * à largura do vão, cada um centrado no pé oposto, encontrando numa ponta.
 */
export function gothicBay(options: BayOptions): ExtrudeGeometry {
  const { width, height, depth, openingWidth, springHeight, uvPerMeter } = options

  const shape = new Shape()
  shape.moveTo(-width / 2, 0)
  shape.lineTo(width / 2, 0)
  shape.lineTo(width / 2, height)
  shape.lineTo(-width / 2, height)
  shape.closePath()
  shape.holes.push(pointedArchHole(openingWidth, springHeight))

  return extrude(shape, depth, uvPerMeter)
}

/**
 * Mesma arcada, só que caída. O topo vira uma linha quebrada irregular e o arco
 * fica mais baixo, pra sobrar pedra entre a ponta do arco e a ruína.
 */
export function ruinedBay(options: BayOptions): ExtrudeGeometry {
  const { width, height, depth, openingWidth, springHeight, uvPerMeter, seed = 1 } = options
  const random = seededRandom(seed)

  const shape = new Shape()
  shape.moveTo(-width / 2, 0)
  shape.lineTo(width / 2, 0)

  // Sobe pela direita até uma altura quebrada, atravessa em degraus e desce.
  const steps = 7
  const heights: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // Mais alto perto dos pilares, mais baixo no meio: é assim que um vão cede.
    // A queda é contida de propósito, pra sobrar pedra acima da ponta do arco.
    const arc = Math.sin(t * Math.PI)
    heights.push(height * (0.97 - arc * 0.17) - random() * height * 0.08)
  }

  shape.lineTo(width / 2, heights[steps])
  for (let i = steps - 1; i >= 0; i--) {
    const x = -width / 2 + (width * i) / steps
    // Degrau reto e depois vertical, que lê como bloco solto e não como serra.
    shape.lineTo(x, heights[i + 1])
    shape.lineTo(x, heights[i])
  }
  shape.closePath()

  // Arco mais baixo e mais estreito que o do vão inteiro, pra caber sob a ruína.
  const opening = openingWidth * 0.74
  const spring = springHeight * 0.6
  const apex = spring + Math.sqrt(opening * opening - (opening / 2) * (opening / 2))
  if (apex < Math.min(...heights) - 0.5) {
    shape.holes.push(pointedArchHole(opening, spring))
  } else {
    // Se nem assim couber, o vão vira brecha reta em vez de virar muro maciço.
    shape.holes.push(brokenGapHole(opening, Math.min(...heights) - 0.6, seed))
  }

  return extrude(shape, depth, uvPerMeter)
}

/** Bloco solto de escombro, irregular mas sem ficar pontudo demais. */
export function rubbleChunk(seed: number, size: number, uvPerMeter: number): BoxGeometry {
  const random = seededRandom(seed)
  const geometry = box(size, size * (0.5 + random() * 0.5), size * (0.7 + random() * 0.6), uvPerMeter)
  const position = geometry.attributes.position as BufferAttribute
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      position.getX(i) + (random() - 0.5) * size * 0.28,
      position.getY(i) + (random() - 0.5) * size * 0.22,
      position.getZ(i) + (random() - 0.5) * size * 0.28,
    )
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/** Brecha de topo irregular, pra quando o arco não cabe embaixo da ruína. */
function brokenGapHole(openingWidth: number, topHeight: number, seed: number): Shape {
  const random = seededRandom(seed + 91)
  const half = openingWidth / 2
  const hole = new Shape()
  hole.moveTo(-half, 0)
  hole.lineTo(-half, topHeight * 0.72)
  const steps = 5
  for (let i = 0; i <= steps; i++) {
    const x = -half + (openingWidth * i) / steps
    hole.lineTo(x, topHeight * (0.72 + random() * 0.24))
  }
  hole.lineTo(half, 0)
  hole.closePath()
  return hole
}

function pointedArchHole(openingWidth: number, springHeight: number): Shape {
  const half = openingWidth / 2
  const hole = new Shape()
  hole.moveTo(-half, 0)
  hole.lineTo(-half, springHeight)
  // Arco esquerdo: centro no pé direito, raio igual à largura do vão.
  hole.absarc(half, springHeight, openingWidth, Math.PI, (Math.PI * 2) / 3, true)
  // Arco direito: espelho do outro, fechando na ponta.
  hole.absarc(-half, springHeight, openingWidth, Math.PI / 3, 0, true)
  hole.lineTo(half, 0)
  hole.closePath()
  return hole
}

function extrude(shape: Shape, depth: number, uvPerMeter: number): ExtrudeGeometry {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 1,
    curveSegments: 10,
  })
  geometry.translate(0, 0, -depth / 2)
  scaleUv(geometry, uvPerMeter)
  geometry.computeVertexNormals()
  return geometry
}

/** Aleatório reprodutível, pra ruína ser sempre a mesma entre execuções. */
export function seededRandom(seed: number): () => number {
  let state = Math.floor(seed * 1000) + 1
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}
