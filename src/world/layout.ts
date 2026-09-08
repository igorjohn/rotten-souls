/**
 * Medidas da arena num lugar só. Iluminação, braseiros, posição do chefe e o
 * kit modular do M3 leem daqui, então mudar a arena é mudar este arquivo.
 * Escala: arquitetura grande demais pro personagem, como manda a seção 3.
 */

const floorRadius = 21
const entranceAngle = Math.PI / 2
const stairSteps = 9
const stairStepDepth = 0.95
const entranceLandingHeight = 3.4
const landingDepth = 7
/**
 * Onde o primeiro degrau encosta no chao, ja do lado de fora do anel da arcada.
 * Antes a escadaria comecava dentro do anel e enterrava a base do portao de
 * nevoa nos degraus.
 */
const arcadeRadius = 22.4
const arcadeDepth = 1.2
const stairStartRadius = arcadeRadius + arcadeDepth + 0.4
const stairEndRadius = stairStartRadius + stairSteps * stairStepDepth
const landingCenterRadius = stairEndRadius + landingDepth / 2 - 0.5

export const LAYOUT = {
  floorRadius,

  /** Arcada gotica: face interna, profundidade e altura do painel. */
  arcadeRadius,
  arcadeDepth,
  arcadeHeight: 9.6,
  /** Vaos ao redor do anel. Um deles vira o portao de nevoa. */
  bayCount: 12,
  bayOpening: 5.4,
  baySpring: 3.3,
  /** Quais vaos entram arruinados, contados a partir da entrada. */
  ruinedBays: [2, 3, 7, 9] as readonly number[],

  /** Contrafortes entre os vaos, mais altos que a arcada. */
  pillarRadius: 22.9,
  pillarHeight: 12.4,
  pillarWidth: 1.7,
  pillarDepth: 2.6,

  /** Muro externo, atras da arcada. E ele que fecha a arena de verdade. */
  outerRadius: 24.4,
  outerHeight: 13.5,
  outerThickness: 1.8,
  outerSegments: 36,

  /** Parapeito por cima da arcada. */
  parapetHeight: 1.1,

  /** Ate onde o piso vai. Passa por baixo de tudo, pra nao sobrar vao. */
  groundRadius: 38,
  /** Aneis concentricos gravados no piso, como na referencia. */
  floorRings: [7.5, 12.5, 17.5],

  brazierCount: 12,
  brazierRadius: 19.6,
  brazierHeight: 1.35,

  /** Ângulo, em radianos, onde fica a entrada. 0 aponta pro +X. */
  entranceAngle,
  /** Largura angular do vão da entrada. */
  entranceArc: 0.42,
  entranceLandingHeight,
  stairSteps,
  stairStepDepth,
  stairStartRadius,
  stairEndRadius,
  stairWidth: 7,
  landingDepth,
  landingCenterRadius,

  /** Onde Vharen espera. */
  bossSpawn: { x: 0, y: 0, z: -11 },
} as const

export function ringPosition(angle: number, radius: number): { x: number; z: number } {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
}

/** Verdadeiro se o ângulo cai dentro do vão da entrada. */
export function insideEntrance(angle: number): boolean {
  let delta = angle - LAYOUT.entranceAngle
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return Math.abs(delta) < LAYOUT.entranceArc
}

/**
 * Topo do patamar de entrada, logo acima do primeiro degrau. É daqui que o
 * jogador desce e é o ponto de respawn. Fica na frente do patamar de propósito:
 * a câmera precisa de folga atrás pra não encostar na parede do fundo.
 */
export const PLAYER_SPAWN = (() => {
  const { x, z } = ringPosition(entranceAngle, stairEndRadius + 1.2)
  return { x, y: entranceLandingHeight + 0.05, z }
})()

/** Onde a câmera deve olhar quando o jogador nasce: o centro da arena. */
export const SPAWN_FACING = Math.atan2(-PLAYER_SPAWN.x, -PLAYER_SPAWN.z)
